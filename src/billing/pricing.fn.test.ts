import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageModelRoute } from '@/models/image-channels';
import { TEST_FAL_PRICING } from './fal-pricing-fixture';
import { micros } from './money';

const mocks = vi.hoisted(() => ({
  routing: vi.fn(),
  pricing: vi.fn(),
  estimateStoryboard: vi.fn(),
}));
// Mock the RPC boundary; request routing and image price validation stay real.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock('@/platform/middleware.fn', () => ({
  authWithOrganizationMiddleware: {},
}));
vi.mock('@/billing/server/configured-image-billing', () => ({
  configuredImageRoutingForModels: mocks.routing,
}));
vi.mock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: mocks.pricing,
  getFalPricingUpdatedAt: vi.fn(),
}));
vi.mock('./storyboard-preflight-cost', () => ({
  estimateStoryboardPreflightCost: mocks.estimateStoryboard,
}));
import { estimateDraftGenerationFn } from './pricing.fn';
const { estimateStoryboardPreflightCost } = await vi.importActual<
  typeof import('./storyboard-preflight-cost')
>('./storyboard-preflight-cost');

const BUILTIN_MODEL = 'flux_2_max';
const route: ImageModelRoute = {
  modelId: BUILTIN_MODEL,
  name: 'Mock built-in binding',
  channelId: 'mock-channel',
  protocol: 'openai-images',
  baseUrl: 'https://mock.invalid/v1',
  credentialId: 'mock-credential',
  operations: {
    generate: {
      upstreamModel: 'mock-image',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
  },
  parameters: [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      required: true,
      operations: ['generate'],
      values: ['1024x576'],
      defaultValue: '1024x576',
    },
  ],
  priceCards: [
    { id: 'mock-card', operation: 'generate', match: {}, unitPriceUsd: 0.01 },
  ],
};
const data = {
  script: 'Scene 1 — 5s\nA door opens.',
  imageModels: ['nano_banana_2', BUILTIN_MODEL],
  videoModels: ['seedance_v2'],
  audioModels: ['elevenlabs_music'],
  aspectRatio: '16:9' as const,
  stopAt: 'images' as const,
  generateStartFrames: true,
  generateVoices: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pricing.mockResolvedValue(TEST_FAL_PRICING);
  mocks.routing.mockResolvedValue([route]);
  mocks.estimateStoryboard.mockReturnValue(micros(123));
});

describe('draft image pricing with frozen built-in bindings', () => {
  it('passes every selected model and the same snapshot for a mixed quote', async () => {
    expect(await estimateDraftGenerationFn({ data })).toEqual({
      estimateMicros: 123,
    });
    expect(mocks.routing).toHaveBeenCalledWith(data.imageModels);
    expect(mocks.estimateStoryboard).toHaveBeenCalledWith(
      expect.objectContaining({
        imageModels: data.imageModels,
        imageModelRouting: [route],
      })
    );
  });
  it('keeps the legacy all-unbound estimate composition', async () => {
    mocks.routing.mockResolvedValue(undefined);
    await estimateDraftGenerationFn({ data });
    expect(mocks.estimateStoryboard).toHaveBeenCalledWith(
      expect.objectContaining({
        imageModels: undefined,
        imageModelRouting: undefined,
      })
    );
  });
  it('quotes portrait reference-only video using the actual landscape reference-sheet estimate', async () => {
    mocks.estimateStoryboard.mockImplementation(
      estimateStoryboardPreflightCost
    );
    const request = {
      ...data,
      imageModels: [BUILTIN_MODEL],
      aspectRatio: '9:16' as const,
      stopAt: 'motion' as const,
      generateStartFrames: false,
    };
    const expected = estimateStoryboardPreflightCost({
      script: request.script,
      imageModel: BUILTIN_MODEL,
      imageModels: [BUILTIN_MODEL],
      imageModelRouting: [route],
      aspectRatio: request.aspectRatio,
      stopAt: request.stopAt,
      referenceOnly: true,
      videoModels: ['seedance_v2'],
      generateVoices: false,
      pricing: TEST_FAL_PRICING,
    });
    expect(expected).toBeGreaterThan(0);
    await expect(estimateDraftGenerationFn({ data: request })).resolves.toEqual(
      {
        estimateMicros: Number(expected),
      }
    );
  });
  it('still rejects an unsupported portrait size when a start frame will be generated', async () => {
    await expect(
      estimateDraftGenerationFn({
        data: { ...data, imageModels: [BUILTIN_MODEL], aspectRatio: '9:16' },
      })
    ).rejects.toThrow('aspect ratio');
    expect(mocks.estimateStoryboard).not.toHaveBeenCalled();
  });
  it('still validates the reference-sheet price in reference-only mode', async () => {
    mocks.estimateStoryboard.mockImplementation(
      estimateStoryboardPreflightCost
    );
    mocks.routing.mockResolvedValue([{ ...route, priceCards: [] }]);
    await expect(
      estimateDraftGenerationFn({
        data: {
          ...data,
          imageModels: [BUILTIN_MODEL],
          aspectRatio: '9:16',
          stopAt: 'motion',
          generateStartFrames: false,
        },
      })
    ).rejects.toThrow('No configured image price');
    expect(mocks.estimateStoryboard).toHaveBeenCalled();
  });
  it('rejects an invalid bound price before producing a draft quote', async () => {
    mocks.routing.mockResolvedValue([{ ...route, priceCards: [] }]);
    await expect(
      estimateDraftGenerationFn({
        data: { ...data, imageModels: [BUILTIN_MODEL] },
      })
    ).rejects.toThrow('No configured image price');
    expect(mocks.estimateStoryboard).not.toHaveBeenCalled();
  });
});
