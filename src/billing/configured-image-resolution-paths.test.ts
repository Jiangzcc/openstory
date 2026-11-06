import { describe, expect, it } from 'vitest';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import {
  createImageModelRoutingSnapshot,
  toImageModelCatalog,
} from '@/models/image-channels';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { buildUpdateStalePreview } from '@/shots/server/update-stale-preview';
import { asStub } from '@/test/as-stub';
import { estimateImageCost } from './cost-estimation';
import {
  quoteConfiguredPlanImages,
  estimatePlanImageCost,
} from './configured-image-plan-billing';
import { imageCostHint } from './image-cost-hint';

// Synthetic rate cards only; no provider calls, credentials or application data.
function mockRouting() {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model');
  model.parameters = [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      defaultValue: '1280x720',
      values: ['1280x720', '1920x1080'],
    },
  ];
  model.priceCards = (['generate', 'edit'] as const).flatMap((operation) => [
    {
      id: operation + '-720',
      operation,
      match: { size: '1280x720' },
      unitPriceUsd: 0.1,
    },
    {
      id: operation + '-1080',
      operation,
      match: { size: '1920x1080' },
      unitPriceUsd: 0.2,
    },
  ]);
  return createImageModelRoutingSnapshot(configuration);
}

function mockPlan(imageReferenceCount = 0) {
  return asStub<UpdateStalePlan>({
    aspectRatio: '16:9',
    sequence: {
      resolution: '1080p',
      imageModel: 'custom-image:qwen',
      videoModel: 'seedance_v2',
    },
    targets: [
      {
        shotId: 'mock-shot',
        imageModel: 'custom-image:qwen',
        regenImage: true,
        referenceIds: ['mock-voice', 'mock-video', 'mock-location'],
        imageReferenceCount,
      },
    ],
    references: null,
    music: null,
    dialogueSpeech: null,
  });
}

describe('configured resolution through billing entrypoints', () => {
  it.each([
    ['720p', 100000],
    ['1080p', 200000],
  ] as const)(
    'uses the %s rate for a multi-image estimate and the public hint',
    (resolution, price) => {
      const imageModelRouting = mockRouting();
      expect(
        estimateImageCost('custom-image:qwen', '16:9', 3, {
          pricing: {},
          imageModelRouting,
          resolution,
        })
      ).toBe(3 * price);
      expect(
        imageCostHint(
          {
            model: 'custom-image:qwen',
            aspectRatio: '16:9',
            resolution,
            imageCount: 1,
            referenceImageCount: 0,
          },
          mergeImageModelCatalog(toImageModelCatalog(imageModelRouting)),
          null
        )
      ).toEqual({ estimate: price, issue: null });
    }
  );

  it('preserves the sequence tier in both the credit floor and full plan estimate', () => {
    const plan = mockPlan();
    const routing = mockRouting();
    expect(quoteConfiguredPlanImages(plan, routing)).toMatchObject({
      costMicros: 200000,
      creditFloorMicros: 200000,
    });
    expect(estimatePlanImageCost(plan, routing, {})).toMatchObject({
      costMicros: 200000,
      priced: true,
    });
  });

  it('keeps reference sheets on their own size while pricing a 1080p shot', () => {
    const plan = mockPlan();
    plan.references = asStub<NonNullable<UpdateStalePlan['references']>>({
      characterSheets: [],
      lookSheetsAfterDefault: [],
      elementSheets: null,
      locationSheets: [
        { imageModel: 'custom-image:qwen', referencePhotoUrls: [] },
      ],
    });
    expect(quoteConfiguredPlanImages(plan, mockRouting())).toMatchObject({
      costMicros: 300000,
      creditFloorMicros: 200000,
    });
  });

  it.each([0, 1])(
    'prices previews using %s actual images instead of dependency IDs',
    (count) => {
      const routing = mockRouting().map((route) => ({
        ...route,
        priceCards: route.priceCards.map((card) => ({
          ...card,
          unitPriceUsd:
            card.operation === 'edit'
              ? card.unitPriceUsd * 2
              : card.unitPriceUsd,
        })),
        operations: {
          ...route.operations,
          edit: route.operations.edit
            ? { ...route.operations.edit, maxReferenceImages: 1 }
            : undefined,
        },
      }));
      expect(
        buildUpdateStalePreview(mockPlan(count), {}, null, routing).costByLevel
          .images
      ).toBe(count > 0 ? 400000 : 200000);
    }
  );
});
