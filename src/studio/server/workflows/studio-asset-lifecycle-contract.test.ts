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
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StudioGenerationWorkflowInput } from '@/platform/server/workflow/types';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import type { CompatibleImageResult } from '@/stills/server/compatible-image-types';
import type { ImageVia } from '@/models/via';
import {
  contentProvenance,
  organization,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createProvenanceMethods } from '@/platform/server/db/scoped/compliance';
import { createGeneratedAssetsMethods } from '@/models/server/db/generated-assets';
import { createImageGenerationAttemptsMethods } from '@/stills/server/db/image-generation-attempts';
import {
  createImageModelRoutingSnapshot,
  usesConfiguredImageChannel,
} from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import {
  organizationKeyPrefix,
  STORAGE_BUCKETS,
} from '@/platform/server/storage/buckets';
import { micros, usdToMicros } from '@/billing/money';
import { sha256Hex } from '@/platform/compliance/hash';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';

const doubles = {
  supplier:
    vi.fn<
      typeof import('@/stills/server/compatible-image-client').generateCompatibleImages
    >(),
  native:
    vi.fn<
      typeof import('@/stills/server/image-generation').generateImageWithProvider
    >(),
  put: vi.fn<typeof import('#storage').uploadFile>(),
  debit:
    vi.fn<
      typeof import('@/billing/server/workflow-deduction').deductWorkflowCredits
    >(),
  usage:
    vi.fn<
      typeof import('@/billing/server/workflow-deduction').recordFalUsageStep
    >(),
  feed: vi.fn(),
  submitVideo:
    vi.fn<
      typeof import('@/studio/server/studio-video-generation').submitStudioVideoJob
    >(),
  pollVideo:
    vi.fn<
      typeof import('@/studio/server/studio-video-generation').pollStudioVideoJob
    >(),
  priceVideo:
    vi.fn<
      typeof import('@/studio/server/studio-video-generation').studioVideoCostFromUsage
    >(),
  videoVia: vi.fn(async () => 'fal'),
  observe: vi.fn(),
};

// The parent, configured adapter, upload helper, attempts and provenance SQL stay real.
vi.doMock('@/stills/server/compatible-image-client', () => ({
  generateCompatibleImages: doubles.supplier,
}));
vi.doMock('#storage', () => ({ uploadFile: doubles.put }));
vi.doMock('#env', () => ({ getEnv: () => ({}) }));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: doubles.debit,
  recordFalUsageStep: doubles.usage,
}));
vi.doMock('@/platform/server/observability/content-feed', () => ({
  captureStudioGenerationCompleted: doubles.feed,
}));
vi.doMock('@/studio/server/studio-video-generation', () => ({
  submitStudioVideoJob: doubles.submitVideo,
  pollStudioVideoJob: doubles.pollVideo,
  studioVideoCostFromUsage: doubles.priceVideo,
  arkStillsForStudio: () => [],
}));
vi.doMock('@/motion/server/motion-generation', () => ({
  resolveMotionVia: doubles.videoVia,
}));
vi.doMock('@/models/server/byteplus-asset-steps', () => ({
  ingestArkAssets: vi.fn(async () => ({})),
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  recordMediaGenerationSpan: doubles.observe,
}));
vi.doMock('@/stills/server/image-generation', async () => {
  const real = await vi.importActual<
    typeof import('@/stills/server/image-generation')
  >('@/stills/server/image-generation');
  return {
    ...real,
    generateImageWithProvider: (
      ...args: Parameters<typeof real.generateImageWithProvider>
    ) =>
      usesConfiguredImageChannel(
        args[0].model,
        args[1]?.credentials?.imageModelRouting
      )
        ? real.generateImageWithProvider(...args)
        : doubles.native(...args),
  };
});

const { StudioGenerationWorkflow } =
  await import('./studio-generation-workflow');
const MODEL = 'custom-image:qwen';
const PROMPT = 'Mock Studio original prompt 中文';
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const DATA_URL =
  'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64');
const NATIVE_COST = micros(15_000);
const NATIVE_VIAS = [
  'fal',
  'google',
  'xai',
  'byteplus',
] as const satisfies readonly ImageVia[];
let db: Database;
let closeDb: () => Promise<void>;

class StudioProbe extends StudioGenerationWorkflow {
  execute(
    event: WorkflowEvent<StudioGenerationWorkflowInput>,
    step: WorkflowStep,
    scope: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scope);
  }
  fail(
    event: WorkflowEvent<StudioGenerationWorkflowInput>,
    scope: WorkflowScopedDb
  ) {
    return this.onFailure({
      event,
      scopedDb: scope,
      error: 'Mock sanitized storage failure',
    });
  }
}

function workflow() {
  type Ctor = ConstructorParameters<typeof StudioProbe>;
  return new StudioProbe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function stepHarness() {
  const names: string[] = [];
  const checkpoints = new Map<string, unknown>();
  const step = asStub<WorkflowStep>({
    do: async (
      name: string,
      ...args: [() => Promise<unknown>] | [object, () => Promise<unknown>]
    ) => {
      names.push(name);
      if (checkpoints.has(name)) return structuredClone(checkpoints.get(name));
      const run = args.length === 1 ? args[0] : args[1];
      const result = await run();
      checkpoints.set(name, structuredClone(result));
      return result;
    },
  });
  return { step, names, checkpoints };
}

function supplierResult(
  count: number,
  requestedCount: number
): CompatibleImageResult {
  return {
    images: Array.from({ length: count }, () => ({
      dataUrl: DATA_URL,
      width: 1024,
      height: 1024,
      mimeType: 'image/png',
      byteLength: PNG_BYTES.length,
    })),
    requestedCount,
    actualCount: count,
    returnedCount: count,
    status: count === requestedCount ? 'complete' : 'partial',
    mismatches:
      count === requestedCount
        ? []
        : [
            {
              parameter: 'n',
              requested: requestedCount,
              actual: count,
              basis: 'count',
            },
          ],
    requestId: 'mock-configured-request',
    reported: {},
  };
}

function nativeResult(via: ImageVia): ImageGenerationResult {
  return {
    imageUrls: [DATA_URL],
    parameters: { model: 'nano_banana_2', prompt: PROMPT },
    generatedAt: new Date(0).toISOString(),
    processingTimeMs: 0,
    via,
    metadata: {
      prompt: PROMPT,
      model: 'nano_banana_2',
      endpointId: 'mock-native-endpoint',
      requestId: 'mock-native-request',
      cost: NATIVE_COST,
      usedOwnKey: false,
      dimensions: [{ width: 1024, height: 1024 }],
      file_sizes: [PNG_BYTES.length],
    },
  };
}

async function owner(configured: boolean, count = 1) {
  const userId = generateId();
  const organizationId = generateId();
  const runId = generateId();
  await db.insert(user).values({
    id: userId,
    name: 'Mock Studio writer',
    email: userId + '@example.invalid',
  });
  await db.insert(organization).values({
    id: organizationId,
    name: 'Mock Studio organization',
    slug: organizationId,
  });
  const assets = createGeneratedAssetsMethods(db, organizationId, userId);
  const attempts = createImageGenerationAttemptsMethods(db, organizationId);
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model');
  model.parameters.push({
    key: 'n',
    label: 'Count',
    type: 'integer',
    status: 'verified',
    operations: ['generate'],
    required: false,
    values: [1, 2],
  });
  const imageModelRouting = configured
    ? createImageModelRoutingSnapshot(configuration)
    : [];
  const row = await assets.insert({
    provider: configured ? 'compatible' : 'fal',
    activity: 'image',
    source: 'studio',
    endpointId: 'mock-queued-endpoint',
    modelName: 'Mock queued model',
    status: 'queued',
    input: {},
  });
  const event: WorkflowEvent<StudioGenerationWorkflowInput> = {
    workflowName: 'StudioGenerationWorkflow',
    instanceId: runId,
    timestamp: new Date(0),
    payload: {
      userId,
      organizationId,
      assetId: row.id,
      promptLocale: 'zh-CN',
      noPersonImages: [],
      reservationId: generateId(),
      input: {
        activity: 'image',
        prompt: PROMPT,
        imageModel: configured ? MODEL : 'nano_banana_2',
        aspectRatio: '1:1',
        resolution: '720p',
        count: 1,
        referenceImages: [],
        ...(configured ? { channelParameters: { n: count } } : {}),
      },
    },
  };
  const scope = asStub<WorkflowScopedDb>({
    bytePlusAssets: { releaseOwner: vi.fn(async () => undefined) },
    organizationId,
    generatedAssets: assets,
    provenance: createProvenanceMethods(db, organizationId, userId),
    models: { imageModelRouting },
    credentials: {
      organizationId,
      userId,
      imageModelRouting,
      resolveImageChannelKey: vi.fn(async () => 'mock-configured-key'),
      resolveOptionalKey: vi.fn(async () => ({
        key: 'mock-native-key',
        source: 'platform',
      })),
    },
    imageGenerationAttempts: attempts,
    claims: { imageGenerationAttempts: attempts },
    liveRead: {
      apiKeys: { hasUsableKey: vi.fn(async () => false) },
      billing: { hasEnoughCredits: vi.fn(async () => true) },
    },
  });
  return {
    assets,
    scope,
    event,
    organizationId,
    userId,
    assetId: row.id,
    runId,
  };
}

type Owner = Awaited<ReturnType<typeof owner>>;
async function assertStored(
  test: Owner,
  via: ImageVia,
  count: number,
  costMicros: number,
  activity = 'image'
) {
  const row = await test.assets.getById(test.assetId);
  expect(row).toMatchObject({
    status: 'completed',
    provider: via,
    costMicros,
    error: null,
  });
  expect(row?.outputs).toHaveLength(count);
  const keys = doubles.put.mock.calls.map((call) => call[0] + '/' + call[1]);
  expect(row?.outputs?.map((output) => output.url)).toEqual(
    keys.map((key) => '/r2/' + key)
  );
  const records = (await db.select().from(contentProvenance)).filter(
    (record) => record.organizationId === test.organizationId
  );
  expect(records).toHaveLength(count);
  expect(
    records
      .map((record) => record.storageKey)
      .sort((left, right) => String(left).localeCompare(String(right)))
  ).toEqual([...keys].sort());
  for (const record of records)
    expect(record).toMatchObject({
      assetId: test.assetId,
      userId: test.userId,
      provider: via,
      workflowRunId: test.runId,
      promptSha256: await sha256Hex(PROMPT),
    });
  expect(doubles.debit).toHaveBeenCalledWith(
    expect.objectContaining({
      costMicros,
      reservationId: test.event.payload.reservationId,
      idempotencyKey: `${test.runId}:studio-${activity}`,
    })
  );
  expect(doubles.feed).toHaveBeenCalledWith(
    expect.objectContaining({
      distinctId: test.userId,
      organizationId: test.organizationId,
      mediaUrl: row?.outputs?.[0]?.url,
    })
  );
  return records;
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  doubles.supplier.mockReset().mockResolvedValue(supplierResult(1, 1));
  doubles.native.mockReset().mockResolvedValue(nativeResult('fal'));
  doubles.usage.mockResolvedValue({ endpointId: 'mock-native-endpoint' });
  doubles.put.mockReset().mockImplementation(async (bucket, path, file) => {
    const body = file instanceof Uint8Array ? Uint8Array.from(file) : file;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (bucket === STORAGE_BUCKETS.THUMBNAILS) expect(bytes).toEqual(PNG_BYTES);
    return {
      path: bucket + '/' + path,
      publicUrl: '/r2/' + bucket + '/' + path,
      fullPath: bucket + '/' + path,
    };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected network in Studio parent contract');
    })
  );
});

describe('Studio parent stored-output contract', () => {
  it.each(NATIVE_VIAS)(
    'overwrites queue-time fal with actual %s for completion and provenance',
    async (via) => {
      const test = await owner(false);
      doubles.native.mockResolvedValueOnce(nativeResult(via));
      await workflow().execute(test.event, stepHarness().step, test.scope);
      const records = await assertStored(test, via, 1, NATIVE_COST);
      expect(records[0]).toMatchObject({
        model: 'mock-native-endpoint',
        providerRequestId: 'mock-native-request',
      });
      expect(doubles.usage).toHaveBeenCalledTimes(via === 'fal' ? 1 : 0);
      expect(doubles.supplier).not.toHaveBeenCalled();
      expect(doubles.put.mock.calls[0]?.[1]).toBe(
        `${organizationKeyPrefix(test.organizationId)}/studio/${test.assetId}/image.png`
      );
    }
  );

  it.each([1, 2])(
    'records, charges and publishes the actual %i stored configured outputs',
    async (count) => {
      const test = await owner(true, 2);
      doubles.supplier.mockResolvedValueOnce(supplierResult(count, 2));
      const steps = stepHarness();
      await workflow().execute(test.event, steps.step, test.scope);
      const records = await assertStored(
        test,
        'compatible',
        count,
        usdToMicros(0.1 * count)
      );
      expect(
        records.every(
          (record) =>
            record.model === 'mock-generate' &&
            record.providerRequestId === 'mock-configured-request'
        )
      ).toBe(true);
      expect(doubles.debit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            configuredPricing: expect.objectContaining({
              imageCount: count,
              requestedCount: 2,
            }),
          }),
        })
      );
      expect(doubles.supplier).toHaveBeenCalledWith(
        expect.objectContaining({
          upstreamModel: 'mock-generate',
          prompt: PROMPT,
          parameters: expect.objectContaining({ n: 2 }),
        })
      );
      expect(doubles.native).not.toHaveBeenCalled();
      expect(doubles.usage).not.toHaveBeenCalled();
      expect(doubles.put.mock.calls.map((call) => call[1])).toEqual(
        Array.from(
          { length: count },
          (_unused, index) =>
            `${organizationKeyPrefix(test.organizationId)}/studio/${test.assetId}/image-${index}.png`
        )
      );
      expect(steps.names.indexOf('generate-image')).toBeLessThan(
        steps.names.indexOf('deduct-credits')
      );
      expect(steps.names.indexOf('record-provenance')).toBeLessThan(
        steps.names.indexOf('persist-result')
      );
    }
  );

  it.each(NATIVE_VIAS)(
    'records the full video R2 key and actual %s provider',
    async (via) => {
      const test = await owner(false);
      const event: WorkflowEvent<StudioGenerationWorkflowInput> = {
        ...test.event,
        payload: {
          ...test.event.payload,
          input: {
            activity: 'video',
            prompt: PROMPT,
            videoModel: 'seedance_v2',
            aspectRatio: '16:9',
            resolution: '720p',
            duration: 5,
            count: 1,
            mode: 'text',
            referenceImages: [],
            referenceVideos: [],
            referenceAudio: [],
          },
        },
      };
      doubles.videoVia.mockResolvedValueOnce(via);
      doubles.submitVideo.mockResolvedValueOnce({
        jobId: 'mock-video-request',
        modelKey: 'seedance_v2',
        endpointId: 'mock-video-endpoint',
        via,
        usedOwnKey: false,
        threadId: 'mock-video-thread',
      });
      doubles.pollVideo.mockResolvedValueOnce({
        jobId: 'mock-video-request',
        status: 'completed',
        url: 'https://mock.invalid/clip.mp4',
      });
      doubles.priceVideo.mockResolvedValueOnce({
        endpointId: 'mock-video-endpoint',
        unitsBilled: undefined,
        billedUnit: undefined,
        cost: NATIVE_COST,
        recordFalUsage: false,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('Mock streamed video', {
              headers: { 'content-type': 'video/mp4' },
            })
        )
      );
      await workflow().execute(event, stepHarness().step, test.scope);
      const records = await assertStored(
        { ...test, event },
        via,
        1,
        NATIVE_COST,
        'video'
      );
      expect(records[0]).toMatchObject({
        model: 'mock-video-endpoint',
        providerRequestId: 'mock-video-request',
      });
      expect(doubles.put.mock.calls[0]?.[0]).toBe(STORAGE_BUCKETS.VIDEOS);
      expect(doubles.put.mock.calls[0]?.[1]).toBe(
        organizationKeyPrefix(test.organizationId) +
          '/studio/' +
          test.assetId +
          '/video.mp4'
      );
      expect(doubles.submitVideo).toHaveBeenCalledOnce();
      expect(doubles.pollVideo).toHaveBeenCalledWith(
        expect.objectContaining({ via }),
        test.scope.credentials
      );
    }
  );

  it('replays completed parent checkpoints without another supplier call, debit or provenance row', async () => {
    const test = await owner(true, 2);
    doubles.supplier.mockResolvedValueOnce(supplierResult(2, 2));
    const steps = stepHarness();
    const first = await workflow().execute(test.event, steps.step, test.scope);
    const second = await workflow().execute(test.event, steps.step, test.scope);
    expect(second).toEqual(first);
    await assertStored(test, 'compatible', 2, usdToMicros(0.2));
    expect(doubles.supplier).toHaveBeenCalledOnce();
    expect(doubles.put).toHaveBeenCalledTimes(2);
    expect(doubles.debit).toHaveBeenCalledOnce();
    expect(doubles.feed).toHaveBeenCalledOnce();
  });

  it('does not debit, complete, or publish when a configured output fails to store', async () => {
    const test = await owner(true, 2);
    doubles.supplier.mockResolvedValueOnce(supplierResult(2, 2));
    doubles.put
      .mockImplementationOnce(async (bucket, path) => ({
        path: bucket + '/' + path,
        publicUrl: '/r2/' + bucket + '/' + path,
        fullPath: bucket + '/' + path,
      }))
      .mockRejectedValueOnce(new Error('Mock R2 second write failure'));
    await expect(
      workflow().execute(test.event, stepHarness().step, test.scope)
    ).rejects.toThrow('Image channel generation or storage failed');
    expect(doubles.put).toHaveBeenCalledTimes(2);
    expect(doubles.debit).not.toHaveBeenCalled();
    expect(doubles.feed).not.toHaveBeenCalled();
    await workflow().fail(test.event, test.scope);
    expect(await test.assets.getById(test.assetId)).toMatchObject({
      status: 'failed',
      provider: 'compatible',
      outputs: null,
      costMicros: null,
    });
    expect(
      (await db.select().from(contentProvenance)).filter(
        (record) => record.organizationId === test.organizationId
      )
    ).toEqual([]);
  });
});
