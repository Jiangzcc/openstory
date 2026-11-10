import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { partitionPlanImageEstimate } from './configured-image-plan-billing';
import { estimatePlanCost } from './cost-estimation';
import { usdToMicros, ZERO_MICROS } from './money';
import type { EffectiveFalPricing } from './fal-cost';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { planCounts } from '@/sequences/generation-plan';
import type { TextToImageModel } from '@/models/models';
import { asStub } from '@/test/as-stub';

const CONFIGURED_MODEL = 'custom-image:qwen';
const BUILTIN_MODEL = 'nano_banana_2';
const MOCK_ROUTING = createImageModelRoutingSnapshot(
  imageConfigurationFixture()
);
const [MOCK_ROUTE] = MOCK_ROUTING;
if (!MOCK_ROUTE) throw new Error('Missing mock image route.');
const MOCK_PRICING: Record<string, EffectiveFalPricing> = {
  'fal-ai/nano-banana-2': {
    unitPrice: usdToMicros(0.03),
    unit: 'images',
    typicalUnitsPerCall: 1,
  },
};
const OTHER_COUNTS = {
  ...planCounts([]),
  spec: 2,
  voice: 3,
  dialogue: 1,
  'prompt:visual': 1,
  'prompt:motion': 1,
  'prompt:music': 1,
  clip: 2,
  music: 1,
};
const MIXED_COUNTS = Object.freeze({
  ...OTHER_COUNTS,
  still: 2,
  'sheet:character': 2,
  'sheet:location': 1,
  'ref:element': 1,
});
type ImagePlan = Parameters<typeof partitionPlanImageEstimate>[0]['plan'];

// Synthetic workflow DTOs keep this matrix independent of mutable planning reads.
function mockPlan(
  models: TextToImageModel[] = [CONFIGURED_MODEL, BUILTIN_MODEL]
): ImagePlan {
  return {
    aspectRatio: '16:9',
    sequence: asStub<ImagePlan['sequence']>({ resolution: '720p' }),
    targets: models.map((imageModel) =>
      asStub<ImagePlan['targets'][number]>({
        imageModel,
        regenImage: true,
        imageReferenceCount: 0,
        referenceIds: [],
      })
    ),
    references: null,
  };
}

function mixedReferences(): NonNullable<ImagePlan['references']> {
  return asStub<NonNullable<ImagePlan['references']>>({
    characterSheets: [{ imageModel: BUILTIN_MODEL, face: null }],
    lookSheetsAfterDefault: [{ imageModel: CONFIGURED_MODEL }],
    locationSheets: [
      { imageModel: CONFIGURED_MODEL, referencePhotoUrls: ['mock-photo'] },
    ],
    elementSheets: {
      imageModel: CONFIGURED_MODEL,
      entries: [{ elementId: 'mock-element' }],
    },
  });
}

function countBasedCost(
  counts: Parameters<typeof estimatePlanCost>[0]['counts'],
  pricing = MOCK_PRICING
) {
  return estimatePlanCost({
    counts,
    imageModel: BUILTIN_MODEL,
    aspectRatio: '16:9',
    videoModels: [],
    videoDurationSeconds: 5,
    referenceOnly: false,
    draftMotion: false,
    audioModels: [],
    audioDurationSeconds: 0,
    pricing,
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Pure image partitions must not call providers.')
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it.each([
  {
    name: 'known built-in rates',
    pricing: MOCK_PRICING,
    expectedUsd: 0.66,
    priced: true,
  },
  {
    name: 'unknown built-in rates',
    pricing: {},
    expectedUsd: 0.8,
    priced: false,
  },
])(
  'quotes every mixed image once with $name and retains other unit counts',
  ({ pricing, expectedUsd, priced }) => {
    const plan = { ...mockPlan(), references: mixedReferences() };
    const before = structuredClone(plan);
    const result = partitionPlanImageEstimate({
      plan,
      counts: MIXED_COUNTS,
      imageModelRouting: MOCK_ROUTING,
      pricing,
    });
    expect(result).toEqual({
      counts: OTHER_COUNTS,
      costMicros: usdToMicros(expectedUsd),
      imageSource: 'platform',
      priced,
    });
    expect(MIXED_COUNTS).toMatchObject({
      still: 2,
      'sheet:character': 2,
      'sheet:location': 1,
      'ref:element': 1,
    });
    expect(plan).toEqual(before);
  }
);

it('leaves all unbound images in the legacy estimator, including its unknown-price floors', () => {
  const plan = mockPlan([BUILTIN_MODEL]);
  const counts = Object.freeze({
    ...planCounts([]),
    still: 2,
    'sheet:character': 2,
    'sheet:location': 1,
    'ref:element': 1,
  });
  const result = partitionPlanImageEstimate({
    plan,
    counts,
    imageModelRouting: MOCK_ROUTING,
    pricing: {},
  });
  expect(result.counts).toBe(counts);
  expect(result).toMatchObject({
    costMicros: ZERO_MICROS,
    priced: undefined,
    imageSource: undefined,
  });
  expect(countBasedCost(counts, {})).toBe(usdToMicros(0.6));
  expect(countBasedCost(counts)).toBe(usdToMicros(0.18));
});

it.each([0.1, 0])(
  'prices a bound built-in at $%s through its captured route',
  (unitPriceUsd) => {
    const plan = mockPlan([BUILTIN_MODEL]);
    const result = partitionPlanImageEstimate({
      plan,
      counts: { ...OTHER_COUNTS, still: 1 },
      imageModelRouting: [
        {
          ...MOCK_ROUTE,
          modelId: BUILTIN_MODEL,
          priceCards: MOCK_ROUTE.priceCards.map((card) => ({
            ...card,
            unitPriceUsd,
          })),
        },
      ],
      pricing: MOCK_PRICING,
    });
    expect(result).toEqual({
      counts: OTHER_COUNTS,
      costMicros: usdToMicros(unitPriceUsd),
      priced: true,
      imageSource: 'platform',
    });
  }
);

it('uses the frozen picker fanout once per distinct model', () => {
  const plan = mockPlan([BUILTIN_MODEL]);
  plan.renderOptions = {
    imageModels: [BUILTIN_MODEL, CONFIGURED_MODEL, CONFIGURED_MODEL],
  };
  const result = partitionPlanImageEstimate({
    plan,
    counts: { ...OTHER_COUNTS, still: 1 },
    imageModelRouting: MOCK_ROUTING,
    pricing: MOCK_PRICING,
  });
  expect(result).toEqual({
    counts: OTHER_COUNTS,
    costMicros: usdToMicros(0.13),
    priced: true,
    imageSource: 'platform',
  });
});

it('quotes reference-only sheets without introducing a still', () => {
  const plan = mockPlan([]);
  plan.references = {
    ...mixedReferences(),
    characterSheets: [],
    lookSheetsAfterDefault: [],
    elementSheets: null,
  };
  const result = partitionPlanImageEstimate({
    plan,
    counts: { ...OTHER_COUNTS, 'sheet:location': 1 },
    imageModelRouting: MOCK_ROUTING,
    pricing: MOCK_PRICING,
  });
  expect(result).toEqual({
    counts: OTHER_COUNTS,
    costMicros: usdToMicros(0.2),
    priced: true,
    imageSource: 'platform',
  });
});

it('leaves a zero-image plan on the existing estimator even with a configured picker', () => {
  const plan = mockPlan([CONFIGURED_MODEL]);
  plan.targets = plan.targets.map((target) => ({
    ...target,
    regenImage: false,
  }));
  plan.renderOptions = { imageModels: [CONFIGURED_MODEL] };
  const result = partitionPlanImageEstimate({
    plan,
    counts: OTHER_COUNTS,
    imageModelRouting: MOCK_ROUTING,
    pricing: {},
  });
  expect(result.counts).toBe(OTHER_COUNTS);
  expect(result).toMatchObject({
    costMicros: ZERO_MICROS,
    priced: undefined,
    imageSource: undefined,
  });
});

it('refuses missing configured routes and missing configured prices before excluding counts', () => {
  const args = {
    plan: mockPlan([CONFIGURED_MODEL]),
    counts: { ...OTHER_COUNTS, still: 1 },
    pricing: MOCK_PRICING,
  };
  expect(() =>
    partitionPlanImageEstimate({ ...args, imageModelRouting: [] })
  ).toThrow('unavailable');
  expect(() =>
    partitionPlanImageEstimate({
      ...args,
      imageModelRouting: [{ ...MOCK_ROUTE, priceCards: [] }],
    })
  ).toThrow(/price/i);
  expect(args.counts.still).toBe(1);
});
