import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type { ImageChannelModelId } from '@/models/image-channels';
import { usdToMicros } from '@/billing/money';
import type { Microdollars } from '@/billing/money';
import {
  deductWorkflowCredits,
  extractImageCost,
} from '@/billing/server/workflow-deduction';
import { asStub } from '@/test/as-stub';
import { getLogger } from '@/platform/logger';
import { CompatibleImageError } from '../compatible-image-error';
import { COMPATIBLE_IMAGE_LIMITS } from '../compatible-image-limits';
import type {
  CompatibleImageInput,
  CompatibleImageResult,
} from '../compatible-image-types';
import type { ImageGenerationResult } from '../image-generation';
import {
  runConfiguredImageStep,
  runConfiguredSingleImageStep,
} from './configured-image-step';
import type {
  ConfiguredImageStepInput,
  StoredChannelGeneration,
} from './configured-image-step';

const { supplierCall } = vi.hoisted(() => ({
  supplierCall:
    vi.fn<(input: CompatibleImageInput) => Promise<CompatibleImageResult>>(),
}));

// Mock only the paid supplier boundary; generation, quoting and preflight stay real.
vi.mock('../compatible-image-client', () => ({
  generateCompatibleImages: supplierCall,
}));

const MOCK_API_KEY = 'mock-configured-image-step-secret';
const MOCK_IMAGE_URL = 'data:image/png;base64,bW9jay1pbWFnZS1ieXRlcw==';
const MODEL_ID = 'custom-image:qwen';
const BOUND_BUILTIN_ID = 'gpt_image_2';
const RUN_ID = 'mock-image-step-run';
const STEP_NAME = 'mock-generate-and-store';
const RESERVATION_ID = 'mock-image-step-reservation';
const UNIT_PRICE_USD = 0.1;
const EXPECTED_COST = usdToMicros(UNIT_PRICE_USD);
const DOUBLE_COST = usdToMicros(UNIT_PRICE_USD * 2);
const IMAGE_EDGE = 1024;
const MOCK_IMAGE_BYTES = 16;
const MOCK_USAGE = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
const STORED_IMAGE = {
  url: '/r2/mock-images/result.png',
  path: 'mock-images/result.png',
  contentType: 'image/png',
};
type StepConfiguration = {
  retries: { limit: number; delay: string };
  timeout: string;
};

function supplierResult(): CompatibleImageResult {
  return {
    images: [
      {
        dataUrl: MOCK_IMAGE_URL,
        width: IMAGE_EDGE,
        height: IMAGE_EDGE,
        mimeType: 'image/png',
        byteLength: MOCK_IMAGE_BYTES,
      },
    ],
    actualCount: 1,
    returnedCount: 1,
    requestedCount: 1,
    status: 'complete',
    mismatches: [],
    usage: MOCK_USAGE,
    requestId: 'mock-image-provider-request',
    reported: {},
  };
}

function storedResult(): StoredChannelGeneration {
  return {
    stored: [STORED_IMAGE],
    via: 'compatible',
    metadata: {
      prompt: 'Mock image generation prompt',
      model: MODEL_ID,
      endpointId: 'mock-generate',
      dimensions: [{ width: IMAGE_EDGE, height: IMAGE_EDGE }],
      file_sizes: [MOCK_IMAGE_BYTES],
      numImages: 1,
      cost: EXPECTED_COST,
      usedOwnKey: false,
      requestId: 'mock-image-provider-request',
      supplierUsage: MOCK_USAGE,
      configuredPricing: {
        priceCardId: 'generate',
        unitPriceUsd: UNIT_PRICE_USD,
        imageCount: 1,
        requestedCount: 1,
      },
    },
  };
}

function mockStep(retainCheckpoints = false) {
  const outputs: unknown[] = [];
  const checkpoints = new Map<string, unknown>();
  // Mock ordinary completed Cloudflare step checkpoints when requested.
  const doStep = vi.fn(
    async <T>(
      name: string,
      config: StepConfiguration,
      callback: () => Promise<T>
    ) => {
      expect(name).toBe(STEP_NAME);
      expect(config.retries.limit).toBe(0);
      expect(config.timeout).toBe('15 minutes');
      if (retainCheckpoints && checkpoints.has(name))
        return asStub<T>(checkpoints.get(name));
      const result = await callback();
      if (name === STEP_NAME) outputs.push(structuredClone(result));
      checkpoints.set(name, structuredClone(result));
      return result;
    }
  );
  return { step: asStub<WorkflowStep>({ do: doStep }), doStep, outputs };
}

function mockWallet(trace: string[]) {
  const wallet = { available: true };
  const debits = new Map<string, Microdollars>();
  const hasEnoughCredits = vi.fn(async () => {
    trace.push('credits');
    return wallet.available;
  });
  // Mock ledger implements the existing idempotency contract, not a real D1 charge.
  const captureReservation = vi.fn(
    async (
      _reservationId: string,
      cost: Microdollars,
      options: { idempotencyKey: string }
    ) => {
      trace.push('charge');
      if (!debits.has(options.idempotencyKey))
        debits.set(options.idempotencyKey, cost);
      return { ok: true };
    }
  );
  return { wallet, debits, hasEnoughCredits, captureReservation };
}

function mockScope(
  wallet: ReturnType<typeof mockWallet>,
  modelId: ImageChannelModelId
) {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock image binding.');
  model.id = modelId;
  const imageModelRouting = createImageModelRoutingSnapshot(configuration);
  const hasUsableKey = vi.fn<(provider: string) => Promise<boolean>>(
    async () => false
  );
  const resolveImageChannelKey = vi.fn(async () => MOCK_API_KEY);
  // Mock ScopedDb contains only the real helpers' read/write surfaces.
  const scopedDb = asStub<WorkflowScopedDb>({
    organizationId: 'mock-image-step-organization',
    models: { imageModelRouting },
    credentials: { imageModelRouting, resolveImageChannelKey },
    liveRead: {
      apiKeys: { hasUsableKey },
      billing: { hasEnoughCredits: wallet.hasEnoughCredits },
    },
    billing: { captureReservation: wallet.captureReservation },
  });
  return {
    scopedDb,
    configuration,
    imageModelRouting,
    hasUsableKey,
    resolveImageChannelKey,
  };
}

function harness(
  retainCheckpoints = false,
  modelId: ImageChannelModelId = MODEL_ID
) {
  const trace: string[] = [];
  const workflow = mockStep(retainCheckpoints);
  const wallet = mockWallet(trace);
  const scope = mockScope(wallet, modelId);
  const store = vi.fn(async (_result: ImageGenerationResult) => {
    trace.push('store');
    return [structuredClone(STORED_IMAGE)];
  });
  const input: ConfiguredImageStepInput = {
    step: workflow.step,
    stepName: STEP_NAME,
    scopedDb: scope.scopedDb,
    params: { model: modelId, prompt: 'Mock image generation prompt' },
    reservationId: RESERVATION_ID,
    store,
  };
  return {
    ...workflow,
    ...wallet,
    ...scope,
    trace,
    input,
    store,
    run: (overrides: Partial<ConfiguredImageStepInput> = {}) =>
      runConfiguredImageStep({ ...input, ...overrides }),
  };
}

type Harness = ReturnType<typeof harness>;

async function chargeResult(test: Harness, result: StoredChannelGeneration) {
  await deductWorkflowCredits({
    scopedDb: test.input.scopedDb,
    costMicros: extractImageCost(result.metadata),
    usedOwnKey: result.metadata.usedOwnKey,
    description: 'Mock configured image charge',
    idempotencyKey: RUN_ID + ':mock-image-charge',
    reservationId: RESERVATION_ID,
    metadata: result.metadata,
  });
}

function allowTwoOutputs(test: Harness) {
  const route = test.imageModelRouting[0];
  if (!route) throw new Error('Missing mock image routing fixture.');
  route.parameters.push({
    key: 'n',
    label: 'Number of images',
    type: 'integer',
    status: 'verified',
    operations: ['generate'],
    required: false,
    values: [1, 2],
  });
  return { ...test.input.params, numImages: 2 };
}

beforeEach(() => {
  supplierCall.mockReset();
  supplierCall.mockResolvedValue(supplierResult());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(
        'Unexpected network request: this test must use the Mock supplier.'
      );
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('checks the frozen quote before one paid call and stores before returning metadata', async () => {
  const test = harness();
  supplierCall.mockImplementationOnce(async () => {
    test.trace.push('supplier');
    return supplierResult();
  });
  const result = await test.run();
  expect(test.trace).toEqual(['credits', 'supplier', 'store']);
  expect(test.hasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    EXPECTED_COST,
    RESERVATION_ID
  );
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(supplierCall).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: MOCK_API_KEY,
      operation: 'generate',
      upstreamModel: 'mock-generate',
    })
  );
  expect(test.resolveImageChannelKey).toHaveBeenCalledExactlyOnceWith(
    test.imageModelRouting[0]?.credentialId
  );
  expect(result).toEqual(storedResult());
  expect(test.captureReservation).not.toHaveBeenCalled();
});

it('replays a completed step into the existing idempotent charge with no new generation', async () => {
  const test = harness(true);
  await chargeResult(test, await test.run());
  test.wallet.available = false;
  await chargeResult(test, await test.run());
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(test.store).toHaveBeenCalledTimes(1);
  expect(test.hasEnoughCredits).toHaveBeenCalledTimes(1);
  expect(test.captureReservation).toHaveBeenCalledTimes(2);
  expect(test.debits.size).toBe(1);
  expect([...test.debits.values()]).toEqual([EXPECTED_COST]);
  expect(test.outputs).toHaveLength(1);
});

it('blocks insufficient funds before resolving the key, generating or storing', async () => {
  const test = harness();
  test.wallet.available = false;
  await expect(test.run()).rejects.toThrow('Insufficient credits');
  expect(test.hasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    EXPECTED_COST,
    RESERVATION_ID
  );
  expect(supplierCall).not.toHaveBeenCalled();
  expect(test.resolveImageChannelKey).not.toHaveBeenCalled();
  expect(test.store).not.toHaveBeenCalled();
  expect(test.captureReservation).not.toHaveBeenCalled();
});

it.each([['fal'], ['openrouter'], ['fal', 'openrouter']])(
  'does not let organization keys %j bypass a platform-channel balance check',
  async (...keys) => {
    const test = harness();
    test.wallet.available = false;
    test.hasUsableKey.mockImplementation(async (provider?: string) =>
      keys.includes(provider ?? '')
    );
    await expect(test.run()).rejects.toThrow('Insufficient credits');
    expect(test.hasEnoughCredits).toHaveBeenCalledTimes(1);
    expect(test.hasUsableKey).not.toHaveBeenCalled();
    expect(supplierCall).not.toHaveBeenCalled();
  }
);

it('passes an absent parent reservation through to the live balance guard', async () => {
  const test = harness();
  await test.run({ reservationId: undefined });
  expect(test.hasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    EXPECTED_COST,
    undefined
  );
  expect(supplierCall).toHaveBeenCalledTimes(1);
});

it('rejects an operation exceeding its output capacity before checking balance or paying', async () => {
  const test = harness();
  const params = allowTwoOutputs(test);
  await expect(test.run({ params })).rejects.toThrow(
    'This image operation stores one output per task.'
  );
  expect(test.hasEnoughCredits).not.toHaveBeenCalled();
  expect(supplierCall).not.toHaveBeenCalled();
});

it('requires a complete quote before checking balance or spending', async () => {
  const test = harness();
  const route = test.imageModelRouting[0];
  if (!route) throw new Error('Missing mock image routing fixture.');
  route.priceCards = [];
  await expect(test.run()).rejects.toThrow(/price/i);
  expect(test.hasEnoughCredits).not.toHaveBeenCalled();
  expect(supplierCall).not.toHaveBeenCalled();
});

it('prechecks all requested outputs and charges only a partial result actually stored', async () => {
  const test = harness();
  const params = allowTwoOutputs(test);
  supplierCall.mockResolvedValueOnce({
    ...supplierResult(),
    status: 'partial',
    requestedCount: 2,
    mismatches: [{ parameter: 'n', requested: 2, actual: 1, basis: 'count' }],
  });
  const result = await test.run({ params, maximumOutputs: 2 });
  await chargeResult(test, result);
  expect(test.hasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    DOUBLE_COST,
    RESERVATION_ID
  );
  expect(result.metadata.configuredPricing).toEqual({
    priceCardId: 'generate',
    unitPriceUsd: UNIT_PRICE_USD,
    imageCount: 1,
    requestedCount: 2,
  });
  expect(result.metadata.cost).toBe(EXPECTED_COST);
  expect([...test.debits.values()]).toEqual([EXPECTED_COST]);
});

it('rejects a failed store without charging or checkpointing output', async () => {
  const test = harness();
  test.store.mockRejectedValueOnce(new Error('Mock R2 put failure'));
  await expect(test.run()).rejects.toThrow(NonRetryableError);
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(test.hasEnoughCredits).toHaveBeenCalledTimes(1);
  expect(test.store).toHaveBeenCalledTimes(1);
  expect(test.captureReservation).not.toHaveBeenCalled();
  expect(test.outputs).toEqual([]);
});

it.each([undefined, 200])(
  'logs a timed-out supplier safely without charging (HTTP %s)',
  async (status) => {
    const test = harness();
    const log = vi
      .spyOn(getLogger(['openstory', 'image-channel']), 'error')
      .mockImplementation(() => {});
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    supplierCall.mockImplementationOnce(async () => {
      clock.mockReturnValue(180_063);
      throw new CompatibleImageError('request_timeout', { status });
    });
    await expect(test.run()).rejects.toThrow(NonRetryableError);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('{elapsedMs}'),
      {
        code: 'request_timeout',
        status: status ?? 'no_response',
        submissionState: 'unknown',
        elapsedMs: 180_063,
        timeoutMs: COMPATIBLE_IMAGE_LIMITS.timeoutMs,
      }
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(MOCK_API_KEY);
    expect(JSON.stringify(log.mock.calls)).not.toContain(MOCK_IMAGE_URL);
    expect(supplierCall).toHaveBeenCalledTimes(1);
    expect(test.store).not.toHaveBeenCalled();
    expect(test.captureReservation).not.toHaveBeenCalled();
  }
);

it('refuses a partial store and never checkpoints unpersisted supplier output', async () => {
  const test = harness();
  test.store.mockResolvedValueOnce([]);
  await expect(test.run()).rejects.toThrow(
    'Not all generated images were stored.'
  );
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(test.outputs).toEqual([]);
});

it('only checkpoints storage references and billing metadata, never image bytes or keys', async () => {
  const test = harness();
  const result = await test.run();
  const durable = JSON.stringify(test.outputs);
  expect(result.metadata.supplierUsage).toEqual(MOCK_USAGE);
  expect(durable).not.toContain(MOCK_IMAGE_URL);
  expect(durable).not.toContain(MOCK_API_KEY);
  expect(durable).not.toContain('imageUrls');
  expect(durable).not.toContain('credentialId');
  expect(durable).not.toContain('baseUrl');
  expect(test.store).toHaveBeenCalledWith(
    expect.objectContaining({ imageUrls: [MOCK_IMAGE_URL] })
  );
  expect(test.outputs).toEqual([result]);
});

it('stores a configured result through the single-image wrapper', async () => {
  const test = harness();
  const store = vi.fn(async () => structuredClone(STORED_IMAGE));
  const result = await runConfiguredSingleImageStep({ ...test.input, store });
  expect(result).toEqual({
    stored: STORED_IMAGE,
    metadata: storedResult().metadata,
    via: 'compatible',
  });
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(test.hasEnoughCredits).toHaveBeenCalledTimes(1);
  expect(store).toHaveBeenCalledTimes(1);
});

it('leaves insufficient-balance requests unsubmitted and permits replay after top-up', async () => {
  const test = harness();
  test.wallet.available = false;
  await expect(test.run()).rejects.toThrow('Insufficient credits');
  expect(supplierCall).not.toHaveBeenCalled();
  test.wallet.available = true;
  await test.run();
  expect(supplierCall).toHaveBeenCalledTimes(1);
  expect(test.hasEnoughCredits).toHaveBeenCalledTimes(2);
});

it('does not expose image bytes or a supplier key through a failed step message', async () => {
  const test = harness();
  test.store.mockRejectedValueOnce(
    new Error('Mock storage diagnostic: ' + MOCK_API_KEY + ' ' + MOCK_IMAGE_URL)
  );
  const failure: unknown = await test.run().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(NonRetryableError);
  expect(String(failure)).not.toContain(MOCK_API_KEY);
  expect(String(failure)).not.toContain(MOCK_IMAGE_URL);
  expect(test.outputs).toEqual([]);
});

it('preflights and charges a bound built-in as platform spend despite organization keys', async () => {
  const test = harness(false, BOUND_BUILTIN_ID);
  test.hasUsableKey.mockResolvedValue(true);
  const result = await test.run();
  await chargeResult(test, result);
  expect(result.via).toBe('compatible');
  expect(result.metadata).toMatchObject({
    model: BOUND_BUILTIN_ID,
    endpointId: 'mock-generate',
    cost: EXPECTED_COST,
    usedOwnKey: false,
    configuredPricing: {
      priceCardId: 'generate',
      unitPriceUsd: UNIT_PRICE_USD,
    },
  });
  expect(test.hasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    EXPECTED_COST,
    RESERVATION_ID
  );
  expect(test.hasUsableKey).not.toHaveBeenCalled();
  expect(test.resolveImageChannelKey).toHaveBeenCalledExactlyOnceWith(
    test.imageModelRouting[0]?.credentialId
  );
  expect(supplierCall).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      upstreamModel: 'mock-generate',
      apiKey: MOCK_API_KEY,
    })
  );
  expect([...test.debits.values()]).toEqual([EXPECTED_COST]);
});

it.each(['unverified operation', 'missing operation', 'missing price'])(
  'rejects a bound built-in with %s before checking balance or invoking any provider',
  async (invalid) => {
    const test = harness(false, BOUND_BUILTIN_ID);
    const route = test.imageModelRouting[0];
    if (!route?.operations.generate) throw new Error('Missing mock binding.');
    if (invalid === 'unverified operation')
      route.operations.generate.status = 'unverified';
    else if (invalid === 'missing operation') delete route.operations.generate;
    else route.priceCards = [];
    await expect(test.run()).rejects.toThrow(/unavailable|price/i);
    expect(test.hasEnoughCredits).not.toHaveBeenCalled();
    expect(test.resolveImageChannelKey).not.toHaveBeenCalled();
    expect(supplierCall).not.toHaveBeenCalled();
    expect(test.store).not.toHaveBeenCalled();
    expect(test.captureReservation).not.toHaveBeenCalled();
  }
);

it('keeps a built-in task on its captured binding and price after live disable and rebinding', async () => {
  const test = harness(true, BOUND_BUILTIN_ID);
  const model = test.configuration.models[0];
  const channel = test.configuration.channels[0];
  if (!model?.operations.generate || !channel)
    throw new Error('Missing mock binding.');
  model.operations.generate.upstreamModel = 'mock-rebound';
  model.priceCards = [];
  model.enabled = false;
  channel.enabled = false;
  channel.baseUrl = 'https://rebound.example.com/v1';
  const result = await test.run();
  await chargeResult(test, result);
  test.wallet.available = false;
  await chargeResult(test, await test.run());
  expect(supplierCall).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      baseUrl: 'https://example.com/v1',
      upstreamModel: 'mock-generate',
    })
  );
  expect(result.metadata.model).toBe(BOUND_BUILTIN_ID);
  expect(result.metadata.cost).toBe(EXPECTED_COST);
  expect(test.hasEnoughCredits).toHaveBeenCalledTimes(1);
  expect(test.resolveImageChannelKey).toHaveBeenCalledTimes(1);
  expect(test.store).toHaveBeenCalledTimes(1);
  expect([...test.debits.values()]).toEqual([EXPECTED_COST]);
});
