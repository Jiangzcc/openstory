import {
  generationWorkflowOwnerSchema,
  type GenerationWorkflowOwner,
} from '@/platform/realtime/schema';
import type { GenerationStreamAction } from './generation-stream.reducer';

export type GenerationEvent = {
  event: string;
  data: Record<string, unknown>;
};

// Type guard helpers for extracting typed values from event data
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

// 'cancelled' (#1108): a video cancel is terminal — storing it clears any
// 'generating' overlay like the other terminal statuses do.
type ShotStatus =
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled';

function asShotStatus(value: unknown): ShotStatus | undefined {
  if (
    value === 'pending' ||
    value === 'generating' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return undefined;
}

/**
 * Extract retry state (#882) from an image/video progress event. Present only
 * when the emitter is starting a retry attempt (`phase: 'retrying'` with both
 * counters); any other update returns `undefined`, which clears the prior
 * retry state in the reducer.
 *
 * Variant-only retries (#547 alternate-model adds) are ignored: they don't
 * regenerate the live primary, so their retry state must not surface on the
 * primary player overlay.
 */
function asRetryInfo(
  data: Record<string, unknown>
): { attempt: number; maxAttempts?: number } | undefined {
  if (data.phase !== 'retrying' || data.variantOnly === true) return undefined;
  const attempt = asOptionalNumber(data.attempt);
  if (attempt === undefined) return undefined;
  // maxAttempts is optional: absent when the emitter leans on CF's default
  // per-step retry budget (no fixed denominator).
  return { attempt, maxAttempts: asOptionalNumber(data.maxAttempts) };
}

/**
 * Maps a realtime event to a typed reducer action.
 * Uses type guards for runtime type safety.
 */
const eventActions: Record<
  string,
  (data: Record<string, unknown>) => GenerationStreamAction
> = {
  'generation.phase:start': (data) => ({
    type: 'PHASE_START',
    payload: {
      phase: asNumber(data.phase),
      phaseName: asString(data.phaseName),
    },
  }),
  'generation.phase:complete': (data) => ({
    type: 'PHASE_COMPLETE',
    payload: { phase: asNumber(data.phase) },
  }),
  'generation.scene:new': (data) => ({
    type: 'SCENE_NEW',
    payload: {
      sceneId: asString(data.sceneId),
      sceneNumber: asNumber(data.sceneNumber),
      title: asString(data.title),
      scriptExtract: asString(data.scriptExtract),
      durationSeconds: asNumber(data.durationSeconds),
    },
  }),
  'generation.scene:updated': (data) => ({
    type: 'SCENE_UPDATED',
    payload: {
      sceneId: asString(data.sceneId),
      sceneNumber: asNumber(data.sceneNumber),
      title: asString(data.title),
      scriptExtract: asString(data.scriptExtract),
      durationSeconds: asNumber(data.durationSeconds),
    },
  }),
  'generation.shot:created': (data) => ({
    type: 'SHOT_CREATED',
    payload: {
      shotId: asString(data.shotId),
      sceneId: asString(data.sceneId),
      orderIndex: asNumber(data.orderIndex),
    },
  }),
  'generation.image:progress': (data) => ({
    type: 'IMAGE_PROGRESS',
    payload: {
      shotId: asString(data.shotId),
      status: asShotStatus(data.status),
      thumbnailUrl: asOptionalString(data.thumbnailUrl),
      previewThumbnailUrl: asOptionalString(data.previewThumbnailUrl),
      retry: asRetryInfo(data),
    },
  }),
  'generation.video:progress': (data) => ({
    type: 'VIDEO_PROGRESS',
    payload: {
      shotId: asString(data.shotId),
      status: asShotStatus(data.status),
      videoUrl: asOptionalString(data.videoUrl),
      retry: asRetryInfo(data),
    },
  }),
  'generation.complete': (data) => ({
    type: 'COMPLETE',
    payload: { sequenceId: asString(data.sequenceId) },
  }),
  'generation.failed': (data) => ({
    type: 'FAILED',
    payload: { message: asString(data.message) },
  }),
  'generation.reservation:short': (data) => ({
    type: 'FAILED',
    payload: {
      message: `Not enough credits to generate images for ${asNumber(data.sceneCount)} scenes.`,
    },
  }),
  'generation.error': (data) => ({
    type: 'ERROR',
    payload: {
      message: asString(data.message),
      phase: asOptionalNumber(data.phase),
    },
  }),
  'generation.location:matched': (data) => ({
    type: 'LOCATION_MATCHED',
    payload: {
      matches: (Array.isArray(data.matches) ? data.matches : []).map(
        (m: Record<string, unknown>) => ({
          locationId: asString(m.locationId),
          libraryLocationId: asString(m.libraryLocationId),
          libraryLocationName: asString(m.libraryLocationName),
          referenceImageUrl:
            typeof m.referenceImageUrl === 'string'
              ? m.referenceImageUrl
              : null,
          description: asOptionalString(m.description),
        })
      ),
    },
  }),
  'generation.preview:replaced': (data) => ({
    type: 'PREVIEW_REPLACED',
    payload: { newSceneCount: asNumber(data.newSceneCount) },
  }),
};

function mapEventToAction(
  eventName: string,
  data: Record<string, unknown>
): GenerationStreamAction | null {
  const mapper = Object.hasOwn(eventActions, eventName)
    ? eventActions[eventName]
    : undefined;
  return mapper ? mapper(data) : null;
}

const LIFECYCLE_EVENTS = new Set([
  'generation.phase:start',
  'generation.phase:complete',
  'generation.complete',
  'generation.failed',
  'generation.error',
  'generation.reservation:short',
]);

export function isGenerationLifecycleEvent(event: string): boolean {
  return LIFECYCLE_EVENTS.has(event);
}

export function generationWorkflowOwnerOf(
  data: Record<string, unknown>
): GenerationWorkflowOwner | undefined {
  const parsed = generationWorkflowOwnerSchema.safeParse(data.workflowOwner);
  return parsed.success ? parsed.data : undefined;
}

export function matchesGenerationWorkflow(
  owner: GenerationWorkflowOwner | undefined,
  workflowRunId: string | null
): boolean {
  return (
    owner !== undefined &&
    workflowRunId !== null &&
    (owner.workflowRunId === workflowRunId ||
      owner.workflowClaimId === workflowRunId)
  );
}

export function mapGenerationEvent(
  event: GenerationEvent,
  workflowRunId: string | null
): GenerationStreamAction | null {
  if (
    isGenerationLifecycleEvent(event.event) &&
    !matchesGenerationWorkflow(
      generationWorkflowOwnerOf(event.data),
      workflowRunId
    )
  )
    return null;
  return mapEventToAction(event.event, event.data);
}
