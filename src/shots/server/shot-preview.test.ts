import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHOT_PREVIEW_IMAGE_MODEL } from '@/models/models';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import * as costEstimation from '@/billing/cost-estimation';
import { simpleHash } from '@/platform/hash';
import { frameVariantFixture } from '@/mocks/frame-fixtures';
import {
  buildPreviewPrompt,
  previewTextForShot,
} from '@/sequences/server/poster-prompt';
import type { ShotContext } from '@/shots/shot-access.fn';
import type { StoredShotSpec } from '@/shots/shot-list.schema';
import { asStub } from '@/test/as-stub';

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  loadModelConfiguration: vi.fn(),
  loadModelRuntimeConfiguration: vi.fn(),
}));
vi.mock('@/platform/server/db/scoped', () => ({
  loadModelConfiguration: mocks.loadModelConfiguration,
  loadModelRuntimeConfiguration: mocks.loadModelRuntimeConfiguration,
}));
vi.mock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: mocks.trigger,
}));
vi.mock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: vi.fn(async () => ({})),
}));
import {
  drawSpecSketch,
  drawSpecSketchInRun,
  triggerShotPreview,
  readShotStoryboard,
} from './shot-preview';

const SPEC = asStub<StoredShotSpec>({
  framing: {
    shotSize: 'Wide shot',
    angle: 'Eye level',
    composition: '',
    subjectStartState: 'Mara at the door',
  },
  action: 'Mara crosses the hall',
  cameraMovement: { move: 'Push in', pacing: 'slow' },
  direction: '',
});
const promptOf = (spec: StoredShotSpec) =>
  buildPreviewPrompt(
    previewTextForShot(
      {
        shots: [{ ...spec, shotNumber: 1 }],
        originalScript: { extract: '' },
        metadata: { title: '', location: '', timeOfDay: '' },
      },
      1
    ),
    []
  );
const PROMPT = promptOf(SPEC);
const EDITED = asStub<StoredShotSpec>({
  ...SPEC,
  action: 'Mara runs for the stairs',
});
const estimateImageCost = vi.spyOn(costEstimation, 'estimateImageCost');
const getModelConfiguration = vi.fn();
const MOTION = 'Wide shot. Mara crosses the hall. Camera: slow push in';
const listPreviews = vi.fn();
const listByShot = vi.fn();
const hasEnoughCredits = vi.fn();

const contextFor = (useStartFrame: boolean, selectedSpecVersionId = 'spec-2') =>
  // only the fields read by this helper are needed in the fixture
  asStub<ShotContext>({
    promptLocale: 'en',
    shot: { id: 'shot-1', useStartFrame, selectedSpecVersionId },
    frame: { id: 'frame-1' },
    sequence: {
      id: 'sequence-1',
      generateStartFrames: false,
      aspectRatio: '16:9',
    },
    user: { id: 'user-1' },
    organizationId: 'org-1',
    scene: null,
    scopedDb: {
      modelConfiguration: { get: getModelConfiguration },
      characters: { list: vi.fn(async () => []) },
      frameVariants: { listPreviews },
      shotSpecVersions: { listByShot },
      shotPromptVersions: { getSelectedMotion: vi.fn(async () => null) },
      apiKeys: { hasUsableKey: vi.fn(async () => false) },
      billing: { hasEnoughCredits },
    },
  });

const sketch = (
  overrides: Partial<ReturnType<typeof frameVariantFixture>> = {}
) =>
  frameVariantFixture({
    frameId: 'frame-1',
    sequenceId: 'sequence-1',
    kind: 'preview',
    url: '/r2/sketch.png',
    promptHash: simpleHash(PROMPT),
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  listPreviews.mockResolvedValue([]);
  listByShot.mockResolvedValue([]);
  hasEnoughCredits.mockResolvedValue(true);
  mocks.trigger.mockResolvedValue('run-1');
  mocks.loadModelConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
  mocks.loadModelRuntimeConfiguration.mockResolvedValue(
    DEFAULT_MODEL_CONFIGURATION
  );
  getModelConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
});

describe('drawSpecSketch', () => {
  it.each([false, true])(
    'draws the spec and stamps its version (start frame: %s)',
    async (useStartFrame) => {
      await drawSpecSketch(contextFor(useStartFrame), {
        id: 'spec-2',
        spec: SPEC,
      });
      expect(mocks.trigger).toHaveBeenCalledWith(
        '/image',
        expect.objectContaining({
          prompt: PROMPT,
          model: SHOT_PREVIEW_IMAGE_MODEL,
          resolution: '720p',
          frameId: 'frame-1',
          skipStorage: true,
          specVersionId: 'spec-2',
        }),
        { modelConfiguration: DEFAULT_MODEL_CONFIGURATION }
      );
    }
  );

  it('does not draw a prompt that already has a sketch, under any version', async () => {
    listPreviews.mockResolvedValue([sketch({ specVersionId: 'spec-1' })]);
    await drawSpecSketch(contextFor(false), { id: 'spec-2', spec: SPEC });
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('spends nothing and keeps the edit when credits run out', async () => {
    hasEnoughCredits.mockResolvedValue(false);
    await expect(
      drawSpecSketch(contextFor(false), { id: 'spec-2', spec: SPEC })
    ).resolves.toBeUndefined();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});

describe('readShotStoryboard', () => {
  const t0 = new Date('2026-11-10T00:00:00Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
  const version = (id: string, source: string, minutes: number) => ({
    id,
    shotId: 'shot-1',
    spec: SPEC,
    source,
    inputHash: null,
    createdAt: at(minutes),
    createdBy: null,
  });

  it('pairs each version with its sketch; scene split matches by prompt', async () => {
    const split = sketch({ id: 'split', createdAt: at(0) });
    const edited = sketch({
      id: 'edited',
      specVersionId: 'spec-2',
      promptHash: simpleHash(promptOf(EDITED)),
      createdAt: at(30),
    });
    listPreviews.mockResolvedValue([edited, split]);
    listByShot.mockResolvedValue([
      { ...version('spec-2', 'edit', 30), spec: EDITED },
      version('spec-1', 'analysis', 2),
    ]);
    const board = await readShotStoryboard(contextFor(true));
    expect(board.versions.map((v) => [v.id, v.sketch?.id])).toEqual([
      ['spec-2', 'edited'],
      ['spec-1', 'split'],
    ]);
    expect(board.current?.id).toBe('edited');
    expect(board.staleReason).toBeNull();
  });

  it('shows the old sketch, stale, until the selected version has one', async () => {
    listPreviews.mockResolvedValue([
      sketch({ id: 'old', specVersionId: 'spec-1' }),
    ]);
    listByShot.mockResolvedValue([
      { ...version('spec-2', 'edit', 30), spec: EDITED },
      version('spec-1', 'analysis', 2),
    ]);
    const board = await readShotStoryboard(contextFor(false));
    expect(board.current?.id).toBe('old');
    expect(board.staleReason).toBe('changed');
    expect(board.versions[0]?.sketch).toBeNull();
  });

  it('does not call a fresh sketch changed while the sequence is still processing', async () => {
    listPreviews.mockResolvedValue([
      sketch({ id: 'split', specVersionId: 'spec-1' }),
    ]);
    listByShot.mockResolvedValue([
      { ...version('spec-2', 'analysis', 2), spec: EDITED },
    ]);
    const context = contextFor(false);
    context.sequence.status = 'processing';
    const board = await readShotStoryboard(context);
    expect(board.current?.id).toBe('split');
    expect(board.staleReason).toBeNull();
  });

  it('still reads a failed sketch as failed while the sequence is processing', async () => {
    listPreviews.mockResolvedValue([
      sketch({
        id: 'failed',
        status: 'failed',
        url: null,
        specVersionId: 'spec-2',
      }),
      sketch({ id: 'old', specVersionId: 'spec-1' }),
    ]);
    listByShot.mockResolvedValue([
      { ...version('spec-2', 'edit', 30), spec: EDITED },
      version('spec-1', 'analysis', 2),
    ]);
    const context = contextFor(false);
    context.sequence.status = 'processing';
    const board = await readShotStoryboard(context);
    expect(board.staleReason).toBe('failed');
  });

  it('a rename that leaves the drawn text alone stays fresh', async () => {
    listPreviews.mockResolvedValue([
      sketch({ id: 'old', specVersionId: 'spec-1' }),
    ]);
    listByShot.mockResolvedValue([
      version('spec-2', 'rename', 30),
      version('spec-1', 'analysis', 2),
    ]);
    const board = await readShotStoryboard(contextFor(false));
    expect(board.staleReason).toBeNull();
    expect(board.versions[0]?.sketch?.id).toBe('old');
  });

  it('a failed redraw reads failed while the old sketch shows', async () => {
    listPreviews.mockResolvedValue([
      sketch({
        id: 'failed',
        status: 'failed',
        url: null,
        specVersionId: 'spec-2',
      }),
      sketch({ id: 'old', specVersionId: 'spec-1' }),
    ]);
    listByShot.mockResolvedValue([
      { ...version('spec-2', 'edit', 30), spec: EDITED },
      version('spec-1', 'analysis', 2),
    ]);
    const board = await readShotStoryboard(contextFor(false));
    expect(board.current?.id).toBe('old');
    expect(board.staleReason).toBe('failed');
  });
});

describe('configured shot previews', () => {
  const configured = {
    ...DEFAULT_MODEL_CONFIGURATION,
    shotPreview: 'krea_2_turbo' as const,
  };
  const target = {
    userId: 'user-1',
    organizationId: 'team-1',
    sequenceId: 'sequence-1',
    shotId: 'shot-1',
    frameId: 'frame-1',
    aspectRatio: '16:9' as const,
  };

  it('loads trusted administrator settings when triggered from a request', async () => {
    mocks.loadModelRuntimeConfiguration.mockResolvedValue(configured);
    await triggerShotPreview({
      promptLocale: 'en' as const,
      ...target,
      prompt: MOTION,
      specVersionId: null,
    });
    expect(mocks.loadModelRuntimeConfiguration).toHaveBeenCalledOnce();
    expect(mocks.trigger).toHaveBeenCalledWith(
      '/image',
      expect.objectContaining({ model: configured.shotPreview }),
      { modelConfiguration: configured }
    );
  });

  it('estimates and starts the same configured model after a request edit', async () => {
    mocks.loadModelRuntimeConfiguration.mockResolvedValue(configured);
    await drawSpecSketch(contextFor(false), { id: 'spec-2', spec: SPEC });
    expect(estimateImageCost).toHaveBeenCalledWith(
      configured.shotPreview,
      '16:9',
      1,
      expect.any(Object)
    );
    expect(mocks.trigger).toHaveBeenCalledWith(
      '/image',
      expect.objectContaining({ model: configured.shotPreview }),
      { modelConfiguration: configured }
    );
    expect(mocks.loadModelRuntimeConfiguration).toHaveBeenCalledOnce();
    expect(getModelConfiguration).not.toHaveBeenCalled();
  });

  it('uses the parent snapshot for both credit estimation and the child run', async () => {
    const scopedDb = asStub<WorkflowScopedDb>({
      models: configured,
      liveRead: {
        apiKeys: { hasUsableKey: vi.fn(async () => false) },
        billing: { hasEnoughCredits },
        compliance: { listEnforcementFor: vi.fn(async () => []) },
      },
    });
    await drawSpecSketchInRun(scopedDb, {
      promptLocale: 'en' as const,
      ...target,
      version: { id: 'spec-2', spec: SPEC },
      scene: null,
      characterBible: [],
      deduplicationId: 'preview-1',
    });
    expect(estimateImageCost).toHaveBeenCalledWith(
      configured.shotPreview,
      '16:9',
      1,
      expect.any(Object)
    );
    expect(mocks.trigger).toHaveBeenCalledWith(
      '/image',
      expect.objectContaining({ model: configured.shotPreview }),
      expect.objectContaining({ modelConfiguration: configured })
    );
    expect(mocks.loadModelConfiguration).not.toHaveBeenCalled();
  });
});

// Mock administrator routing; no provider is called.
const runtimeSnapshot: ModelRuntimeConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  shotPreview: 'krea_2_turbo',
  textModelRouting: [
    {
      modelId: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      name: 'Mock analysis model',
      channelId: 'mock-channel',
      upstreamModel: 'mock-analysis-v1',
      credentialId: 'mock-credential-v1',
      protocol: 'openai-responses',
      baseUrl: 'https://mock.invalid/v1',
      vision: true,
      structuredOutput: true,
      tools: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
    },
  ],
};
const previewTarget = {
  userId: 'user-1',
  organizationId: 'team-1',
  sequenceId: 'sequence-1',
  shotId: 'shot-1',
  frameId: 'frame-1',
  aspectRatio: '16:9' as const,
};

it('includes text routing when a request redraws a preview', async () => {
  mocks.loadModelRuntimeConfiguration.mockResolvedValue(runtimeSnapshot);

  await drawSpecSketch(contextFor(false), { id: 'spec-2', spec: SPEC });

  expect(mocks.loadModelRuntimeConfiguration).toHaveBeenCalledOnce();
  expect(getModelConfiguration).not.toHaveBeenCalled();
  expect(mocks.trigger).toHaveBeenCalledWith(
    '/image',
    expect.objectContaining({ model: runtimeSnapshot.shotPreview }),
    { modelConfiguration: runtimeSnapshot }
  );
});

it('loads complete runtime configuration when no preview snapshot is supplied', async () => {
  mocks.loadModelRuntimeConfiguration.mockResolvedValue(runtimeSnapshot);

  const runId = await triggerShotPreview({
    promptLocale: 'en' as const,
    ...previewTarget,
    prompt: MOTION,
    specVersionId: null,
  });

  expect(runId).toBe('run-1');
  expect(mocks.loadModelRuntimeConfiguration).toHaveBeenCalledOnce();
  expect(mocks.loadModelConfiguration).not.toHaveBeenCalled();
  expect(mocks.trigger).toHaveBeenCalledWith(
    '/image',
    expect.objectContaining({ model: runtimeSnapshot.shotPreview }),
    { modelConfiguration: runtimeSnapshot }
  );
});

it('inherits the complete preview snapshot without loading newer settings', async () => {
  mocks.loadModelRuntimeConfiguration.mockResolvedValue({
    ...DEFAULT_MODEL_CONFIGURATION,
    textModelRouting: [],
  });
  const scopedDb = asStub<WorkflowScopedDb>({
    models: runtimeSnapshot,
    liveRead: {
      apiKeys: { hasUsableKey: vi.fn(async () => false) },
      billing: { hasEnoughCredits },
      compliance: { listEnforcementFor: vi.fn(async () => []) },
    },
  });

  await drawSpecSketchInRun(scopedDb, {
    promptLocale: 'en' as const,
    ...previewTarget,
    version: { id: 'spec-2', spec: SPEC },
    scene: null,
    characterBible: [],
    deduplicationId: 'mock-preview-replay',
  });

  expect(mocks.loadModelRuntimeConfiguration).not.toHaveBeenCalled();
  expect(mocks.loadModelConfiguration).not.toHaveBeenCalled();
  expect(mocks.trigger).toHaveBeenCalledWith(
    '/image',
    expect.objectContaining({ model: runtimeSnapshot.shotPreview }),
    {
      deduplicationId: 'mock-preview-replay',
      modelConfiguration: runtimeSnapshot,
      enforcement: [],
    }
  );
});
