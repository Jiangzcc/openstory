import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { UpscaleShotVariantWorkflowInput } from '@/platform/server/workflow/types';
import type { ImageGenerationResult } from '../image-generation';
import type { ImageModelRoutingSnapshot } from '@/models/image-channels';
import type {
  ImageAttemptIdentity,
  ImageGenerationAttempt,
  StoredChannelGeneration,
} from '../configured-image-attempt';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { frameFixture, frameVariantFixture } from '@/mocks/frame-fixtures';
import { usdToMicros } from '@/billing/money';
import { asStub } from '@/test/as-stub';

type Generate = typeof import('../image-generation').generateImageWithProvider;
type Upload = typeof import('../image-storage').uploadImageToStorage;
const mocks = vi.hoisted(() => ({
  generate: vi.fn<Generate>(),
  upload: vi.fn<Upload>(),
  requireCredits: vi.fn(async () => undefined),
  deduct: vi.fn(async () => undefined),
  recordFal: vi.fn(async () => ({ requestId: 'mock-fal-request' })),
  provenance: vi.fn(async () => undefined),
  emit: vi.fn(async () => undefined),
}));
vi.mock('../image-generation', () => ({
  generateImageWithProvider: mocks.generate,
}));
vi.mock('../image-storage', () => ({ uploadImageToStorage: mocks.upload }));
vi.mock('@/billing/server/preflight', () => ({
  requireCredits: mocks.requireCredits,
}));
vi.mock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: mocks.deduct,
  recordFalUsageStep: mocks.recordFal,
}));
vi.mock('@/platform/server/compliance/provenance', () => ({
  recordProvenance: mocks.provenance,
}));
vi.mock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: mocks.emit }),
}));
import { UpscaleShotVariantWorkflow } from './upscale-shot-variant-workflow';

const MODEL_ID = 'custom-image:qwen';
const MOCK_INLINE_IMAGE = 'data:image/png;base64,bW9jay1pbWFnZQ==';
const STORED_IMAGE = {
  url: '/r2/mock-upscale/result.png',
  path: 'mock-upscale/result.png',
  contentType: 'image/png',
};
const COST = usdToMicros(0.2);
const PAYLOAD = {
  userId: 'mock-user',
  organizationId: 'mock-org',
  sequenceId: 'mock-sequence',
  shotId: 'mock-shot',
  frameId: 'mock-frame',
  versionId: 'mock-version',
  promptVersionId: null,
  croppedTileUrl: '/r2/mock-upscale/tile.png',
  croppedTilePath: 'mock-upscale/tile.png',
  sourceModel: MODEL_ID,
  aspectRatio: '16:9',
  reservationId: 'mock-reservation',
} satisfies UpscaleShotVariantWorkflowInput;
const EVENT: WorkflowEvent<UpscaleShotVariantWorkflowInput> = {
  payload: PAYLOAD,
  instanceId: 'mock-run',
  workflowName: 'upscale',
  timestamp: new Date(0),
};
class Probe extends UpscaleShotVariantWorkflow {
  execute(step: WorkflowStep, scopedDb: WorkflowScopedDb) {
    return this.runImpl(EVENT, step, scopedDb);
  }
}
function workflow() {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}
function imageResult(params: Parameters<Generate>[0]): ImageGenerationResult {
  return {
    imageUrls: [MOCK_INLINE_IMAGE],
    parameters: params,
    via: 'compatible',
    generatedAt: new Date(0).toISOString(),
    processingTimeMs: 1,
    metadata: {
      prompt: params.prompt,
      model: params.model,
      endpointId: 'mock-edit',
      dimensions: [{ width: 1024, height: 576 }],
      file_sizes: [10],
      cost: COST,
      usedOwnKey: false,
      requestId: 'mock-channel-request',
      configuredPricing: {
        priceCardId: 'edit',
        unitPriceUsd: 0.2,
        imageCount: 1,
        requestedCount: 1,
      },
    },
  };
}
function makeStep() {
  const values = new Map<string, unknown>();
  let activeStep: string | undefined;
  async function doStep(
    name: string,
    options: object | (() => Promise<unknown>),
    callback?: () => Promise<unknown>
  ) {
    if (values.has(name)) return values.get(name);
    const execute = typeof options === 'function' ? options : callback;
    if (!execute) throw new Error('Mock workflow step has no callback.');
    activeStep = name;
    try {
      const result = await execute();
      values.set(name, result);
      return result;
    } finally {
      activeStep = undefined;
    }
  }
  return {
    values,
    active: () => activeStep,
    step: asStub<WorkflowStep>({ do: doStep }),
  };
}
function attemptDb() {
  const attempts = new Map<string, ImageGenerationAttempt>();
  const claim = vi.fn(async (identity: ImageAttemptIdentity) => {
    const attempt = { ...identity, status: 'submitted' as const };
    attempts.set(identity.id, attempt);
    return { claimed: true, attempt };
  });
  const complete = vi.fn(
    async (identity: ImageAttemptIdentity, result: StoredChannelGeneration) => {
      attempts.set(identity.id, { ...identity, status: 'stored', result });
    }
  );
  return {
    claim,
    complete,
    markUnknown: vi.fn(),
    getById: async (identity: ImageAttemptIdentity) =>
      attempts.get(identity.id) ?? null,
  };
}
function harness(
  routing: ImageModelRoutingSnapshot = createImageModelRoutingSnapshot(
    imageConfigurationFixture()
  )
) {
  const execution = makeStep();
  const attempts = attemptDb();
  const version = frameVariantFixture({
    id: PAYLOAD.versionId,
    frameId: PAYLOAD.frameId,
    sequenceId: PAYLOAD.sequenceId,
    model: MODEL_ID,
  });
  const frame = frameFixture({
    id: PAYLOAD.frameId,
    shotId: PAYLOAD.shotId,
    sequenceId: PAYLOAD.sequenceId,
  });
  const scopedDb = asStub<WorkflowScopedDb>({
    models: { ...DEFAULT_MODEL_CONFIGURATION, imageModelRouting: routing },
    credentials: {
      organizationId: PAYLOAD.organizationId,
      imageModelRouting: routing,
    },
    claims: {
      frameVariants: { getById: async () => version },
      imageGenerationAttempts: { getById: attempts.getById },
    },
    frameVariants: {
      update: vi.fn(async () => version),
      selectIfPendingPromoteIs: vi.fn(async () => version),
    },
    imageGenerationAttempts: {
      claim: attempts.claim,
      complete: attempts.complete,
      markUnknown: attempts.markUnknown,
    },
    liveRead: { frames: { getById: async () => frame } },
    provenance: {},
  });
  mocks.generate.mockImplementation(async (params) => {
    expect(execution.active()).toBe('upscale-image');
    return imageResult(params);
  });
  mocks.upload.mockImplementation(async () => {
    expect(execution.active()).toBe('upscale-image');
    return STORED_IMAGE;
  });
  return { ...execution, attempts, scopedDb };
}
beforeEach(() => vi.clearAllMocks());

describe('configured grid tile upscale', () => {
  it('preserves the model and tracks generation with R2 storage before the step checkpoint', async () => {
    const run = harness();
    expect(await workflow().execute(run.step, run.scopedDb)).toEqual({
      upscaledUrl: STORED_IMAGE.url,
      upscaledPath: STORED_IMAGE.path,
    });
    expect(run.attempts.claim).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mock-run:upscale-image', model: MODEL_ID })
    );
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL_ID,
        referenceImageUrls: [PAYLOAD.croppedTileUrl],
        numImages: 1,
      }),
      {
        credentials: run.scopedDb.credentials,
        configuredAttemptId: 'mock-run:upscale-image',
      }
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: MOCK_INLINE_IMAGE })
    );
    expect(run.attempts.complete).toHaveBeenCalledOnce();
    expect(JSON.stringify([...run.values.values()])).not.toContain(
      MOCK_INLINE_IMAGE
    );
    expect(mocks.recordFal).not.toHaveBeenCalled();
    expect(mocks.deduct).toHaveBeenCalledWith(
      expect.objectContaining({
        costMicros: COST,
        reservationId: PAYLOAD.reservationId,
        metadata: expect.objectContaining({
          model: MODEL_ID,
          configuredPricing: expect.objectContaining({ priceCardId: 'edit' }),
        }),
      })
    );
    expect(mocks.provenance).toHaveBeenCalledWith(
      run.scopedDb.provenance,
      expect.objectContaining({
        provider: 'compatible',
        model: MODEL_ID,
        providerRequestId: 'mock-channel-request',
      })
    );
  });
  it('replays the stored step without submitting or storing the image again', async () => {
    const run = harness();
    await workflow().execute(run.step, run.scopedDb);
    await workflow().execute(run.step, run.scopedDb);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.deduct).toHaveBeenCalledOnce();
    expect(run.attempts.claim).toHaveBeenCalledOnce();
  });
  it.each(['unverified', 'unsupported'] as const)(
    'fails a %s edit capability without any provider fallback',
    async (status) => {
      const configuration = imageConfigurationFixture();
      for (const model of configuration.models)
        if (model.operations.edit) model.operations.edit.status = status;
      const run = harness(createImageModelRoutingSnapshot(configuration));
      await expect(workflow().execute(run.step, run.scopedDb)).rejects.toThrow(
        'verified image editing'
      );
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(run.attempts.claim).not.toHaveBeenCalled();
    }
  );
  it('fails an absent frozen route without changing to a built-in model', async () => {
    const run = harness([]);
    await expect(workflow().execute(run.step, run.scopedDb)).rejects.toThrow(
      'Configured image model is unavailable.'
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('rejects a missing edit price card before submission', async () => {
    const configuration = imageConfigurationFixture();
    for (const model of configuration.models)
      model.priceCards = model.priceCards.filter(
        (card) => card.operation !== 'edit'
      );
    const run = harness(createImageModelRoutingSnapshot(configuration));
    await expect(workflow().execute(run.step, run.scopedDb)).rejects.toThrow();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(run.attempts.claim).not.toHaveBeenCalled();
    expect(mocks.deduct).not.toHaveBeenCalled();
  });
});
