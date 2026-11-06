import { describe, expect, it } from 'vitest';
import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import type { ImageModelCatalogEntry } from '@/models/image-channels';
import { IMAGE_MODELS, getEditEndpoint } from '@/models/models';
import { imageCostHint } from './image-cost-hint';
import type { ImageCostHintInput } from './image-cost-hint';
import { estimateImageCost } from './cost-estimation';
import { micros } from './money';
import type { EffectiveFalPricing } from './fal-cost';

// Synthetic public price cards and fal rates; no provider or credential access.
const pricing: Record<string, EffectiveFalPricing> = {
  'fal-ai/flux-2': { unitPrice: micros(900_000), unit: 'images' },
  'fal-ai/flux-2/edit': { unitPrice: micros(800_000), unit: 'images' },
};
const request: ImageCostHintInput = {
  model: 'flux_2_dev',
  aspectRatio: '16:9',
  referenceImageCount: 0,
};
function boundModel(overrides: Partial<ImageModelCatalogEntry> = {}) {
  return imageCatalogFixture({ id: request.model, ...overrides });
}
function quote(
  input: Partial<ImageCostHintInput> = {},
  configuration = boundModel()
) {
  return imageCostHint(
    { ...request, ...input },
    mergeImageModelCatalog([configuration]),
    pricing
  );
}

describe('public image price hints', () => {
  it('overrides the old fal price for bound built-ins and selects the actual operation', () => {
    expect(quote()).toEqual({ estimate: micros(100_000), issue: null });
    expect(quote({ referenceImageCount: 1 })).toEqual({
      estimate: micros(200_000),
      issue: null,
    });
    expect(quote({ referenceImageCount: 8 })).toEqual({
      estimate: micros(200_000),
      issue: null,
    });
  });

  it('quotes a custom model without waiting for the fal pricing query', () => {
    const configuration = imageCatalogFixture();
    expect(
      imageCostHint(
        { ...request, model: configuration.id },
        mergeImageModelCatalog([configuration]),
        null,
        true
      )
    ).toEqual({ estimate: micros(100_000), issue: null });
  });

  it('matches resolved aspect, quality and exact native output count', () => {
    const configuration = boundModel();
    configuration.parameters.push(
      {
        key: 'n',
        label: 'Count',
        type: 'integer',
        status: 'verified',
        operations: ['generate', 'edit'],
        required: false,
        minimum: 1,
        maximum: 16,
        defaultValue: 4,
      },
      {
        key: 'quality',
        label: 'Quality',
        type: 'string',
        status: 'verified',
        operations: ['generate', 'edit'],
        required: false,
        values: ['low', 'high'],
        defaultValue: 'low',
      }
    );
    configuration.priceCards.push({
      id: 'high-edit',
      operation: 'edit',
      match: { size: '1024x576', quality: 'high', n: 3 },
      unitPriceUsd: 0.375,
    });
    expect(
      quote(
        {
          referenceImageCount: 2,
          imageCount: 3,
          parameters: { quality: 'high' },
          hasMask: true,
        },
        configuration
      )
    ).toEqual({ estimate: micros(1_125_000), issue: null });
    expect(quote({}, configuration).estimate).toBe(micros(100_000));
    expect(quote({ parameters: { n: 4 } }, configuration).issue).not.toBeNull();
  });

  it('respects explicit valid parameters and refuses unknown or unverified fields', () => {
    const configuration = boundModel();
    configuration.priceCards.push({
      id: 'large',
      operation: 'generate',
      match: { size: '1536x1024' },
      unitPriceUsd: 0.45,
    });
    expect(
      quote({ parameters: { size: '1536x1024' } }, configuration).estimate
    ).toBe(micros(450_000));
    expect(
      quote({ parameters: { size: '999x999' } }, configuration).issue
    ).not.toBeNull();
    expect(
      quote({ parameters: { quality: 'high' } }, configuration).issue
    ).not.toBeNull();
    const size = configuration.parameters[0];
    if (!size) throw new Error('Missing synthetic size.');
    size.status = 'unverified';
    expect(
      quote({ parameters: { size: '1024x576' } }, configuration).issue
    ).not.toBeNull();
  });

  it('validates the actual reference count and verified mask capability', () => {
    const configuration = boundModel();
    configuration.operations.edit = {
      status: 'verified',
      minReferenceImages: 2,
      maxReferenceImages: 3,
      mask: 'unsupported',
    };
    expect(quote({ referenceImageCount: 2 }, configuration).issue).toBeNull();
    for (const referenceImageCount of [-1, 1, 4, 1.5]) {
      expect(quote({ referenceImageCount }, configuration)).toEqual({
        estimate: null,
        issue:
          'Configured image parameters are unavailable for this operation.',
      });
    }
    expect(
      quote({ referenceImageCount: 2, hasMask: true }, configuration).issue
    ).not.toBeNull();
    expect(quote({ hasMask: true }).issue).not.toBeNull();
  });

  it('never falls back to a fal quote when a binding, price or model is unavailable', () => {
    const configuration = boundModel();
    configuration.operations.generate = {
      status: 'unverified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    };
    expect(quote({}, configuration)).toEqual({
      estimate: null,
      issue: 'Configured image parameters are unavailable for this operation.',
    });
    expect(quote({}, boundModel({ priceCards: [] }))).toEqual({
      estimate: null,
      issue: 'Check the image parameters and configured price.',
    });
    expect(quote({}, boundModel({ available: false }))).toEqual({
      estimate: null,
      issue: 'The selected image model is unavailable.',
    });
    expect(
      imageCostHint(
        { ...request, model: 'custom-image:removed' },
        mergeImageModelCatalog(),
        pricing
      )
    ).toEqual({
      estimate: null,
      issue: 'The selected image model is unavailable.',
    });
  });

  it('makes ambiguous prices and invalid native counts explicit failures', () => {
    const configuration = boundModel();
    configuration.priceCards.push({
      id: 'duplicate',
      operation: 'generate',
      match: {},
      unitPriceUsd: 0.3,
    });
    expect(quote({}, configuration)).toEqual({
      estimate: null,
      issue: 'Check the image parameters and configured price.',
    });
    for (const imageCount of [0, 1.5, 17])
      expect(quote({ imageCount }).issue).not.toBeNull();
    expect(quote({ imageCount: 2 }).issue).not.toBeNull();
  });

  it('rejects prices below wallet precision while retaining an explicit free price', () => {
    const configuration = boundModel();
    configuration.priceCards = [
      {
        id: 'tiny',
        operation: 'generate',
        match: {},
        unitPriceUsd: 0.00000001,
      },
    ];
    expect(quote({}, configuration).issue).not.toBeNull();
    configuration.priceCards = [
      { id: 'free', operation: 'generate', match: {}, unitPriceUsd: 0 },
    ];
    expect(quote({}, configuration)).toEqual({
      estimate: micros(0),
      issue: null,
    });
  });

  it('does not guess the operation while references are still loading', () => {
    expect(quote({ referenceImageCount: undefined })).toEqual({
      estimate: undefined,
      issue: null,
    });
  });

  it('keeps unbound fal models on the existing estimator with actual edit and resolution', () => {
    const model = 'flux_2_max';
    const falPricing = {
      [IMAGE_MODELS[model].id]: {
        unitPrice: micros(70_000),
        unit: 'megapixels',
      },
      [getEditEndpoint(model) ?? 'unused']: {
        unitPrice: micros(80_000),
        unit: 'megapixels',
      },
    };
    for (const referenceImageCount of [0, 2]) {
      const input: ImageCostHintInput = {
        ...request,
        model,
        resolution: '4k',
        referenceImageCount,
      };
      const expected = estimateImageCost(model, input.aspectRatio, 1, {
        pricing: falPricing,
        resolution: '4k',
        edit: referenceImageCount > 0,
        referenceImageCount,
      });
      expect(expected).not.toBeNull();
      expect(
        imageCostHint(input, mergeImageModelCatalog(), falPricing)
      ).toEqual({ estimate: expected, issue: null });
    }
    expect(
      imageCostHint(request, mergeImageModelCatalog(), null, true).estimate
    ).toBeUndefined();
    expect(
      imageCostHint(request, mergeImageModelCatalog(), null).estimate
    ).toBeNull();
  });
});
