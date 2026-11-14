import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { asStub } from '@/test/as-stub';
import {
  OWNER,
  POSTER,
  STEP,
  deduct,
  emit,
  posterArgs,
  recordUsage,
} from './storyboard-poster.test.fixture';

// Explicit engine, AI, upload, child and email substitutes; no external services.
vi.doMock('@/platform/server/workflow/base-workflow', () => ({
  OpenStoryWorkflowEntrypoint: class {
    constructor(
      _context: unknown,
      readonly env: unknown
    ) {}
  },
}));
const generation: ImageGenerationResult = {
  imageUrls: ['data:image/png;base64,c3ludGhldGlj'],
  parameters: { model: POSTER.metadata.model, prompt: POSTER.metadata.prompt },
  generatedAt: '2026-11-14T00:00:00.000Z',
  processingTimeMs: 1,
  via: 'fal',
  metadata: POSTER.metadata,
};
const generateNative = vi.fn(async () => generation);
vi.doMock('@/stills/server/image-generation', () => ({
  generateImageWithProvider: generateNative,
}));
const upload = vi.fn(async () => ({ url: POSTER.url }));
vi.doMock('@/stills/server/image-storage', () => ({
  uploadPosterToStorage: upload,
}));
const generateConfigured = vi.fn(
  async (): Promise<typeof POSTER | null> => POSTER
);
vi.doMock('../configured-poster', () => ({
  generateConfiguredPoster: generateConfigured,
}));
const spawnChild = vi.fn(async () => ({ failures: [] }));
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild: spawnChild,
}));
// Minimal executor snapshot stub; planning and rendering remain substituted.
const plan = asStub<NonNullable<StoryboardWorkflowInput['plan']>>({
  targets: [],
  references: null,
  music: null,
});
vi.doMock('@/sequences/server/freeze-fresh-generation-plan', () => ({
  freezeFreshGenerationPlan: vi.fn(async () => ({ plan, remainingCost: 0 })),
}));
vi.doMock('@/billing/server/storyboard-render-gate', () => ({
  gateStoryboardRenders: vi.fn(async () => ({
    spawnRenders: true,
    neededMicros: 0,
    remainingMicros: 0,
  })),
}));
const notify = vi.fn(async () => 'sent');
vi.doMock('@/sequences/server/notify-sequence-ready', () => ({
  notifySequenceReady: notify,
  sequenceScenesUrl: (id: string) => 'https://example.invalid/sequences/' + id,
}));
const { StoryboardWorkflow } = await import('./storyboard-workflow');

class PosterWorkflowProbe extends StoryboardWorkflow {
  invoke(
    event: Readonly<WorkflowEvent<StoryboardWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

function eventFor(extras: Partial<StoryboardWorkflowInput> = {}) {
  const [style] = DEFAULT_STYLE_TEMPLATES;
  if (!style) throw new Error('Synthetic poster fixture needs a style');
  const payload: StoryboardWorkflowInput = {
    sequenceId: OWNER.id,
    organizationId: 'synthetic-poster-organization',
    userId: 'synthetic-poster-user',
    promptLocale: 'zh-CN',
    includeMusic: false,
    title: 'Synthetic title',
    script: 'Synthetic script',
    aspectRatio: '16:9',
    styleConfig: style.config,
    analysisModelId: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
    imageModel: POSTER.metadata.model,
    videoModel: DEFAULT_MODEL_CONFIGURATION.defaultVideo,
    elementIds: [],
    cast: [],
    referenceOnly: false,
    musicPromptSource: 'ai-generated',
    stopAt: 'script',
    workflowClaimId: OWNER.workflowClaimId,
    reservationId: 'synthetic-poster-reservation',
    sequenceUrl: 'https://example.invalid/sequences/' + OWNER.id + '/scenes',
    ...extras,
  };
  return {
    payload,
    instanceId: OWNER.workflowRunId,
    workflowName: 'SyntheticStoryboard',
    timestamp: new Date(0),
  };
}

function workflowRun(checkpoints?: Map<string, unknown>) {
  const run = posterArgs(checkpoints);
  const complete = vi.fn(async () => false);
  Object.assign(run.args.scopedDb.sequences, {
    startWorkflowIfCurrent: vi.fn(async () => true),
    completeWorkflowIfCurrent: complete,
  });
  Object.assign(run.args.scopedDb, {
    liveRead: {
      sequences: { getForUser: vi.fn(async () => ({ id: OWNER.id })) },
    },
    credentials: {},
  });
  type Ctor = ConstructorParameters<typeof PosterWorkflowProbe>;
  const workflow = new PosterWorkflowProbe(
    asStub<Ctor[0]>(undefined),
    asStub<Ctor[1]>({})
  );
  return {
    ...run,
    complete,
    invoke: (extras?: Partial<StoryboardWorkflowInput>) =>
      workflow.invoke(eventFor(extras), run.step, run.args.scopedDb),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

it.each([false, true])(
  'a stale %s-configured root settles cost and stops before children',
  async (configured) => {
    const run = workflowRun();
    if (configured) {
      run.args.scopedDb.models = {
        ...run.args.scopedDb.models,
        poster: 'custom-image:synthetic',
      };
    }
    run.setPosterIfCurrent.mockResolvedValue(false);
    await expect(run.invoke()).resolves.toBeUndefined();
    expect(deduct).toHaveBeenCalledTimes(1);
    expect(run.names.indexOf(STEP.deduct)).toBeLessThan(
      run.names.indexOf(STEP.save)
    );
    expect(run.names.indexOf(STEP.save)).toBeLessThan(
      run.names.indexOf(STEP.release)
    );
    expect(run.zeroReservation).toHaveBeenCalledExactlyOnceWith(
      run.args.reservationId
    );
    expect(spawnChild).not.toHaveBeenCalled();
    expect(run.complete).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  }
);

it('releases no unrelated reservation when the stale payload has none', async () => {
  const run = workflowRun();
  run.setPosterIfCurrent.mockResolvedValue(false);
  await run.invoke({ reservationId: undefined });
  expect(deduct).toHaveBeenCalledWith(
    expect.objectContaining({ reservationId: undefined })
  );
  expect(run.zeroReservation).not.toHaveBeenCalled();
  expect(spawnChild).not.toHaveBeenCalled();
});

it('the current publisher forwards its trusted identity before continuing', async () => {
  const run = workflowRun();
  await run.invoke();
  expect(run.setPosterIfCurrent).toHaveBeenCalledExactlyOnceWith({
    ...OWNER,
    posterUrl: POSTER.url,
  });
  expect(spawnChild).toHaveBeenCalledTimes(1);
  expect(run.complete).toHaveBeenCalledTimes(1);
  expect(run.zeroReservation).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith('generation.poster:ready', {
    posterUrl: POSTER.url,
    workflowOwner: {
      workflowRunId: OWNER.workflowRunId,
      workflowClaimId: OWNER.workflowClaimId,
    },
  });
});

it('a resume keeps the existing poster and never enters publication or billing', async () => {
  const run = workflowRun();
  await run.invoke({ resume: true, plan });
  expect(generateNative).not.toHaveBeenCalled();
  expect(generateConfigured).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(run.setPosterIfCurrent).not.toHaveBeenCalled();
  expect(recordUsage).not.toHaveBeenCalled();
  expect(deduct).not.toHaveBeenCalled();
  expect(spawnChild).toHaveBeenCalledTimes(1);
});

it('uses a legacy generated checkpoint but fences its unpublished result', async () => {
  const run = workflowRun(new Map([['generate-poster', POSTER]]));
  run.setPosterIfCurrent.mockResolvedValue(false);
  await run.invoke();
  expect(generateNative).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(run.setPosterIfCurrent).toHaveBeenCalledTimes(1);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(spawnChild).not.toHaveBeenCalled();
});

it('a legacy completed save checkpoint performs no new publication', async () => {
  const run = workflowRun(
    new Map<string, unknown>([
      ['generate-poster', POSTER],
      [STEP.save, undefined],
      [STEP.usage, undefined],
      [STEP.deduct, undefined],
    ])
  );
  await run.invoke();
  expect(generateNative).not.toHaveBeenCalled();
  expect(run.setPosterIfCurrent).not.toHaveBeenCalled();
  expect(deduct).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(spawnChild).toHaveBeenCalledTimes(1);
});

it('preserves a reservation release failure after stale publication without spawning children', async () => {
  const run = workflowRun();
  const error = new Error('Synthetic release failure');
  run.setPosterIfCurrent.mockResolvedValue(false);
  run.zeroReservation.mockRejectedValueOnce(error);
  await expect(run.invoke()).rejects.toBe(error);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(emit).not.toHaveBeenCalled();
  expect(spawnChild).not.toHaveBeenCalled();
});
