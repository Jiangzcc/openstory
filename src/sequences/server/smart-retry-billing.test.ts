import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import type { TextToImageModel } from '@/models/models';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { Sequence } from '@/platform/server/db/schema';
import type {
  ImageWorkflowInput,
  StoryboardTriggerInput,
} from '@/platform/server/workflow/types';
import { credits, organization, user } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';
import { micros } from '@/billing/money';

const MOCK_IMAGE_MODEL = 'custom-image:qwen';
const MOCK_IMAGE_COST = micros(70000);
const mockRoutes = createImageModelRoutingSnapshot(
  imageConfigurationFixture()
).map((route) => ({
  ...route,
  priceCards: route.priceCards.map((card) => ({ ...card, unitPriceUsd: 0.07 })),
}));
let mockConfiguration: ModelRuntimeConfiguration;
let requiresFullRetry = false;
const keyedTrigger = vi.fn(
  async (_path: string, _input: ImageWorkflowInput) => ({
    workflowRunId: 'mock-live-image-run',
    reused: false,
  })
);
const storyboardTrigger = vi.fn(
  async (_db: ScopedDb, _input: StoryboardTriggerInput) => ({
    workflowRunId: 'mock-live-board-run',
  })
);

vi.doMock('@/platform/realtime', () => ({
  getBillingChannel: () => ({ emit: async () => {} }),
}));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: vi.fn(),
  triggerWorkflowRun: keyedTrigger,
}));
vi.doMock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: async () => mockConfiguration,
}));
vi.doMock('@/platform/server/db/scoped-workflow', () => ({
  toWorkflowScopedDb: (db: WorkflowScopedDb) => db,
}));
vi.doMock('@/sequences/server/launchers', () => ({
  assertNoActiveStoryboard: async () => {},
  loadStoryboardModelConfiguration: async () => mockConfiguration,
  resolveStoryboardLlmSources: async () => ['platform'],
  triggerStoryboard: storyboardTrigger,
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => ({
    'fal-ai/nano-banana-2': {
      unitPrice: MOCK_IMAGE_COST,
      unit: 'images',
      typicalUnitsPerCall: 1,
    },
  }),
}));
vi.doMock('@/sequences/failure-analysis', () => ({
  analyzeFailures: () => ({ hasFailed: true, requiresFullRetry }),
}));
vi.doMock('@/sequences/server/notify-sequence-ready', () => ({
  notifySequenceReady: vi.fn(),
  sequenceScenesUrl: (id: string) => id,
}));
vi.doMock('@/shots/server/scene-script', () => ({
  loadSceneContextBySequence: async () => new Map(),
  resolveSceneForShot: () => ({
    scene: {
      originalScript: { extract: 'Mock prompt' },
      continuity: { characterTags: [] },
    },
  }),
}));
vi.doMock('@/shots/server/shot-dialogue', () => ({
  loadShotDialogueLines: async () => new Map(),
  shotDialogueResolver: () => () => null,
  loadVoiceMovedShotIds: async () => new Set(),
  snapshotBatchDialogue: vi.fn(),
}));
vi.doMock('@/shots/shot-view', () => ({
  toShotView: (shot: { id: string }, frame: { id: string }) => ({
    ...shot,
    frame,
    imageStatus: 'failed',
    imagePromptVersion: { text: 'Mock prompt', id: 'mock-prompt' },
    videoStatus: 'completed',
    motionPrompt: null,
    image: null,
  }),
}));

const { createBillingMethods } = await import('@/billing/server/db/billing');
const { executeSmartRetry } = await import('./smart-retry');
let fixture: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  fixture = await createTestDb();
});
afterAll(async () => {
  await fixture.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  keyedTrigger
    .mockReset()
    .mockResolvedValue({ workflowRunId: 'mock-live-image-run', reused: false });
  storyboardTrigger
    .mockReset()
    .mockResolvedValue({ workflowRunId: 'mock-live-board-run' });
  mockConfiguration = {
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: mockRoutes,
  };
  requiresFullRetry = false;
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Retry billing regressions forbid provider and network requests.')
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function billingWithBalance(balance = 2 * MOCK_IMAGE_COST) {
  const organizationId = generateId();
  const userId = generateId();
  await fixture.db.insert(organization).values({
    id: organizationId,
    name: 'Mock retry organization',
    slug: organizationId,
  });
  await fixture.db
    .insert(user)
    .values({ id: userId, name: 'Mock user', email: userId + '@mock.invalid' });
  await fixture.db.insert(credits).values({ organizationId, balance });
  return {
    organizationId,
    userId,
    billing: createBillingMethods(fixture.db, organizationId, userId),
  };
}

async function noVersions() {
  return new Map();
}

function mockImageRows(shotId: string, model: TextToImageModel) {
  return {
    frames: {
      listAnchorsBySequence: async () => [{ id: 'mock-frame', shotId }],
    },
    frameVariants: {
      getSelectedByFrameIds: noVersions,
      getPrimaryByFrameIds: noVersions,
      listSelectedModelsBySequence: noVersions,
      listLastFailedModelsBySequence: async () => new Map([[shotId, model]]),
    },
    framePromptVersions: { getSelectedByFrameIds: noVersions },
    videoVariants: {
      getSelectedByShotIds: noVersions,
      getPrimaryByShotIds: noVersions,
      listSelectedModelsBySequence: noVersions,
      listLastFailedModelsBySequence: noVersions,
    },
    shotPromptVersions: { getSelectedMotionByShots: noVersions },
  };
}

function mockContext(
  wallet: Awaited<ReturnType<typeof billingWithBalance>>,
  model: TextToImageModel = MOCK_IMAGE_MODEL
) {
  const shot = { id: generateId(), sceneId: 'mock-scene' };
  const sequence = asStub<Sequence>({
    id: generateId(),
    status: 'completed',
    imageModel: model,
    aspectRatio: '16:9',
    resolution: '720p',
    generateStartFrames: true,
    generateVoices: false,
    generationStopAt: 'images',
    musicStatus: 'completed',
    musicPrompt: 'Mock music',
    script: 'A mock scene.',
    analysisModel: 'google/gemini-3-flash-preview',
    includeMusic: false,
  });
  const scopedDb = asStub<ScopedDb>({
    ...mockImageRows(shot.id, model),
    billing: wallet.billing,
    apiKeys: { hasUsableKey: async () => false },
    shots: {
      listBySequence: async () => [shot],
      ensureAnchorFrames: async () => {},
    },
    characters: { listWithSheets: async () => [] },
  });
  return {
    scopedDb,
    sequence,
    user: { id: wallet.userId },
    organizationId: wallet.organizationId,
  };
}

function imageReservationId(index: number) {
  const id = keyedTrigger.mock.calls[index]?.[1].reservationId;
  if (!id) throw new Error('Mock image did not receive a reservation.');
  return id;
}

function deferredMockTrigger() {
  const state: { resolve?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    state.resolve = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (!state.resolve) throw new Error('Mock trigger was not initialized.');
      state.resolve();
    },
  };
}

describe('smart image retry reservation ownership with real in-memory D1', () => {
  it('reserves the selected tier using the same route as its dry-run and image payload', async () => {
    const route = mockConfiguration.imageModelRouting?.[0];
    if (!route) throw new Error('Missing mock resolution route.');
    mockConfiguration = {
      ...mockConfiguration,
      imageModelRouting: [
        {
          ...route,
          parameters: route.parameters.map((parameter) => ({
            ...parameter,
            defaultValue: '1280x720',
            values: ['1280x720', '1920x1080'],
          })),
          priceCards: route.priceCards.flatMap((card) => [
            {
              ...card,
              id: card.id + '-720',
              match: { size: '1280x720' },
              unitPriceUsd: 0.1,
            },
            {
              ...card,
              id: card.id + '-1080',
              match: { size: '1920x1080' },
              unitPriceUsd: 0.2,
            },
          ]),
        },
      ],
    };
    const wallet = await billingWithBalance(400000);
    const context = mockContext(wallet);
    context.sequence.resolution = '1080p';
    const preview = await executeSmartRetry(context, { dryRun: true });
    expect(preview.planned.estimateMicros).toBe(200000);
    expect(await wallet.billing.getAvailable()).toMatchObject({ reserved: 0 });
    await executeSmartRetry(context, { runKey: 'mock-resolution-retry' });
    expect(keyedTrigger).toHaveBeenCalledWith(
      '/image',
      expect.objectContaining({ resolution: '1080p', numImages: 1 }),
      expect.objectContaining({ modelConfiguration: mockConfiguration })
    );
    expect(await wallet.billing.getAvailable()).toMatchObject({
      reserved: 200000,
    });
    expect(
      await wallet.billing.growReservation(imageReservationId(0), micros(0))
    ).toMatchObject({ remaining: 200000 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps a captured retry price when the current channel is repriced after its dry-run', async () => {
    const frozen = mockConfiguration;
    const wallet = await billingWithBalance();
    const context = mockContext(wallet);
    const preview = await executeSmartRetry(context, {
      dryRun: true,
      modelConfiguration: frozen,
    });
    expect(preview.planned.estimateMicros).toBe(MOCK_IMAGE_COST);
    mockConfiguration = {
      ...frozen,
      imageModelRouting: frozen.imageModelRouting?.map((route) => ({
        ...route,
        priceCards: route.priceCards.map((card) => ({
          ...card,
          unitPriceUsd: 1,
        })),
      })),
    };
    await executeSmartRetry(context, {
      runKey: 'mock-captured-retry',
      modelConfiguration: frozen,
    });
    expect(await wallet.billing.getAvailable()).toMatchObject({
      reserved: MOCK_IMAGE_COST,
    });
    expect(keyedTrigger).toHaveBeenCalledWith(
      '/image',
      expect.anything(),
      expect.objectContaining({ modelConfiguration: frozen })
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps the original hold when a stable replay fails before its trigger', async () => {
    const wallet = await billingWithBalance();
    const context = mockContext(wallet);
    await executeSmartRetry(context, { runKey: 'mock-approved-plan' });
    const originalId = imageReservationId(0);
    const failure = new Error('Mock transient compliance lookup failure');
    keyedTrigger.mockRejectedValueOnce(failure);
    await expect(
      executeSmartRetry(context, { runKey: 'mock-approved-plan' })
    ).rejects.toBe(failure);
    expect(imageReservationId(1)).toBe(originalId);
    expect(
      await wallet.billing.growReservation(originalId, micros(0))
    ).toMatchObject({ remaining: MOCK_IMAGE_COST });
    expect(
      await wallet.billing.createReservation(micros(2 * MOCK_IMAGE_COST), {
        idempotencyKey: 'mock-oversized-competitor',
      })
    ).toEqual({ ok: false });
    const competing = await wallet.billing.createReservation(MOCK_IMAGE_COST, {
      idempotencyKey: 'mock-independent-run',
    });
    expect(competing.ok).toBe(true);
    expect(
      await wallet.billing.captureReservation(originalId, MOCK_IMAGE_COST, {
        idempotencyKey: 'mock-original:image',
      })
    ).toMatchObject({
      ok: true,
      captured: MOCK_IMAGE_COST,
      skippedDeltaMicros: undefined,
    });
    expect(
      (await wallet.billing.getTransactionHistory()).transactions
    ).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('protects a shared hold while the first trigger is still awaiting acknowledgement', async () => {
    const wallet = await billingWithBalance();
    const context = mockContext(wallet);
    const started = deferredMockTrigger();
    const acknowledge = deferredMockTrigger();
    keyedTrigger.mockImplementationOnce(async () => {
      started.resolve();
      await acknowledge.promise;
      return { workflowRunId: 'mock-live-image-run', reused: false };
    });
    const first = executeSmartRetry(context, {
      runKey: 'mock-concurrent-plan',
    });
    await started.promise;
    const failure = new Error('Mock duplicate trigger lookup failure');
    keyedTrigger.mockRejectedValueOnce(failure);
    try {
      await expect(
        executeSmartRetry(context, { runKey: 'mock-concurrent-plan' })
      ).rejects.toBe(failure);
      expect(imageReservationId(1)).toBe(imageReservationId(0));
      expect(await wallet.billing.getAvailable()).toMatchObject({
        reserved: MOCK_IMAGE_COST,
      });
    } finally {
      acknowledge.resolve();
    }
    await first;
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reuses the original hold after a successful duplicate trigger', async () => {
    const wallet = await billingWithBalance();
    const context = mockContext(wallet);
    await executeSmartRetry(context, { runKey: 'mock-approved-plan' });
    keyedTrigger.mockResolvedValueOnce({
      workflowRunId: 'mock-live-image-run',
      reused: true,
    });
    await executeSmartRetry(context, { runKey: 'mock-approved-plan' });
    expect(imageReservationId(1)).toBe(imageReservationId(0));
    expect(await wallet.billing.getAvailable()).toMatchObject({
      reserved: MOCK_IMAGE_COST,
      available: MOCK_IMAGE_COST,
    });
  });

  it.each([undefined, 'mock-new-plan'])(
    'releases a newly created hold when its first trigger fails (key=%s)',
    async (runKey) => {
      const wallet = await billingWithBalance();
      const failure = new Error('Mock first trigger failure');
      keyedTrigger.mockRejectedValueOnce(failure);
      await expect(
        executeSmartRetry(mockContext(wallet), { runKey })
      ).rejects.toBe(failure);
      expect(await wallet.billing.getAvailable()).toMatchObject({
        reserved: 0,
        available: 2 * MOCK_IMAGE_COST,
      });
    }
  );

  it.each([false, true])(
    'keeps ordinary fresh-hold cleanup when reused=%s',
    async (reused) => {
      const wallet = await billingWithBalance();
      mockConfiguration = {
        ...DEFAULT_MODEL_CONFIGURATION,
        imageModelRouting: [],
      };
      const context = mockContext(wallet, 'nano_banana_2');
      await executeSmartRetry(context, { runKey: 'mock-native-plan' });
      const originalId = imageReservationId(0);
      const second = executeSecondUnboundRetry(context, reused);
      await second;
      expect(imageReservationId(1)).not.toBe(originalId);
      expect(await wallet.billing.getAvailable()).toMatchObject({
        reserved: MOCK_IMAGE_COST,
        available: MOCK_IMAGE_COST,
      });
    }
  );

  it('gives a non-deduplicated full retry an independent hold and cleans only its failed trigger', async () => {
    const wallet = await billingWithBalance(100000000);
    const context = mockContext(wallet);
    requiresFullRetry = true;
    await executeSmartRetry(context, { runKey: 'mock-full-plan' });
    const originalId = storyboardTrigger.mock.calls[0]?.[1].reservationId;
    if (!originalId) throw new Error('Mock full retry needs a reservation.');
    const before = await wallet.billing.growReservation(originalId, micros(0));
    const failure = new Error('Mock storyboard mutex refusal');
    storyboardTrigger.mockRejectedValueOnce(failure);
    await expect(
      executeSmartRetry(context, { runKey: 'mock-full-plan' })
    ).rejects.toBe(failure);
    expect(storyboardTrigger.mock.calls[1]?.[1].reservationId).not.toBe(
      originalId
    );
    expect(await wallet.billing.growReservation(originalId, micros(0))).toEqual(
      before
    );
  });
});

async function executeSecondUnboundRetry(
  context: ReturnType<typeof mockContext>,
  reused: boolean
) {
  if (reused) {
    keyedTrigger.mockResolvedValueOnce({
      workflowRunId: 'mock-live-image-run',
      reused: true,
    });
    await executeSmartRetry(context, { runKey: 'mock-native-plan' });
    return;
  }
  const failure = new Error('Mock unbound trigger failure');
  keyedTrigger.mockRejectedValueOnce(failure);
  await expect(
    executeSmartRetry(context, { runKey: 'mock-native-plan' })
  ).rejects.toBe(failure);
}
