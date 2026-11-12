import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_FAL_PRICING } from '@/billing/fal-pricing-fixture';
import { micros } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import {
  frameFixture,
  frameVariantFixture,
  videoVariantFixture,
} from '@/mocks/frame-fixtures';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type {
  FramePromptVersion,
  Sequence,
  Shot,
  ShotPromptVersion,
} from '@/platform/server/db/schema';
import { asStub } from '@/test/as-stub';

// Mock DB rows, reservations, launchers and notifications; retry branches and pricing are real.
const triggerRun =
  vi.fn<
    typeof import('@/platform/server/workflow/client').triggerWorkflowRun
  >();
const triggerMusic =
  vi.fn<typeof import('@/platform/server/workflow/client').triggerWorkflow>();
const triggerStoryboard =
  vi.fn<typeof import('./launchers').triggerStoryboard>();
const captureConfiguration =
  vi.fn<typeof import('./launchers').loadStoryboardModelConfiguration>();
const assertNoActiveStoryboard =
  vi.fn<typeof import('./launchers').assertNoActiveStoryboard>();
const reserveCredits =
  vi.fn<typeof import('@/billing/server/preflight').reserveRunCredits>();
const notifyReady = vi.fn();

function mockConfiguration(priceUsd: number): ModelRuntimeConfiguration {
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    textModelRouting: [],
    imageModelRouting: createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    ).map((route) => ({
      ...route,
      priceCards: route.priceCards.map((card) => ({
        ...card,
        unitPriceUsd: priceUsd,
      })),
    })),
  };
}

const retryConfiguration = mockConfiguration(0.07);
const currentConfiguration = mockConfiguration(0.21);

vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflowRun: triggerRun,
  triggerWorkflow: triggerMusic,
}));
vi.doMock('./launchers', () => ({
  assertNoActiveStoryboard,
  loadStoryboardModelConfiguration: captureConfiguration,
  resolveStoryboardLlmSources: async () => ['platform'],
  triggerStoryboard,
}));
vi.doMock('@/billing/server/preflight', async () => ({
  ...(await vi.importActual<typeof import('@/billing/server/preflight')>(
    '@/billing/server/preflight'
  )),
  reserveRunCredits: reserveCredits,
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => TEST_FAL_PRICING,
}));
vi.doMock('./notify-sequence-ready', () => ({
  notifySequenceReady: notifyReady,
  sequenceScenesUrl: (id: string) => id,
}));

const { executeSmartRetry } = await import('./smart-retry');
type RetryBranch = 'motion' | 'music' | 'music-prompt' | 'image' | 'full';
const snapshotBranches = ['motion', 'music', 'music-prompt'] as const;
const branchPaths = {
  motion: '/motion-batch',
  music: '/music',
  'music-prompt': '/music-prompt',
} as const;
const now = new Date('2026-11-12T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  triggerRun
    .mockReset()
    .mockResolvedValue({ workflowRunId: 'mock-keyed-run', reused: false });
  triggerMusic.mockReset().mockResolvedValue('mock-music-run');
  triggerStoryboard
    .mockReset()
    .mockResolvedValue({ workflowRunId: 'mock-storyboard-run' });
  captureConfiguration.mockReset().mockResolvedValue(currentConfiguration);
  assertNoActiveStoryboard.mockReset().mockResolvedValue(undefined);
  reserveCredits.mockReset().mockResolvedValue('mock-reservation');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Snapshot regressions forbid network and provider calls.')
  );
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function mockShotRows(branches: RetryBranch[]) {
  const shot: Shot = {
    id: 'mock-shot',
    sequenceId: 'mock-sequence',
    sceneId: null,
    shotNumber: 1,
    durationMs: 3000,
    useStartFrame: null,
    selectedMotionPromptVersionId: 'mock-motion-prompt',
    selectedSpecVersionId: null,
    pendingSpecVersionId: null,
    audioClips: null,
    renderSegmentId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const frame = frameFixture({
    id: 'mock-frame',
    shotId: shot.id,
    sequenceId: shot.sequenceId,
    selectedImageVersionId: 'mock-image',
    selectedImagePromptVersionId: 'mock-image-prompt',
  });
  const image = frameVariantFixture({
    id: 'mock-image',
    frameId: frame.id,
    sequenceId: shot.sequenceId,
    url: 'https://mock.invalid/still.png',
  });
  const failedImage = frameVariantFixture({
    frameId: frame.id,
    sequenceId: shot.sequenceId,
    status: 'failed',
  });
  const imagePrompt: FramePromptVersion = {
    id: 'mock-image-prompt',
    frameId: frame.id,
    text: 'Mock still prompt',
    components: null,
    source: 'ai-generated',
    specVersionId: null,
    inputHash: null,
    analysisModel: null,
    status: 'completed',
    pendingInputHash: null,
    workflowRunId: null,
    createdAt: now,
    createdBy: null,
  };
  const motionPrompt: ShotPromptVersion = {
    id: 'mock-motion-prompt',
    shotId: shot.id,
    promptType: 'motion',
    text: 'Mock slow pan',
    components: null,
    parameters: null,
    dialogue: null,
    audio: null,
    audioClips: null,
    usesStartFrame: true,
    source: 'ai-generated',
    specVersionId: null,
    inputHash: null,
    analysisModel: null,
    status: 'completed',
    pendingInputHash: null,
    workflowRunId: null,
    createdAt: now,
    createdBy: null,
  };
  const video = videoVariantFixture({
    renderSegmentId: shot.id,
    sequenceId: shot.sequenceId,
    status: branches.includes('motion') ? 'failed' : 'completed',
  });
  return { shot, frame, image, failedImage, imagePrompt, motionPrompt, video };
}

function mockContext(branches: RetryBranch[]) {
  const rows = mockShotRows(branches);
  const shots = branches.includes('full') ? [] : [rows.shot];
  const sequence = asStub<Sequence>({
    id: 'mock-sequence',
    title: 'Mock retry sequence',
    script: 'A mock scene.',
    status: 'failed',
    statusError: null,
    workflowRunId: null,
    imageModel: 'custom-image:qwen',
    videoModel: 'kling_2_5',
    musicModel: 'elevenlabs_music',
    analysisModel: 'anthropic/claude-haiku-4.5',
    aspectRatio: '16:9',
    resolution: '720p',
    styleConfig: {
      version: 2,
      look: {
        mood: 'quiet',
        artStyle: 'watercolour',
        lighting: 'soft light',
        colorPalette: ['silver', 'blue'],
        colorGrading: 'cool shadows',
      },
      motion: { camera: 'locked' },
      references: [],
    },
    styleId: null,
    generationStopAt: 'images',
    generateStartFrames: true,
    generateVoices: false,
    draftMotion: false,
    musicStatus: branches.some(
      (branch) => branch === 'music' || branch === 'music-prompt'
    )
      ? 'failed'
      : 'completed',
    musicPrompt: branches.includes('music-prompt')
      ? null
      : 'Mock ambient music',
    musicTags: 'mock ambient',
    pendingPromoteMusicVariantId: null,
    includeMusic: true,
  });
  const updateStatus = vi.fn(async () => {});
  const claimMusic = vi.fn(
    async (): Promise<string | null> => 'mock-music-variant'
  );
  const zeroReservation = vi.fn(async () => {});
  const createReservation = vi.fn(async () => ({
    ok: true,
    reservationId: 'mock-image-reservation',
    remaining: micros(70000),
    replay: false,
  }));
  const noVersions = async () => new Map();
  const scopedDb = asStub<ScopedDb>({
    shots: {
      listBySequence: async () => shots,
      ensureAnchorFrames: async () => {},
    },
    frames: { listAnchorsBySequence: async () => shots.map(() => rows.frame) },
    frameVariants: {
      getSelectedByFrameIds: async () => new Map([[rows.frame.id, rows.image]]),
      getPrimaryByFrameIds: async () =>
        new Map(
          branches.includes('image') ? [[rows.frame.id, rows.failedImage]] : []
        ),
      listSelectedModelsBySequence: noVersions,
      listLastFailedModelsBySequence: noVersions,
    },
    framePromptVersions: {
      getSelectedByFrameIds: async () =>
        new Map([[rows.frame.id, rows.imagePrompt]]),
    },
    videoVariants: {
      getSelectedByShotIds: noVersions,
      getPrimaryByShotIds: async () => new Map([[rows.shot.id, rows.video]]),
      listSelectedModelsBySequence: noVersions,
      listLastFailedModelsBySequence: noVersions,
    },
    shotPromptVersions: {
      getSelectedMotionByShots: async () =>
        new Map([[rows.shot.id, rows.motionPrompt]]),
    },
    scenes: { listBySequence: async () => [] },
    sceneScriptVersions: { listSelectedBySequence: async () => [] },
    shotDialogue: { getSelectedBySequence: async () => [] },
    characters: { listWithSheets: async () => [], list: async () => [] },
    sequenceElements: { list: async () => [] },
    locations: { listWithReferences: async () => [] },
    apiKeys: {
      resolveKey: async () => ({
        key: 'mock-key',
        source: 'organization',
        via: 'fal',
      }),
    },
    sequence: () => ({ updateStatus }),
    sequenceVariants: { claimMusic, failMusicClaim: vi.fn() },
    billing: { zeroReservation, createReservation },
    organizationManagement: { getMemberEmail: async () => 'mock@mock.invalid' },
  });
  return {
    context: {
      promptLocale: 'en' as const,
      sequence,
      scopedDb,
      user: { id: 'mock-user' },
      organizationId: 'mock-organization',
    },
    updateStatus,
    claimMusic,
    zeroReservation,
    createReservation,
  };
}

describe('smart retry trusted model snapshots (mock data and final triggers)', () => {
  it.each(snapshotBranches)(
    'forwards the supplied snapshot to the real %s retry branch',
    async (branch) => {
      const { context, claimMusic, updateStatus } = mockContext([branch]);
      const onLaunched = vi.fn(async () => {});
      const result = await executeSmartRetry(context, {
        modelConfiguration: retryConfiguration,
        runKey: 'mock-approved-plan',
        onLaunched,
      });
      const trigger = branch === 'music' ? triggerMusic : triggerRun;
      expect(trigger).toHaveBeenCalledTimes(1);
      const call = trigger.mock.calls[0];
      expect(call?.[0]).toBe(branchPaths[branch]);
      expect(call?.[2]?.modelConfiguration).toBe(retryConfiguration);
      expect(captureConfiguration).not.toHaveBeenCalled();
      expect(result.retryType).toBe('smart');
      expect(updateStatus).toHaveBeenCalledExactlyOnceWith('completed');
      if (branch === 'music') {
        expect(claimMusic).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ ifPendingIs: null, isPrimary: true })
        );
        expect(call?.[1]).toMatchObject({
          variantId: 'mock-music-variant',
          reservationId: 'mock-reservation',
          ownsReservation: true,
        });
        expect(onLaunched).toHaveBeenCalledExactlyOnceWith('mock-music-run');
      } else {
        expect(call?.[2]?.deduplicationId).toBe('mock-approved-plan-' + branch);
        expect(onLaunched).toHaveBeenCalledExactlyOnceWith('mock-keyed-run');
      }
    }
  );

  it.each(snapshotBranches)(
    'leaves root capture available when %s has no supplied snapshot',
    async (branch) => {
      const { context } = mockContext([branch]);
      await executeSmartRetry(context, { runKey: 'mock-uncaptured-plan' });
      const trigger = branch === 'music' ? triggerMusic : triggerRun;
      expect(trigger).toHaveBeenCalledTimes(1);
      const call = trigger.mock.calls[0];
      expect(call?.[0]).toBe(branchPaths[branch]);
      expect(call?.[2]?.modelConfiguration).toBeUndefined();
      if (branch === 'music') expect(call).toHaveLength(2);
      expect(captureConfiguration).not.toHaveBeenCalled();
    }
  );

  it.each(['music', 'music-prompt'] as const)(
    'uses one supplied snapshot for all image, motion and %s roots',
    async (branch) => {
      const { context } = mockContext(['image', 'motion', branch]);
      const onLaunched = vi.fn(async () => {});
      await executeSmartRetry(context, {
        modelConfiguration: retryConfiguration,
        onLaunched,
      });
      const calls = [...triggerRun.mock.calls, ...triggerMusic.mock.calls];
      expect(calls.map(([path]) => path)).toEqual([
        '/image',
        '/motion-batch',
        branchPaths[branch],
      ]);
      for (const call of calls)
        expect(call[2]?.modelConfiguration).toBe(retryConfiguration);
      expect(captureConfiguration).not.toHaveBeenCalled();
      expect(onLaunched).toHaveBeenCalledTimes(3);
    }
  );

  it.each([true, false])(
    'preserves the image preparation snapshot (supplied=%s)',
    async (supplied) => {
      const { context } = mockContext(['image']);
      const options = supplied
        ? { modelConfiguration: retryConfiguration }
        : {};
      const preview = await executeSmartRetry(context, {
        ...options,
        dryRun: true,
      });
      const result = await executeSmartRetry(context, options);
      const expected = supplied ? retryConfiguration : currentConfiguration;
      expect(triggerRun).toHaveBeenCalledTimes(1);
      expect(triggerRun.mock.calls[0]?.[0]).toBe('/image');
      expect(triggerRun.mock.calls[0]?.[2]?.modelConfiguration).toBe(expected);
      expect(result.planned.estimateMicros).toBe(
        preview.planned.estimateMicros
      );
      expect(result.planned.estimateMicros).toBe(supplied ? 70000 : 210000);
      expect(captureConfiguration).toHaveBeenCalledTimes(supplied ? 0 : 2);
    }
  );

  it.each([true, false])(
    'preserves full storyboard snapshot precedence (supplied=%s)',
    async (supplied) => {
      const { context, updateStatus } = mockContext(['full']);
      const result = await executeSmartRetry(
        context,
        supplied ? { modelConfiguration: retryConfiguration } : {}
      );
      expect(result.retryType).toBe('full');
      expect(triggerStoryboard).toHaveBeenCalledTimes(1);
      expect(triggerStoryboard.mock.calls[0]?.[2]).toBe(
        supplied ? retryConfiguration : currentConfiguration
      );
      expect(captureConfiguration).toHaveBeenCalledTimes(supplied ? 0 : 1);
      expect(triggerRun).not.toHaveBeenCalled();
      expect(triggerMusic).not.toHaveBeenCalled();
      expect(updateStatus).not.toHaveBeenCalled();
    }
  );

  it.each(snapshotBranches)(
    'keeps supplied-snapshot %s dry-runs free of launch side effects',
    async (branch) => {
      const { context, claimMusic, updateStatus, createReservation } =
        mockContext([branch]);
      const onLaunched = vi.fn(async () => {});
      const result = await executeSmartRetry(context, {
        modelConfiguration: retryConfiguration,
        dryRun: true,
        onLaunched,
      });
      expect(result.retryType).toBe('smart');
      expect(triggerRun).not.toHaveBeenCalled();
      expect(triggerMusic).not.toHaveBeenCalled();
      expect(triggerStoryboard).not.toHaveBeenCalled();
      expect(reserveCredits).not.toHaveBeenCalled();
      expect(createReservation).not.toHaveBeenCalled();
      expect(claimMusic).not.toHaveBeenCalled();
      expect(updateStatus).not.toHaveBeenCalled();
      expect(onLaunched).not.toHaveBeenCalled();
      expect(captureConfiguration).not.toHaveBeenCalled();
    }
  );
});
