import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type { BuiltinTextToImageModel } from '@/models/models';
import { usdToMicros } from '@/billing/money';
import type {
  CompatibleImageInput,
  CompatibleImageResult,
} from './compatible-image-types';
import { generateImageWithProvider } from './image-generation';

const mocks = vi.hoisted(() => ({
  compatible:
    vi.fn<(input: CompatibleImageInput) => Promise<CompatibleImageResult>>(),
  nativeOrFal: vi.fn(),
}));

// Mock the supplier and native dispatch boundary; configured dispatch and quoting stay real.
vi.mock('./compatible-image-client', () => ({
  generateCompatibleImages: mocks.compatible,
}));
vi.mock('@/models/google-region', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/models/google-region')>()),
  withGoogleRegionFallback: mocks.nativeOrFal,
}));
vi.mock('@/platform/server/observability/ai-otel', () => ({
  recordMediaGenerationSpan: vi.fn(),
}));

const UNIT_PRICE_USD = 0.1;
const EXPECTED_COST = usdToMicros(UNIT_PRICE_USD);
const NATIVE_DISPATCH_ERROR = new Error(
  'Unexpected native/fal dispatch in Mock channel test.'
);

function mockSupplierResult(): CompatibleImageResult {
  return {
    images: [
      {
        dataUrl: 'data:image/png;base64,bW9jay1pbWFnZQ==',
        width: 1024,
        height: 1024,
        mimeType: 'image/png',
        byteLength: 10,
      },
    ],
    actualCount: 1,
    returnedCount: 1,
    requestedCount: 1,
    status: 'complete',
    mismatches: [],
    reported: {},
  };
}

function boundBuiltin(model: BuiltinTextToImageModel = 'gpt_image_2') {
  const configuration = imageConfigurationFixture();
  const binding = configuration.models[0];
  if (!binding) throw new Error('Missing mock image binding.');
  binding.id = model;
  const imageModelRouting = createImageModelRoutingSnapshot(configuration);
  const credentials = {
    userId: 'mock-user',
    organizationId: 'mock-organization',
    imageModelRouting,
    resolveImageChannelKey: vi.fn(async () => 'mock-platform-image-key'),
    resolveKey: vi.fn(),
    resolveOptionalKey: vi.fn(),
  };
  return {
    imageModelRouting,
    credentials,
    run: () =>
      generateImageWithProvider(
        { model, prompt: 'Mock bound built-in dispatch' },
        { credentials, configuredAttemptId: 'mock-dispatch-attempt' }
      ),
  };
}

function expectNoNativeFallback(test: ReturnType<typeof boundBuiltin>) {
  expect(mocks.nativeOrFal).not.toHaveBeenCalled();
  expect(test.credentials.resolveKey).not.toHaveBeenCalled();
  expect(test.credentials.resolveOptionalKey).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  mocks.compatible.mockReset().mockResolvedValue(mockSupplierResult());
  mocks.nativeOrFal.mockReset().mockRejectedValue(NATIVE_DISPATCH_ERROR);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected network in Mock dispatch test.');
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  'gpt_image_2',
  'nano_banana_pro',
  'grok_imagine_image',
  'seedream_v5',
] as const)(
  'dispatches the bound built-in %s to the compatible adapter and platform card',
  async (model) => {
    const test = boundBuiltin(model);
    const result = await test.run();
    expect(mocks.compatible).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        baseUrl: 'https://example.com/v1',
        upstreamModel: 'mock-generate',
        apiKey: 'mock-platform-image-key',
        operation: 'generate',
      })
    );
    expect(result.via).toBe('compatible');
    expect(result.parameters.model).toBe(model);
    expect(result.metadata).toMatchObject({
      model,
      endpointId: 'mock-generate',
      cost: EXPECTED_COST,
      usedOwnKey: false,
      configuredPricing: {
        priceCardId: 'generate',
        unitPriceUsd: UNIT_PRICE_USD,
      },
    });
    expectNoNativeFallback(test);
  }
);

it.each([
  'unverified operation',
  'missing operation',
  'missing price',
  'unmatched price',
])(
  'refuses a built-in with %s without entering a native/fal path',
  async (invalid) => {
    const test = boundBuiltin();
    const route = test.imageModelRouting[0];
    if (!route?.operations.generate) throw new Error('Missing mock binding.');
    if (invalid === 'unverified operation')
      route.operations.generate.status = 'unverified';
    else if (invalid === 'missing operation') delete route.operations.generate;
    else if (invalid === 'missing price') route.priceCards = [];
    else
      route.priceCards = [
        {
          id: 'unmatched',
          operation: 'generate',
          match: { size: '512x512' },
          unitPriceUsd: UNIT_PRICE_USD,
        },
      ];
    await expect(test.run()).rejects.toThrow(/unavailable|price/i);
    expect(mocks.compatible).not.toHaveBeenCalled();
    expect(test.credentials.resolveImageChannelKey).not.toHaveBeenCalled();
    expectNoNativeFallback(test);
  }
);

it('propagates a compatible provider failure without retrying through native/fal', async () => {
  const test = boundBuiltin();
  const failure = new Error('Mock compatible provider connection lost.');
  mocks.compatible.mockRejectedValueOnce(failure);
  await expect(test.run()).rejects.toBe(failure);
  expect(mocks.compatible).toHaveBeenCalledTimes(1);
  expectNoNativeFallback(test);
});

it('leaves the same unbound built-in on its existing native/fal dispatch', async () => {
  const test = boundBuiltin();
  test.credentials.imageModelRouting = [];
  await expect(test.run()).rejects.toBe(NATIVE_DISPATCH_ERROR);
  expect(mocks.nativeOrFal).toHaveBeenCalledTimes(1);
  expect(mocks.compatible).not.toHaveBeenCalled();
});
