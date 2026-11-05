import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHOT_PREVIEW_IMAGE_MODEL } from '@/models/models';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import * as costEstimation from '@/billing/cost-estimation';
import { simpleHash } from '@/platform/hash';
import { buildPreviewPrompt } from '@/sequences/server/poster-prompt';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ShotContext } from '@/shots/shot-access.fn';
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
  redrawShotPreview,
  redrawShotPreviewInRun,
  triggerShotPreview,
} from './shot-preview';

const estimateImageCost = vi.spyOn(costEstimation, 'estimateImageCost');
const getModelConfiguration = vi.fn();
const MOTION = 'Wide shot. Mara crosses the hall. Camera: slow push in';
const getLatestPreview = vi.fn();
const hasEnoughCredits = vi.fn();

const contextFor = (useStartFrame: boolean) =>
  // only the fields read by this helper are needed in the fixture
  asStub<ShotContext>({
    shot: { id: 'shot-1', useStartFrame },
    frame: { id: 'frame-1' },
    sequence: {
      id: 'sequence-1',
      generateStartFrames: false,
      aspectRatio: '16:9',
    },
    user: { id: 'user-1' },
    teamId: 'team-1',
    scene: null,
    scopedDb: {
      modelConfiguration: { get: getModelConfiguration },
      characters: { list: vi.fn(async () => []) },
      frameVariants: { getLatestPreview },
      apiKeys: { hasUsableKey: vi.fn(async () => false) },
      billing: { hasEnoughCredits },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  getLatestPreview.mockResolvedValue(null);
  hasEnoughCredits.mockResolvedValue(true);
  mocks.trigger.mockResolvedValue('run-1');
  mocks.loadModelConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
  mocks.loadModelRuntimeConfiguration.mockResolvedValue(
    DEFAULT_MODEL_CONFIGURATION
  );
  getModelConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
});

describe('redrawShotPreview', () => {
  it('draws a reference-only shot from its motion prompt', async () => {
    await redrawShotPreview(contextFor(false), MOTION);

    expect(mocks.trigger).toHaveBeenCalledWith(
      '/image',
      expect.objectContaining({
        prompt: buildPreviewPrompt(MOTION, []),
        model: SHOT_PREVIEW_IMAGE_MODEL,
        shotId: 'shot-1',
        frameId: 'frame-1',
        skipStorage: true,
      }),
      { modelConfiguration: DEFAULT_MODEL_CONFIGURATION }
    );
  });

  it('leaves a shot with a start frame alone', async () => {
    await redrawShotPreview(contextFor(true), MOTION);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('does not redraw a sketch of the same prompt', async () => {
    getLatestPreview.mockResolvedValue({
      promptHash: simpleHash(buildPreviewPrompt(MOTION, [])),
    });
    await redrawShotPreview(contextFor(false), MOTION);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('spends nothing and keeps the edit when credits run out', async () => {
    hasEnoughCredits.mockResolvedValue(false);
    await expect(
      redrawShotPreview(contextFor(false), MOTION)
    ).resolves.toBeUndefined();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});

describe('configured shot previews', () => {
  const configured = {
    ...DEFAULT_MODEL_CONFIGURATION,
    shotPreview: 'krea_2_turbo' as const,
  };
  const target = {
    userId: 'user-1',
    teamId: 'team-1',
    sequenceId: 'sequence-1',
    shotId: 'shot-1',
    frameId: 'frame-1',
    aspectRatio: '16:9' as const,
  };

  it('loads trusted administrator settings when triggered from a request', async () => {
    mocks.loadModelRuntimeConfiguration.mockResolvedValue(configured);
    await triggerShotPreview({ ...target, prompt: MOTION });
    expect(mocks.loadModelRuntimeConfiguration).toHaveBeenCalledOnce();
    expect(mocks.trigger).toHaveBeenCalledWith(
      '/image',
      expect.objectContaining({ model: configured.shotPreview }),
      { modelConfiguration: configured }
    );
  });

  it('estimates and starts the same configured model after a request edit', async () => {
    mocks.loadModelRuntimeConfiguration.mockResolvedValue(configured);
    await redrawShotPreview(contextFor(false), MOTION);
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
    await redrawShotPreviewInRun(scopedDb, {
      ...target,
      motionPrompt: MOTION,
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
  teamId: 'team-1',
  sequenceId: 'sequence-1',
  shotId: 'shot-1',
  frameId: 'frame-1',
  aspectRatio: '16:9' as const,
};

it('includes text routing when a request redraws a preview', async () => {
  mocks.loadModelRuntimeConfiguration.mockResolvedValue(runtimeSnapshot);

  await redrawShotPreview(contextFor(false), MOTION);

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

  const runId = await triggerShotPreview({ ...previewTarget, prompt: MOTION });

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

  await redrawShotPreviewInRun(scopedDb, {
    ...previewTarget,
    motionPrompt: MOTION,
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
