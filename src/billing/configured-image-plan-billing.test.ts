import { describe, expect, it } from 'vitest';
import type { ImageModelRoute } from '@/models/image-channels';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import type { PlanReferences } from '@/shots/server/update-stale-references';
import { asStub } from '@/test/as-stub';
import { TEST_FAL_PRICING } from './fal-pricing-fixture';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@/models/models';
import type { TextToImageModel } from '@/models/models';
import { micros } from './money';
import {
  quoteConfiguredPlanImages,
  estimatePlanImageCost,
  referenceSheetImageRequests,
  estimateReferenceSheetPlanCost,
  planUsesConfiguredImages,
} from './configured-image-plan-billing';

const MODEL = 'custom-image:mock-edit';
const route: ImageModelRoute = {
  modelId: MODEL,
  name: 'Mock edit model',
  channelId: 'mock-channel',
  protocol: 'openai-images',
  baseUrl: 'https://mock.invalid/v1',
  credentialId: 'mock-credential',
  operations: {
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
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      required: true,
      operations: ['edit'],
      defaultValue: '512x512',
      values: ['512x512', '1024x576'],
    },
  ],
  priceCards: [
    {
      id: 'edit-square',
      operation: 'edit',
      match: { size: '512x512' },
      unitPriceUsd: 0.02,
    },
    {
      id: 'edit-wide',
      operation: 'edit',
      match: { size: '1024x576' },
      unitPriceUsd: 0.03,
    },
  ],
};

function plan(
  references: PlanReferences | null = null,
  referenceIds = ['mock-reference'],
  imageReferenceCount = referenceIds.length
): Pick<UpdateStalePlan, 'targets' | 'references' | 'aspectRatio'> {
  return {
    aspectRatio: '16:9',
    references,
    targets: [
      asStub<UpdateStalePlan['targets'][number]>({
        imageModel: MODEL,
        regenImage: true,
        referenceIds,
        imageReferenceCount,
      }),
    ],
  };
}

function referencePlan(): PlanReferences {
  return asStub<PlanReferences>({
    characterSheets: [],
    lookSheetsAfterDefault: [],
    elementSheets: null,
    locationSheets: [{ imageModel: MODEL, referencePhotoUrls: ['mock-photo'] }],
  });
}

describe('configured image plan billing', () => {
  it('prices edit-only stills from the final references and wide execution size', () => {
    expect(quoteConfiguredPlanImages(plan(), [route])).toMatchObject({
      costMicros: 30000,
      creditFloorMicros: 30000,
      imageSource: 'platform',
    });
  });
  it('refuses an edit-only model without the references required for execution', () => {
    expect(() => quoteConfiguredPlanImages(plan(null, []), [route])).toThrow(
      'operation'
    );
    expect(() =>
      quoteConfiguredPlanImages(plan(null, ['one', 'two', 'three']), [route])
    ).toThrow('reference');
  });
  it('prices generate-only stills when dependencies provide no image inputs', () => {
    const request = plan(null, ['narrator', 'clip', 'audio'], 0);
    expect(
      quoteConfiguredPlanImages(request, [mockElementRoute()])
    ).toMatchObject({
      costMicros: 30000,
      imageSource: 'platform',
    });
  });
  it('validates only real images against the edit reference limit', () => {
    const request = plan(null, ['narrator', 'look', 'clip', 'audio'], 1);
    expect(quoteConfiguredPlanImages(request, [route]).costMicros).toBe(30000);
  });
  it('selects the generate price instead of the edit price for non-image dependencies', () => {
    const generate = mockElementRoute();
    const dualRoute: ImageModelRoute = {
      ...route,
      operations: { ...generate.operations, ...route.operations },
      parameters: route.parameters.map((parameter) => ({
        ...parameter,
        operations: ['generate', 'edit'],
      })),
      priceCards: [
        ...generate.priceCards.map((card) => ({ ...card, unitPriceUsd: 0.01 })),
        ...route.priceCards,
      ],
    };
    expect(
      quoteConfiguredPlanImages(plan(null, ['narrator', 'audio'], 0), [
        dualRoute,
      ]).costMicros
    ).toBe(10000);
    expect(
      quoteConfiguredPlanImages(plan(null, ['look'], 1), [dualRoute]).costMicros
    ).toBe(30000);
  });
  it('requires a frozen active route and an explicit configured price', () => {
    expect(() => quoteConfiguredPlanImages(plan(), [])).toThrow('unavailable');
    expect(() =>
      quoteConfiguredPlanImages(plan(), [{ ...route, priceCards: [] }])
    ).toThrow('No configured image price');
  });
  it('counts a custom reference-sheet model even when the sequence uses a built-in model', () => {
    const references = referencePlan();
    expect(
      estimateReferenceSheetPlanCost(references, 'flux_2_max', [route], {})
    ).toBe(30000);
    expect(
      quoteConfiguredPlanImages({ ...plan(references), targets: [] }, [route])
    ).toMatchObject({
      costMicros: 30000,
      imageSource: 'platform',
    });
  });
  it('prices a default character sheet photo with the edit rate', () => {
    const references = referencePlan();
    references.locationSheets = [];
    references.characterSheets = [
      asStub<PlanReferences['characterSheets'][number]>({
        imageModel: MODEL,
        face: null,
        referencePhotoUrl: 'https://mock.invalid/reference-photo.png',
      }),
    ];
    const generate = mockElementRoute();
    const dualRoute: ImageModelRoute = {
      ...route,
      operations: { ...generate.operations, ...route.operations },
      parameters: route.parameters.map((parameter) => ({
        ...parameter,
        operations: ['generate', 'edit'],
      })),
      priceCards: [
        ...generate.priceCards.map((card) => ({ ...card, unitPriceUsd: 0.01 })),
        ...route.priceCards,
      ],
    };
    const request = { ...plan(references), targets: [] };
    expect(quoteConfiguredPlanImages(request, [dualRoute])).toMatchObject({
      costMicros: 30000,
      creditFloorMicros: 30000,
    });
    expect(
      estimateReferenceSheetPlanCost(references, MODEL, [dualRoute], {})
    ).toBe(30000);
    expect(() => quoteConfiguredPlanImages(request, [generate])).toThrow(
      'operation'
    );
  });
  it('does not impose a configured image source on a plan with no image work', () => {
    const empty = { ...plan(), targets: [] };
    expect(planUsesConfiguredImages(empty)).toBe(false);
    expect(quoteConfiguredPlanImages(empty, []).imageSource).toBeUndefined();
  });
  it('sums request costs while keeping the gate at the most expensive single image', () => {
    const request = plan(referencePlan());
    expect(planUsesConfiguredImages(request)).toBe(true);
    expect(quoteConfiguredPlanImages(request, [route])).toMatchObject({
      costMicros: 60000,
      creditFloorMicros: 30000,
    });
  });
});

function mockElementRoute(): ImageModelRoute {
  return {
    ...route,
    operations: {
      generate: {
        upstreamModel: 'mock-element-generation',
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
        defaultValue: '512x512',
        values: ['512x512', '1024x576'],
      },
    ],
    priceCards: [
      {
        id: 'generate-square',
        operation: 'generate',
        match: { size: '512x512' },
        unitPriceUsd: 0.02,
      },
      {
        id: 'generate-wide',
        operation: 'generate',
        match: { size: '1024x576' },
        unitPriceUsd: 0.03,
      },
    ],
  };
}

function elementReferences(): PlanReferences {
  return asStub<PlanReferences>({
    characterSheets: [],
    lookSheetsAfterDefault: [],
    locationSheets: [],
    elementSheets: { imageModel: MODEL, entries: [{}] },
  });
}

describe('configured element sheet billing', () => {
  it('quotes and estimates the square size used by the element workflow', () => {
    const references = elementReferences();
    const elementRoute = mockElementRoute();
    expect(
      quoteConfiguredPlanImages({ ...plan(references), targets: [] }, [
        elementRoute,
      ])
    ).toMatchObject({
      costMicros: 20000,
      creditFloorMicros: 20000,
      imageSource: 'platform',
    });
    expect(
      estimateReferenceSheetPlanCost(references, MODEL, [elementRoute], {})
    ).toBe(20000);
  });

  it('accepts an element model with only a verified square size', () => {
    const elementRoute = mockElementRoute();
    const squareOnly: ImageModelRoute = {
      ...elementRoute,
      parameters: elementRoute.parameters.map((parameter) => ({
        ...parameter,
        values: ['512x512'],
      })),
      priceCards: elementRoute.priceCards.filter(
        (card) => card.id === 'generate-square'
      ),
    };
    expect(
      quoteConfiguredPlanImages({ ...plan(elementReferences()), targets: [] }, [
        squareOnly,
      ]).costMicros
    ).toBe(20000);
    expect(
      estimateReferenceSheetPlanCost(
        elementReferences(),
        MODEL,
        [squareOnly],
        {}
      )
    ).toBe(20000);
  });

  it('keeps character, look and location sheets wide with their actual reference counts', () => {
    const references = asStub<PlanReferences>({
      characterSheets: [{ imageModel: MODEL, face: null }],
      lookSheetsAfterDefault: [{ imageModel: MODEL }],
      locationSheets: [
        {
          imageModel: MODEL,
          referencePhotoUrls: ['mock-photo-1', 'mock-photo-2'],
        },
      ],
      elementSheets: { imageModel: MODEL, entries: [{}, {}] },
    });
    expect(
      referenceSheetImageRequests(references).map(
        ({ aspectRatio, referenceImageCount }) => [
          aspectRatio,
          referenceImageCount,
        ]
      )
    ).toEqual([
      ['16:9', 0],
      ['16:9', 1],
      ['16:9', 2],
      ['1:1', 0],
      ['1:1', 0],
    ]);
  });
  it('preserves per-sheet models, default fallback and one face across a mixed plan', () => {
    const references = asStub<PlanReferences>({
      characterSheets: [
        { imageModel: MODEL, face: null, referencePhotoUrl: null },
        {
          imageModel: 'flux_2_max',
          face: {
            url: 'https://mock.invalid/face.png',
            versionId: 'mock-face',
          },
          referencePhotoUrl: 'https://mock.invalid/photo.png',
        },
        { face: null, referencePhotoUrl: 'https://mock.invalid/photo.png' },
      ],
      lookSheetsAfterDefault: [{ imageModel: 'flux_2_max' }],
      locationSheets: [
        {
          imageModel: 'custom-image:mock-location',
          referencePhotoUrls: ['mock-photo-1', 'mock-photo-2'],
        },
      ],
      elementSheets: { imageModel: 'custom-image:mock-element', entries: [{}] },
    });
    expect(
      referenceSheetImageRequests(references).map(
        ({ model, aspectRatio, referenceImageCount }) => [
          model,
          aspectRatio,
          referenceImageCount,
        ]
      )
    ).toEqual([
      [MODEL, '16:9', 0],
      ['flux_2_max', '16:9', 1],
      [DEFAULT_IMAGE_MODEL, '16:9', 1],
      ['flux_2_max', '16:9', 1],
      ['custom-image:mock-location', '16:9', 2],
      ['custom-image:mock-element', '1:1', 0],
    ]);
  });
});

const BUILTIN_MODEL = 'flux_2_max';
const builtinRoute: ImageModelRoute = { ...route, modelId: BUILTIN_MODEL };

function builtinPlan(): Pick<
  UpdateStalePlan,
  'targets' | 'references' | 'aspectRatio' | 'sequence'
> {
  const original = plan();
  return {
    ...original,
    sequence: asStub<UpdateStalePlan['sequence']>({ resolution: '720p' }),
    targets: original.targets.map((target) => ({
      ...target,
      imageModel: BUILTIN_MODEL,
    })),
  };
}

describe('built-in configured image plan billing', () => {
  it('detects built-in bindings only in the supplied frozen route', () => {
    const request = builtinPlan();
    expect(planUsesConfiguredImages(request)).toBe(false);
    expect(planUsesConfiguredImages(request, [route])).toBe(false);
    expect(planUsesConfiguredImages(request, [builtinRoute])).toBe(true);
    expect(
      planUsesConfiguredImages(
        {
          ...request,
          targets: request.targets.map((target) => ({
            ...target,
            regenImage: false,
          })),
        },
        [builtinRoute]
      )
    ).toBe(false);
  });
  it('quotes bound built-in stills from their edit card', () => {
    expect(
      quoteConfiguredPlanImages(builtinPlan(), [builtinRoute])
    ).toMatchObject({
      costMicros: 30000,
      creditFloorMicros: 30000,
      imageSource: 'platform',
    });
    expect(() =>
      quoteConfiguredPlanImages(builtinPlan(), [
        { ...builtinRoute, priceCards: [] },
      ])
    ).toThrow('No configured image price');
  });
  it('counts bound built-in reference sheets even when targets are unbound', () => {
    const references = referencePlan();
    references.locationSheets = references.locationSheets.map((sheet) => ({
      ...sheet,
      imageModel: BUILTIN_MODEL,
    }));
    expect(
      planUsesConfiguredImages({ targets: [], references }, [builtinRoute])
    ).toBe(true);
    expect(
      quoteConfiguredPlanImages({ ...plan(references), targets: [] }, [
        builtinRoute,
      ]).costMicros
    ).toBe(30000);
    expect(
      estimateReferenceSheetPlanCost(
        references,
        'nano_banana_2',
        [builtinRoute],
        TEST_FAL_PRICING
      )
    ).toBe(30000);
  });
  it('sums custom, bound built-in and unbound fal images once using the same snapshot', () => {
    const request = builtinPlan();
    const falTarget = asStub<UpdateStalePlan['targets'][number]>({
      imageModel: 'nano_banana_2',
      regenImage: true,
      referenceIds: [],
      imageReferenceCount: 0,
    });
    const mixed = {
      ...request,
      targets: [...request.targets, ...plan().targets, falTarget],
    };
    const pricing = {
      [IMAGE_MODELS.nano_banana_2.id]: {
        unitPrice: micros(7000),
        unit: 'images',
        typicalUnitsPerCall: 1,
      },
    };
    expect(
      estimatePlanImageCost(mixed, [builtinRoute, route], pricing)
    ).toMatchObject({
      costMicros: 67000,
      creditFloorMicros: 30000,
      imageSource: 'platform',
      priced: true,
    });
    expect(
      estimatePlanImageCost(
        { ...request, targets: [] },
        [builtinRoute],
        pricing
      )
    ).toMatchObject({
      costMicros: 0,
      imageSource: undefined,
      priced: true,
    });
  });
  it('preserves the unknown-price floor for unbound models in a mixed plan', () => {
    const request = builtinPlan();
    const unknown = asStub<UpdateStalePlan['targets'][number]>({
      imageModel: 'nano_banana_2',
      regenImage: true,
      referenceIds: [],
      imageReferenceCount: 0,
    });
    expect(
      estimatePlanImageCost(
        { ...request, targets: [...request.targets, unknown] },
        [builtinRoute],
        {}
      )
    ).toMatchObject({
      costMicros: 130000,
      creditFloorMicros: 30000,
      imageSource: 'platform',
      priced: false,
    });
  });
  it('uses generation prices for square bound built-in element sheets', () => {
    const elementRoute: ImageModelRoute = {
      ...mockElementRoute(),
      modelId: BUILTIN_MODEL,
    };
    const references = elementReferences();
    if (!references.elementSheets)
      throw new Error('Mock element references are required.');
    references.elementSheets.imageModel = BUILTIN_MODEL;
    expect(
      estimateReferenceSheetPlanCost(
        references,
        BUILTIN_MODEL,
        [elementRoute],
        TEST_FAL_PRICING
      )
    ).toBe(20000);
    expect(
      quoteConfiguredPlanImages({ ...plan(references), targets: [] }, [
        elementRoute,
      ]).costMicros
    ).toBe(20000);
  });
});

const SECOND_MODEL = 'custom-image:mock-second';
const secondRoute: ImageModelRoute = { ...route, modelId: SECOND_MODEL };
const mockFanoutPricing = {
  [IMAGE_MODELS.nano_banana_2.id]: {
    unitPrice: micros(7000),
    unit: 'images',
    typicalUnitsPerCall: 1,
  },
};

function fanoutPlan(
  imageModels?: TextToImageModel[],
  imageModel: TextToImageModel = MODEL
): ReturnType<typeof builtinPlan> & Pick<UpdateStalePlan, 'renderOptions'> {
  return {
    ...builtinPlan(),
    targets: plan().targets.map((target) => ({ ...target, imageModel })),
    ...(imageModels ? { renderOptions: { imageModels } } : {}),
  };
}

describe('image plan execution fanout billing', () => {
  it('prices every distinct configured model once per rendered target', () => {
    const request = fanoutPlan([MODEL, SECOND_MODEL, MODEL]);
    const target = request.targets[0];
    if (!target) throw new Error('Mock fanout target is required.');
    request.targets.push({
      ...target,
      shotId: 'mock-second-shot',
    });
    expect(planUsesConfiguredImages(request, [route, secondRoute])).toBe(true);
    expect(
      quoteConfiguredPlanImages(request, [route, secondRoute])
    ).toMatchObject({
      costMicros: 120000,
      creditFloorMicros: 30000,
      imageSource: 'platform',
    });
    expect(
      estimatePlanImageCost(request, [route, secondRoute], {})
    ).toMatchObject({
      costMicros: 120000,
      priced: true,
    });
  });

  it.each([
    ['nano_banana_2', MODEL],
    [MODEL, 'nano_banana_2'],
  ] satisfies TextToImageModel[][])(
    'detects and prices configured alternates in mixed fanout %s / %s',
    (first, second) => {
      const request = fanoutPlan([first, second, first], 'nano_banana_2');
      expect(planUsesConfiguredImages(request, [route])).toBe(true);
      expect(quoteConfiguredPlanImages(request, [route]).costMicros).toBe(
        30000
      );
      expect(
        estimatePlanImageCost(request, [route], mockFanoutPricing)
      ).toMatchObject({
        costMicros: 37000,
        creditFloorMicros: 30000,
        imageSource: 'platform',
        priced: true,
      });
    }
  );

  it('uses render models instead of also charging the target model', () => {
    const request = fanoutPlan(['nano_banana_2']);
    expect(planUsesConfiguredImages(request, [route])).toBe(false);
    expect(quoteConfiguredPlanImages(request, [route]).costMicros).toBe(0);
    expect(
      estimatePlanImageCost(request, [route], mockFanoutPricing)
    ).toMatchObject({
      costMicros: 7000,
      imageSource: undefined,
      priced: true,
    });
  });

  it.each([undefined, []])(
    'keeps one target-model request without a populated render list %j',
    (models) => {
      const request = fanoutPlan(models);
      expect(planUsesConfiguredImages(request, [route])).toBe(true);
      expect(estimatePlanImageCost(request, [route], {})).toMatchObject({
        costMicros: 30000,
        priced: true,
      });
    }
  );

  it('does not multiply reference sheets by the per-shot model fanout', () => {
    const request = fanoutPlan([MODEL, SECOND_MODEL, MODEL]);
    request.references = referencePlan();
    expect(
      quoteConfiguredPlanImages(request, [route, secondRoute]).costMicros
    ).toBe(90000);
    expect(
      estimatePlanImageCost(request, [route, secondRoute], {}).costMicros
    ).toBe(90000);
    request.targets = request.targets.map((target) => ({
      ...target,
      regenImage: false,
    }));
    expect(
      estimatePlanImageCost(request, [route, secondRoute], {}).costMicros
    ).toBe(30000);
    request.references = null;
    expect(planUsesConfiguredImages(request, [route, secondRoute])).toBe(false);
    expect(
      estimatePlanImageCost(request, [route, secondRoute], {}).costMicros
    ).toBe(0);
  });

  it('checks every configured alternate before any image is submitted', () => {
    const request = fanoutPlan(['nano_banana_2', SECOND_MODEL]);
    expect(() => estimatePlanImageCost(request, [], mockFanoutPricing)).toThrow(
      'unavailable'
    );
    expect(() =>
      estimatePlanImageCost(
        request,
        [{ ...secondRoute, priceCards: [] }],
        mockFanoutPricing
      )
    ).toThrow('No configured image price');
  });

  it('keeps the unknown-price floor for an unpriced alternate', () => {
    const request = fanoutPlan([MODEL, 'nano_banana_2']);
    expect(estimatePlanImageCost(request, [route], {})).toMatchObject({
      costMicros: 130000,
      priced: false,
    });
  });
});
