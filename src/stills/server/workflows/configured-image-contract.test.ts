import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';
import { usdToMicros } from '@/billing/money';
import type { Microdollars } from '@/billing/money';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { STORAGE_BUCKETS } from '@/platform/server/storage/buckets';
import { runConfiguredStudioImageStep } from '@/studio/server/configured-studio-image-step';
import type { StudioRunInput } from '@/studio/schema';
import type {
  ImageWorkflowInput,
  StudioGenerationWorkflowInput,
} from '@/platform/server/workflow/types';
import { uploadImageFromUrl, storeGeneratedPng } from '../image-storage';
import type {
  CompatibleImageInput,
  CompatibleImageResult,
} from '../compatible-image-types';
import type { ImageGenerationResult } from '../image-generation';
import { runConfiguredImageStep } from './configured-image-step';
import type { ConfiguredImageStepInput } from './configured-image-step';
import { generateImageSoftening } from './content-soften';
import { generateImageWithContentRetry } from './soften-image-prompt';

const { supplierCall, putObject } = vi.hoisted(() => ({
  supplierCall:
    vi.fn<(input: CompatibleImageInput) => Promise<CompatibleImageResult>>(),
  putObject: vi.fn<typeof import('#storage').uploadFile>(),
}));

// Only the paid provider, R2 boundary, credentials and wallet are substituted.
vi.mock('../compatible-image-client', () => ({
  generateCompatibleImages: supplierCall,
}));
vi.mock('#storage', () => ({ uploadFile: putObject }));
vi.mock('#env', () => ({ getEnv: () => ({}) }));

const MODEL = 'custom-image:qwen';
const PROMPT = 'Mock GC-10 cross-layer image request';
const SECRET = 'mock-g10-image-key';
const STEP_NAME = 'generate-image';
const UNIT_PRICE_USD = 0.1;
const IMAGE_EDGE = 1024;
const CHECKPOINT_LIMIT_BYTES = 1_048_576;
const LARGE_IMAGE_BYTES = CHECKPOINT_LIMIT_BYTES + 8;
const MOCK_PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ABORT_MESSAGES = [
  'Aborting engine: Grace period complete',
  'Durable Object reset because its code was updated',
] as const;
const stepContext = new AsyncLocalStorage<string>();
const writes: { path: string; bytes: Uint8Array; step: string | undefined }[] =
  [];

function supplierResult(
  count = 1,
  requestedCount = count,
  byteLength = MOCK_PNG_SIGNATURE.length
): CompatibleImageResult {
  const bytes = new Uint8Array(byteLength);
  bytes.set(MOCK_PNG_SIGNATURE);
  const dataUrl =
    'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
  return {
    images: Array.from({ length: count }, () => ({
      dataUrl,
      width: IMAGE_EDGE,
      height: IMAGE_EDGE,
      mimeType: 'image/png',
      byteLength,
    })),
    requestedCount,
    actualCount: count,
    returnedCount: count,
    status: count < requestedCount ? 'partial' : 'complete',
    mismatches:
      count < requestedCount
        ? [
            {
              parameter: 'n',
              requested: requestedCount,
              actual: count,
              basis: 'count',
            },
          ]
        : [],
    requestId: 'mock-g10-supplier-request',
    reported: {},
  };
}

// This simulates named checkpoint replay, not Cloudflare's durable engine.
function checkpointStep() {
  const checkpoints = new Map<string, unknown>();
  const executions: string[] = [];
  const run = async <T>(
    name: string,
    _configuration: unknown,
    callback: () => Promise<T>
  ): Promise<T> => {
    if (checkpoints.has(name))
      return asStub<T>(structuredClone(checkpoints.get(name)));
    return stepContext.run(name, async () => {
      executions.push(name);
      const result = await callback();
      checkpoints.set(name, structuredClone(result));
      return result;
    });
  };
  return { step: asStub<WorkflowStep>({ do: run }), checkpoints, executions };
}

function scope(organizationId = generateId()) {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock image binding.');
  model.parameters.push({
    key: 'n',
    label: 'Count',
    type: 'integer',
    status: 'verified',
    operations: ['generate'],
    required: false,
    values: [1, 2],
  });
  const imageModelRouting = createImageModelRoutingSnapshot(configuration);
  const credits = vi.fn(
    async (_cost: Microdollars, _reservationId?: string) => true
  );
  const key = vi.fn(async () => SECRET);
  const scopedDb = asStub<WorkflowScopedDb>({
    organizationId,
    models: { imageModelRouting },
    credentials: {
      organizationId,
      imageModelRouting,
      resolveImageChannelKey: key,
    },
    liveRead: {
      apiKeys: { hasUsableKey: vi.fn(async () => false) },
      billing: { hasEnoughCredits: credits },
    },
  });
  return {
    organizationId,
    scopedDb,
    credits,
    key,
  };
}

function harness(organizationId = generateId(), workflowRunId = generateId()) {
  const context = scope(organizationId);
  const workflow = checkpointStep();
  const store = vi.fn(async (result: ImageGenerationResult) => {
    const stored = [];
    for (const [index, url] of result.imageUrls.entries()) {
      stored.push(
        await uploadImageFromUrl(
          url,
          (extension) =>
            `org/${organizationId}/g10/${workflowRunId}/${index}.${extension}`
        )
      );
    }
    return stored;
  });
  const input: ConfiguredImageStepInput = {
    step: workflow.step,
    stepName: STEP_NAME,
    scopedDb: context.scopedDb,
    params: { model: MODEL, prompt: PROMPT },
    store,
  };
  return {
    ...context,
    ...workflow,
    workflowRunId,
    store,
    input,
    run: (overrides: Partial<ConfiguredImageStepInput> = {}) =>
      runConfiguredImageStep({ ...input, ...overrides }),
  };
}

type Harness = ReturnType<typeof harness>;

function studioRun(test: Harness, count = 1, step = test.step) {
  const input: Extract<StudioRunInput, { activity: 'image' }> = {
    activity: 'image',
    prompt: PROMPT,
    imageModel: MODEL,
    aspectRatio: '1:1',
    resolution: '720p',
    count: 1,
    referenceImages: [],
    channelParameters: { n: count },
  };
  const event: WorkflowEvent<StudioGenerationWorkflowInput> = {
    instanceId: test.workflowRunId,
    workflowName: 'mock-g10-studio',
    timestamp: new Date(0),
    payload: {
      userId: generateId(),
      organizationId: test.organizationId,
      assetId: test.workflowRunId,
      promptLocale: 'en',
      noPersonImages: [],
      input,
    },
  };
  return runConfiguredStudioImageStep({
    event,
    input,
    step,
    scopedDb: test.scopedDb,
  });
}

beforeEach(() => {
  writes.length = 0;
  supplierCall.mockReset().mockResolvedValue(supplierResult());
  putObject.mockReset().mockImplementation(async (bucket, path, file) => {
    const body = file instanceof Uint8Array ? Uint8Array.from(file) : file;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    writes.push({
      path: bucket + '/' + path,
      bytes,
      step: stepContext.getStore(),
    });
    return {
      path: bucket + '/' + path,
      publicUrl: '/r2/' + bucket + '/' + path,
      fullPath: bucket + '/' + path,
    };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(
        'Unexpected network request in mock-only GC-10 contract.'
      );
    })
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('does not checkpoint after Studio stores one output and its second R2 write fails', async () => {
  const test = harness();
  supplierCall.mockResolvedValueOnce(supplierResult(2));
  const persist = putObject.getMockImplementation();
  if (!persist) throw new Error('Missing mock R2 boundary.');
  putObject
    .mockImplementationOnce(persist)
    .mockRejectedValueOnce(new Error('Mock second R2 put failed.'));
  await expect(studioRun(test, 2)).rejects.toThrow(
    'generation or storage failed'
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toContain(
    'org/' +
      test.organizationId +
      '/studio/' +
      test.workflowRunId +
      '/image-0.png'
  );
  expect(test.checkpoints.has(STEP_NAME)).toBe(false);
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(putObject).toHaveBeenCalledTimes(2);
});

it.each(ABORT_MESSAGES)(
  'propagates %s through real storage without a completed checkpoint',
  async (message) => {
    const test = harness();
    const interruption = new Error(message);
    putObject.mockRejectedValueOnce(interruption);
    await expect(test.run()).rejects.toBe(interruption);
    expect(test.checkpoints.has(STEP_NAME)).toBe(false);
    expect(supplierCall).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledTimes(1);
  }
);

it('runs all large Studio data URLs through the real upload helper inside generation and checkpoints only small references', async () => {
  const test = harness();
  supplierCall.mockResolvedValueOnce(supplierResult(2, 2, LARGE_IMAGE_BYTES));
  const result = await studioRun(test, 2);
  expect(writes).toHaveLength(2);
  expect(writes.map((write) => write.step)).toEqual([STEP_NAME, STEP_NAME]);
  expect(writes.map((write) => write.bytes.byteLength)).toEqual([
    LARGE_IMAGE_BYTES,
    LARGE_IMAGE_BYTES,
  ]);
  expect(result.uploads.map((upload) => upload.url)).toEqual(
    writes.map((write) => '/r2/' + write.path)
  );
  const durable = JSON.stringify([...test.checkpoints]);
  expect(new TextEncoder().encode(durable).byteLength).toBeLessThan(
    CHECKPOINT_LIMIT_BYTES
  );
  for (const forbidden of ['data:image/', 'imageUrls', 'base64', SECRET])
    expect(durable).not.toContain(forbidden);
  expect(result.metadata.cost).toBe(usdToMicros(UNIT_PRICE_USD * 2));
  expect(Number.isSafeInteger(result.metadata.cost)).toBe(true);
});

it('records the accepted partial Studio count and its integer cost alongside the actual stored output', async () => {
  const test = harness();
  supplierCall.mockResolvedValueOnce(supplierResult(1, 2));
  const result = await studioRun(test, 2);
  expect(test.credits).toHaveBeenCalledExactlyOnceWith(
    usdToMicros(UNIT_PRICE_USD * 2),
    undefined
  );
  expect(result.uploads).toHaveLength(1);
  expect(result.metadata.configuredPricing).toMatchObject({
    imageCount: 1,
    requestedCount: 2,
  });
  expect(result.metadata.cost).toBe(usdToMicros(UNIT_PRICE_USD));
  expect(Number.isSafeInteger(result.metadata.cost)).toBe(true);
  expect(putObject).toHaveBeenCalledTimes(1);
});

it('keeps configured sheet softening in its named generation step with no reseed, prompt rewrite or fallback', async () => {
  const test = harness();
  const onRetry = vi.fn();
  const store = vi.fn(async (image: ImageGenerationResult) =>
    storeGeneratedPng(
      image.imageUrls[0],
      STORAGE_BUCKETS.CHARACTERS,
      `org/${test.organizationId}/g10/sheet.png`
    )
  );
  const args = {
    step: test.step,
    scopedDb: test.scopedDb,
    workflowRunId: test.workflowRunId,
    promptLocale: 'en' as const,
    userId: generateId(),
    kind: 'character-sheet',
    logTag: '[Mock GC-10]',
    subject: 'mock sheet',
    stepName: 'generate-sheet-image',
    params: test.input.params,
    store,
    onRetry,
  };
  const result = await generateImageSoftening(args);
  const replay = await generateImageSoftening(args);
  expect(replay).toEqual(result);
  expect(result).toMatchObject({
    params: test.input.params,
    softened: false,
    via: 'compatible',
  });
  expect(onRetry).not.toHaveBeenCalled();
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(store).toHaveBeenCalledTimes(1);
  expect(putObject).toHaveBeenCalledTimes(1);
});

it('preserves the queued shot prompt, version, hash and reservation through the configured content-retry bridge', async () => {
  const test = harness();
  const input: ImageWorkflowInput = {
    promptLocale: 'en',
    userId: generateId(),
    organizationId: test.organizationId,
    prompt: 'Mock original authored prompt',
    variantOnly: false,
    reservationId: generateId(),
  };
  const versionId = generateId();
  const snapshotInputHash = 'mock-frozen-shot-hash';
  const result = await generateImageWithContentRetry({
    step: test.step,
    scopedDb: test.scopedDb,
    workflowRunId: test.workflowRunId,
    input,
    params: test.input.params,
    versionId,
    snapshotInputHash,
    store: (image) =>
      storeGeneratedPng(
        image.imageUrls[0],
        STORAGE_BUCKETS.THUMBNAILS,
        `org/${test.organizationId}/g10/shot.png`
      ),
  });
  expect(result).toMatchObject({
    params: test.input.params,
    prompt: input.prompt,
    versionId,
    snapshotInputHash,
    via: 'compatible',
  });
  expect(test.credits).toHaveBeenCalledExactlyOnceWith(
    usdToMicros(UNIT_PRICE_USD),
    input.reservationId
  );
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(putObject).toHaveBeenCalledTimes(1);
});
