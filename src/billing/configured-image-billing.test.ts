import { describe, expect, it } from 'vitest';
import type { ImageModelRoute } from '@/models/image-channels';
import { estimateImageCost, estimateLLMCost } from './cost-estimation';
import {
  configuredImageSource,
  quoteConfiguredImageRequest,
} from './configured-image-billing';
import { TEST_FAL_PRICING } from './fal-pricing-fixture';

const MODEL = 'custom-image:test';
const route: ImageModelRoute = {
  modelId: MODEL,
  name: 'Mock image model',
  channelId: 'mock-channel',
  protocol: 'openai-images',
  baseUrl: 'https://mock.invalid/v1',
  credentialId: 'mock-reference',
  operations: {
    generate: {
      upstreamModel: 'mock-generate',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
    edit: {
      upstreamModel: 'mock-edit',
      status: 'verified',
      minReferenceImages: 1,
      maxReferenceImages: 2,
      mask: 'unsupported',
    },
  },
  parameters: [
    {
      key: 'n',
      label: 'Count',
      type: 'integer',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: false,
      minimum: 1,
      maximum: 8,
      defaultValue: 1,
    },
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      values: ['512x512', '1024x576'],
      defaultValue: '512x512',
    },
    {
      key: 'quality',
      label: 'Quality',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      values: ['low', 'high'],
      defaultValue: 'low',
    },
  ],
  priceCards: [
    { id: 'base', operation: 'generate', match: {}, unitPriceUsd: 0.012345 },
    {
      id: 'high',
      operation: 'generate',
      match: { quality: 'high' },
      unitPriceUsd: 0.06,
    },
    { id: 'edit', operation: 'edit', match: {}, unitPriceUsd: 0.03 },
  ],
};

function quote(
  overrides: Partial<Parameters<typeof quoteConfiguredImageRequest>[0]> = {}
) {
  return quoteConfiguredImageRequest({
    model: MODEL,
    imageModelRouting: [route],
    operation: 'generate',
    ...overrides,
  });
}

describe('configured image billing', () => {
  it('uses USD per image prices at wallet microdollar precision', () => {
    expect(quote({ imageCount: 3 })).toMatchObject({
      imageSource: 'platform',
      costMicros: 37035,
      unitPriceUsd: 0.012345,
      imageCount: 3,
    });
    expect(
      quote({ parameters: { quality: 'high' }, imageCount: 2 }).costMicros
    ).toBe(120000);
  });
  it('validates the operation, final reference count and mask before quoting', () => {
    expect(
      quote({ operation: 'edit', referenceImageCount: 2 }).costMicros
    ).toBe(30000);
    expect(() => quote({ operation: 'edit', referenceImageCount: 0 })).toThrow(
      'reference'
    );
    expect(() => quote({ operation: 'edit', referenceImageCount: 3 })).toThrow(
      'reference'
    );
    expect(() =>
      quote({ operation: 'edit', referenceImageCount: 1, hasMask: true })
    ).toThrow('Mask');
    expect(() => quote({ referenceImageCount: 1 })).toThrow('reference');
  });
  it('rejects inactive identity and unsupported parameters instead of falling back', () => {
    expect(() => quote({ imageModelRouting: [] })).toThrow('unavailable');
    expect(() => quote({ parameters: { size: '4096x4096' } })).toThrow(
      'parameter'
    );
    expect(() => quote({ parameters: { unknown: true } })).toThrow(
      'unavailable'
    );
  });
  it('refuses missing or ambiguous configured prices', () => {
    const [basePrice] = route.priceCards;
    if (!basePrice) throw new Error('Mock base price fixture is required.');
    expect(() =>
      quote({ imageModelRouting: [{ ...route, priceCards: [] }] })
    ).toThrow('No configured image price');
    expect(() =>
      quote({
        imageModelRouting: [
          { ...route, priceCards: [basePrice, { ...basePrice, id: 'same' }] },
        ],
      })
    ).toThrow('ambiguous');
  });
  it('rejects unverified operations and accidental zero from sub-micro prices', () => {
    const generate = route.operations.generate;
    if (!generate)
      throw new Error('Mock generation operation fixture is required.');
    const unverified: ImageModelRoute = {
      ...route,
      operations: { generate: { ...generate, status: 'unverified' } },
    };
    expect(() => quote({ imageModelRouting: [unverified] })).toThrow(
      'operation'
    );
    expect(() =>
      quote({
        imageModelRouting: [
          {
            ...route,
            priceCards: [
              {
                id: 'tiny',
                operation: 'generate',
                match: {},
                unitPriceUsd: 0.0000001,
              },
            ],
          },
        ],
      })
    ).toThrow('precision');
  });
  it('uses configured rates for estimates of more images than one provider call', () => {
    expect(
      estimateImageCost(MODEL, '1:1', 30, {
        pricing: {},
        imageModelRouting: [route],
      })
    ).toBe(370350);
    expect(() => estimateImageCost(MODEL, '1:1', 1, { pricing: {} })).toThrow(
      'unavailable'
    );
  });
  it('retains the original text preflight estimate', () => {
    expect(estimateLLMCost()).toBe(20000);
    expect(estimateLLMCost(2)).toBe(40000);
  });
});

const BUILTIN_MODEL = 'flux_2_max';
const builtinRoute: ImageModelRoute = { ...route, modelId: BUILTIN_MODEL };

describe('built-in configured image billing', () => {
  it('requires a frozen route to classify built-in platform spend', () => {
    expect(configuredImageSource(BUILTIN_MODEL)).toBeUndefined();
    expect(configuredImageSource(BUILTIN_MODEL, [])).toBeUndefined();
    expect(configuredImageSource(BUILTIN_MODEL, [route])).toBeUndefined();
    expect(configuredImageSource(BUILTIN_MODEL, [builtinRoute])).toBe(
      'platform'
    );
    expect(configuredImageSource(MODEL, [])).toBe('platform');
  });
  it('uses the bound price card and verified parameters before fal prices', () => {
    expect(
      quote({
        model: BUILTIN_MODEL,
        imageModelRouting: [builtinRoute],
        parameters: { quality: 'high' },
        imageCount: 2,
      }).costMicros
    ).toBe(120000);
    expect(
      estimateImageCost(BUILTIN_MODEL, '16:9', 3, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [builtinRoute],
        imageParameters: { quality: 'high' },
      })
    ).toBe(180000);
    expect(
      estimateImageCost(BUILTIN_MODEL, '16:9', 2, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [builtinRoute],
        edit: true,
        referenceImageCount: 2,
      })
    ).toBe(60000);
  });
  it('keeps the original fal estimate for unbound built-in models', () => {
    const legacy = estimateImageCost(BUILTIN_MODEL, '16:9', 2, {
      pricing: TEST_FAL_PRICING,
    });
    expect(legacy).toBeGreaterThan(0);
    expect(
      estimateImageCost(BUILTIN_MODEL, '16:9', 2, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [route],
      })
    ).toBe(legacy);
    expect(
      estimateImageCost(BUILTIN_MODEL, '16:9', 1, { pricing: {} })
    ).toBeNull();
  });
  it('rejects invalid bound parameters and missing prices even when fal has a price', () => {
    expect(() =>
      estimateImageCost(BUILTIN_MODEL, '16:9', 1, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [builtinRoute],
        imageParameters: { quality: 'unsupported' },
      })
    ).toThrow('parameter');
    expect(() =>
      estimateImageCost(BUILTIN_MODEL, '16:9', 1, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [{ ...builtinRoute, priceCards: [] }],
      })
    ).toThrow('No configured image price');
  });
  it('rejects unverified operations and invalid reference counts on a bound built-in', () => {
    expect(() =>
      estimateImageCost(BUILTIN_MODEL, '16:9', 1, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [{ ...builtinRoute, operations: {} }],
      })
    ).toThrow('operation');
    expect(() =>
      estimateImageCost(BUILTIN_MODEL, '16:9', 1, {
        pricing: TEST_FAL_PRICING,
        imageModelRouting: [builtinRoute],
        edit: true,
        referenceImageCount: 3,
      })
    ).toThrow('reference');
  });
});
