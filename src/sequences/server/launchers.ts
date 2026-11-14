import { WorkflowLaunchPendingError } from '@/platform/server/workflow/launch-pending';
import type { PreparedWorkflowRun } from '@/platform/server/workflow/prepared-trigger';
import type { Locale } from '@/platform/i18n/locale';
import { toImageModelCatalog } from '@/models/image-channels';
// Storyboard roots reserve one final instance ID and its frozen request atomically.

import { resolveLlmSources } from '@/billing/server/preflight';
import { characterToBible } from '@/cast/server/bibles-from-scoped';
import { withMeasuredDurations } from '@/cast/server/sequence-elements/media-duration';
import { getRequestCountry } from '@/platform/server/request-country';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_VIDEO_MODEL,
  safeAudioModel,
  safeImageToVideoModel,
  safeTextToImageModel,
} from '@/models/models';
import {
  type AnalysisModelId,
  getAnalysisModelById,
} from '@/models/models.config';
import { generateId } from '@/platform/id';
import { isElevenLabsConfigured } from '@/models/server/elevenlabs-config';
import { NotFoundError, ValidationError } from '@/platform/errors';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { Sequence } from '@/platform/server/db/schema';
import { resolveSequenceStyleConfig } from '@/look/style-config';
import { sequenceScenesUrl } from './notify-sequence-ready';
import {
  flagsFromStopAt,
  resolveStopAt,
  type GenerationStage,
} from '@/sequences/pipeline';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import {
  prepareWorkflowRun,
  triggerPreparedWorkflow,
} from '@/platform/server/workflow/prepared-trigger';
import { resolveStoryboardRunState } from './storyboard-run-state';
import type {
  StoryboardTriggerInput,
  StoryboardWorkflowInput,
} from '@/platform/server/workflow/types';

import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { textModelCatalogFromRouting } from '@/models/text-model-catalog';

export async function loadStoryboardModelConfiguration(
  scopedDb: ScopedDb
): Promise<ModelRuntimeConfiguration> {
  const [textModelRouting, imageModelRouting] = await Promise.all([
    scopedDb.textChannels.getSnapshot(),
    scopedDb.imageChannels.getSnapshot(),
  ]);
  const models = await scopedDb.modelConfiguration.get(
    textModelCatalogFromRouting(textModelRouting),
    toImageModelCatalog(imageModelRouting)
  );
  return { ...models, textModelRouting, imageModelRouting };
}

export function resolveStoryboardLlmSources(
  scopedDb: ScopedDb,
  analysisModel: string | null,
  configuration: ModelRuntimeConfiguration
) {
  return resolveLlmSources(
    scopedDb,
    [
      storyboardAnalysisModel(analysisModel, configuration),
      configuration.sceneSplit,
    ],
    configuration.textModelRouting ?? []
  );
}

function storyboardAnalysisModel(
  stored: string | null,
  configuration: ModelRuntimeConfiguration
): AnalysisModelId {
  const extraModels = textModelCatalogFromRouting(
    configuration.textModelRouting
  );
  const modelId = stored?.startsWith('custom:')
    ? stored
    : (getAnalysisModelById(stored ?? '', extraModels)?.id ??
      configuration.defaultAnalysis);
  const model = getAnalysisModelById(modelId, extraModels);
  if (!model || model.structuredOutput === false) {
    throw new ValidationError(
      'Select an available analysis model that supports structured output.'
    );
  }
  return model.id;
}

/** Thrown when a storyboard run is already in flight for the sequence. */
export class GenerationInProgressError extends Error {
  constructor() {
    super(
      'A generation is already running for this sequence — wait for it to finish before retrying.'
    );
    this.name = 'GenerationInProgressError';
  }
}

/**
 * Thrown when the run-status lookup itself failed, so we can't tell whether
 * a generation is live. Distinct from `GenerationInProgressError` — telling
 * the user to "wait for it to finish" would be wrong when there may be no
 * run at all (a CF status-API blip), and waiting would never clear it.
 */
export class GenerationStatusUnknownError extends Error {
  constructor() {
    super(
      "Couldn't verify whether a generation is still running — please try again in a moment."
    );
    this.name = 'GenerationStatusUnknownError';
  }
}

/**
 * Mutex step 1 — fetch the sequence and reject unless its most recent
 * storyboard run can be ruled out as live:
 *   - in flight (queued/running/paused/waiting) → `GenerationInProgressError`
 *   - status lookup failed → `GenerationStatusUnknownError`
 *
 * Both fail closed — the right direction for a mutex — but with messages
 * that match what we actually know.
 */
export async function getSequenceRejectingActiveRun(
  scopedDb: ScopedDb,
  sequenceId: string
) {
  const sequence = await scopedDb.sequences.getForUser({ sequenceId });
  if (!sequence.workflowRunId) return sequence; // legacy row or never generated
  const state = await resolveStoryboardRunState(scopedDb, {
    id: sequence.id,
    workflowRunId: sequence.workflowRunId,
  });
  if (state === null) throw new GenerationInProgressError();
  if (state === 'unknown') throw new GenerationStatusUnknownError();
  return sequence;
}

/**
 * Throw if the sequence's most recent storyboard run is still in flight
 * (or its status can't be verified — see `getSequenceRejectingActiveRun`).
 *
 * Check-only — for partial retries (per-shot image/motion) that must not
 * race a live full pipeline but don't start a storyboard themselves.
 */
export async function assertNoActiveStoryboard(
  scopedDb: ScopedDb,
  sequenceId: string
): Promise<void> {
  await getSequenceRejectingActiveRun(scopedDb, sequenceId);
}

/**
 * Snapshot everything the run generates from onto its payload, off the same
 * row the mutex check just read. The workflow used to derive these itself in
 * its first step — minutes to hours after the trigger, and again on every step
 * retry — so a script/style edit made after pressing generate silently became
 * what got generated. Content validation belongs here too: a missing script is
 * a synchronous "nothing to generate" for the caller, not a workflow that
 * accepts the trigger and dies mid-run.
 */
async function resolveStoryboardPayload(
  scopedDb: ScopedDb,
  sequence: Sequence,
  input: StoryboardTriggerInput,
  sequenceId: string,
  analysisModelId: AnalysisModelId
): Promise<StoryboardWorkflowInput> {
  if (!sequence.script || sequence.script.trim().length === 0) {
    throw new ValidationError('Sequence has no script');
  }
  const hasSnapshot = sequence.styleConfig != null;
  if (!hasSnapshot && !sequence.styleId) {
    throw new ValidationError('Sequence has no style selected');
  }
  // Voices need the platform ElevenLabs key (#1553). Refuse here, at the one
  // choke point every run passes, rather than fail the bible stage mid-run.
  if (sequence.generateVoices && !isElevenLabsConfigured()) {
    throw new ValidationError(
      'Voice design is not configured on this deployment.'
    );
  }

  const style = hasSnapshot
    ? null
    : sequence.styleId
      ? await scopedDb.styles.getById(sequence.styleId)
      : null;
  if (!hasSnapshot && !style) {
    throw new NotFoundError('No style found');
  }
  // No snapshot + a style bound to this sequence = an automatic style whose
  // recipe is still the placeholder (#1213). The run derives it first.
  const pendingAutoStyleId =
    !hasSnapshot && style?.sequenceId === sequenceId ? style.id : undefined;

  // Snapshotted for the whole run, so a clip's length has to be known here
  // or no gate downstream can check it (#1559).
  const elements = await withMeasuredDurations(
    scopedDb,
    await scopedDb.sequenceElements.list(sequenceId)
  );

  // Location identity is snapshotted here, alongside every other frozen
  // field: matching re-reads these rows for the late-arriving sheet image,
  // never for the name and description it matches on.
  //
  // The locations matching may bind a script location to (#1695) are the
  // organization's: the ones the writer picked for this run, then the ones already
  // attached to the sequence.
  const attachedLocations = (await scopedDb.locations.list(sequenceId)).filter(
    (l) => l.attached
  );
  const suggestedLocationIds = [
    ...new Set([
      ...(input.suggestedLocationIds ?? []),
      ...attachedLocations.map((l) => l.id),
    ]),
  ];
  const suggestedLocationRows =
    await scopedDb.locations.getCurrentByIds(suggestedLocationIds);

  // The live cast, frozen for the run (#2050): analysis reads only these,
  // and must not rewrite one another sequence has ever cast.
  const castRows = await scopedDb.characters.list(sequenceId);
  const cast = await Promise.all(
    castRows.map(async (row) => ({
      id: row.id,
      shared: await scopedDb.characters.getAnalysisMayNotRewrite(
        sequenceId,
        row.id
      ),
      entry: characterToBible(row),
    }))
  );

  // Capture during the request: durable workflows have no request context.
  const userCountry = getRequestCountry();

  return {
    ...input,
    userCountry,
    sequenceId,
    cast,
    suggestedLocationIds,
    suggestedLocations: suggestedLocationRows.map((l) => ({
      locationId: l.id,
      name: l.name,
      description: l.description,
    })),
    title: sequence.title,
    script: sequence.script,
    aspectRatio: sequence.aspectRatio,
    resolution: sequence.resolution,
    draftMotion: sequence.draftMotion,
    styleConfig: resolveSequenceStyleConfig({
      snapshot: sequence.styleConfig,
      live: style?.config,
    }),
    pendingAutoStyleId,
    analysisModelId,
    imageModel: safeTextToImageModel(sequence.imageModel, DEFAULT_IMAGE_MODEL),
    videoModel: safeImageToVideoModel(sequence.videoModel, DEFAULT_VIDEO_MODEL),
    elementIds: elements.map((el) => el.id),
    // Snapshotted here for the same reason as everything else: the music-prompt
    // grandchild runs long after this row could have gained a prompt, and a
    // lookup down there would relabel the version on a retry.
    musicPromptSource: sequence.musicPrompt ? 'regenerated' : 'ai-generated',
    // Pinned like every other generation setting: a toggle mid-run must not
    // leave one half of the pipeline rendering stills and the other half not.
    referenceOnly: !sequence.generateStartFrames,
    generateVoices: sequence.generateVoices,
    includeMusic: sequence.includeMusic,
    ownerEmail: await scopedDb.organizationManagement.getMemberEmail(
      input.userId
    ),
    sequenceUrl: sequenceScenesUrl(sequenceId),
    // Pin stop-at from this click, else the sequence snapshot (#1408).
    stopAt: resolveStopAt({
      stopAt: input.stopAt,
      generationStopAt: sequence.generationStopAt,
    }),
  };
}

/**
 * Start a storyboard run for a sequence: acquire the generation mutex,
 * snapshot the sequence's content onto the payload, mark the sequence
 * 'processing' (clearing any prior error), trigger the workflow, and persist
 * the instance id for the reconciler and future mutex checks. The single entry
 * point for `/storyboard` — all call sites (create, retry, regenerate,
 * smart-retry fallback) go through here.
 */
export async function triggerStoryboard(
  scopedDb: ScopedDb,
  input: StoryboardTriggerInput,
  modelConfiguration?: ModelRuntimeConfiguration
): Promise<{ workflowRunId: string }> {
  const { sequenceId } = input;
  if (!sequenceId) {
    throw new Error('triggerStoryboard requires input.sequenceId');
  }

  // Mutex step 1: reject while the previous run is still in flight (or its
  // state can't be verified).
  const sequence = await getSequenceRejectingActiveRun(scopedDb, sequenceId);

  const configuration =
    modelConfiguration ?? (await loadStoryboardModelConfiguration(scopedDb));
  const analysisModelId = storyboardAnalysisModel(
    sequence.analysisModel,
    configuration
  );
  const payload = await resolveStoryboardPayload(
    scopedDb,
    sequence,
    input,
    sequenceId,
    analysisModelId
  );

  return reserveStoryboardLaunch(scopedDb, sequence, payload, configuration);
}

async function reserveStoryboardLaunch(
  scopedDb: ScopedDb,
  sequence: Sequence,
  payload: StoryboardWorkflowInput,
  configuration: ModelRuntimeConfiguration
) {
  const prepared = await prepareWorkflowRun('/storyboard', payload, {
    deduplicationId: generateId(),
    modelConfiguration: configuration,
  });
  const workflowRunId = prepared.workflowRunId;
  const launch = {
    ...prepared,
    body: { ...prepared.body, workflowClaimId: workflowRunId },
  };
  const claimed = await claimStoryboardLaunch(scopedDb, {
    id: sequence.id,
    expectedRunId: sequence.workflowRunId,
    claimId: workflowRunId,
    launch,
    activity: {
      summary: payload.resume
        ? 'Continued generation'
        : 'Started the storyboard',
    },
  });
  if (!claimed) throw new GenerationInProgressError();
  return submitStoryboardLaunch(scopedDb, sequence.id, launch);
}

async function claimStoryboardLaunch(
  scopedDb: ScopedDb,
  params: Parameters<ScopedDb['sequences']['claimWorkflowSlot']>[0]
) {
  try {
    return await scopedDb.sequences.claimWorkflowSlot(params);
  } catch (cause) {
    throw new WorkflowLaunchPendingError({
      workflowRunId: params.launch.workflowRunId,
      reservationId: params.launch.body.reservationId,
      cause,
    });
  }
}

async function submitStoryboardLaunch(
  scopedDb: ScopedDb,
  sequenceId: string,
  launch: PreparedWorkflowRun<StoryboardWorkflowInput>
) {
  const { workflowRunId } = launch;
  try {
    await triggerPreparedWorkflow(launch);
    await scopedDb.sequences.publishWorkflowInstance({
      id: sequenceId,
      claimId: workflowRunId,
      workflowRunId,
    });
  } catch (cause) {
    throw new WorkflowLaunchPendingError({
      workflowRunId,
      reservationId: launch.body.reservationId,
      cause,
    });
  }
  return { workflowRunId };
}

/**
 * Continue (#1408, #1818): run the frozen plan's units in resume mode up to
 * `stopAt`, with the sequence's current models. Shared by the editor's
 * `continueGenerationFn` and agent operations (#1460). Holds the mutex via
 * `triggerStoryboard`.
 */
export function triggerContinue(
  scopedDb: ScopedDb,
  input: {
    promptLocale: Locale;
    userId: string;
    organizationId: string;
    sequence: Pick<Sequence, 'id' | 'imageModel' | 'videoModel' | 'musicModel'>;
    plan: UpdateStalePlan;
    stopAt: GenerationStage;
    leftoverGrokShotIds?: string[];
    modelConfiguration?: ModelRuntimeConfiguration;
  }
): Promise<{ workflowRunId: string }> {
  const { sequence, stopAt } = input;
  const { autoGenerateMotion, autoGenerateMusic } = flagsFromStopAt(stopAt);
  return triggerStoryboard(
    scopedDb,
    {
      promptLocale: input.promptLocale,
      userId: input.userId,
      organizationId: input.organizationId,
      sequenceId: sequence.id,
      resume: true,
      plan: input.plan,
      stopAt,
      autoGenerateMotion,
      autoGenerateMusic,
      imageModels: [
        safeTextToImageModel(sequence.imageModel, DEFAULT_IMAGE_MODEL),
      ],
      videoModels: [
        safeImageToVideoModel(sequence.videoModel, DEFAULT_VIDEO_MODEL),
      ],
      musicModel: sequence.musicModel
        ? safeAudioModel(sequence.musicModel, DEFAULT_MUSIC_MODEL)
        : undefined,
      leftoverGrokShotIds: input.leftoverGrokShotIds,
    },
    input.modelConfiguration
  );
}
