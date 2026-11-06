import { describe, expect, it } from 'vitest';
import { microsToUsd } from '@/billing/money';
import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import type { ImageChannelParameter } from '@/models/image-channel-parameters';
import type { ImageModelCatalogEntry } from '@/models/image-channels';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import { studioCreateInputSchema } from '@/studio/schema';
import { STUDIO_IMAGE_COUNT_ERROR } from './configured-image-count';
import {
  evaluateStudioImageSettings,
  isPngMaskFile,
  readStoredStudioImageSettings,
} from './configured-image-settings';
import type { StudioImageSettingsInput } from './configured-image-settings';

function parameter(
  overrides: Partial<ImageChannelParameter> = {}
): ImageChannelParameter {
  return {
    key: 'quality',
    label: 'Quality',
    type: 'string',
    status: 'verified',
    operations: ['generate', 'edit'],
    required: true,
    defaultValue: 'high',
    ...overrides,
  };
}

function nativeCount(
  overrides: Partial<ImageChannelParameter> = {}
): ImageChannelParameter {
  return parameter({
    key: 'n',
    label: 'Count',
    type: 'integer',
    minimum: 1,
    maximum: 16,
    defaultValue: 1,
    ...overrides,
  });
}

function configuration(): ImageModelCatalogEntry {
  const model = imageCatalogFixture();
  model.parameters = [
    parameter({
      key: 'size',
      label: 'Size',
      defaultValue: '1024x1024',
      values: [
        '1280x720',
        '1920x1080',
        '3840x2160',
        '720x1280',
        '1080x1920',
        '2160x3840',
        '1024x1024',
      ],
    }),
    nativeCount(),
    parameter(),
    parameter({ key: 'output_format', label: 'Format', defaultValue: 'jpeg' }),
    parameter({
      key: 'output_compression',
      label: 'Compression',
      type: 'integer',
      minimum: 0,
      maximum: 100,
      defaultValue: 80,
    }),
  ];
  return model;
}

function evaluate(
  model = configuration(),
  input: Partial<StudioImageSettingsInput> = {}
) {
  return evaluateStudioImageSettings({
    modelId: model.id,
    catalog: mergeImageModelCatalog([model]),
    referenceCount: 0,
    aspectRatio: '16:9',
    resolution: '720p',
    totalImageCount: 1,
    ...input,
  });
}

// Synthetic administrator definitions and USD price cards; no supplier calls or database writes.
describe('Configured Studio image output settings', () => {
  it('resolves the requested ratio and resolution instead of injecting the size default', () => {
    const settings = evaluate();
    expect(settings.issue).toBeNull();
    expect(settings.parameters.size).toBe('1280x720');
    expect(settings.aspectRatio).toBe('16:9');
    expect(settings.resolution).toBe('720p');
    expect(settings.outputOptions.aspectRatios).toEqual([
      '16:9',
      '9:16',
      '1:1',
    ]);
    expect(settings.outputOptions.resolutions).toEqual(['720p', '1080p']);
    expect(settings.requestParameters).toEqual({ n: 1 });
  });

  it.each([
    ['16:9', '1080p', '1920x1080'],
    ['9:16', '4k', '1080x1920'],
    ['1:1', '4k', '1024x1024'],
  ] as const)(
    'uses %s at %s without a stale raw size',
    (aspectRatio, resolution, size) => {
      const settings = evaluate(undefined, { aspectRatio, resolution });
      expect(settings.issue).toBeNull();
      expect(settings.parameters.size).toBe(size);
      expect(settings.requestParameters).not.toHaveProperty('size');
    }
  );

  it('narrows a fixed Qwen output and retains the selected total quantity', () => {
    const model = configuration();
    model.parameters[0] = parameter({
      key: 'size',
      label: 'Size',
      values: ['720x720'],
      defaultValue: '720x720',
    });
    model.parameters[1] = nativeCount({ values: [1], maximum: 1 });
    const settings = evaluate(model, {
      aspectRatio: '9:16',
      resolution: '4k',
      totalImageCount: 4,
    });
    expect(settings.issue).toBeNull();
    expect(settings.aspectRatio).toBe('1:1');
    expect(settings.resolution).toBe('720p');
    expect(settings.outputOptions).toEqual({
      aspectRatios: ['1:1'],
      resolutions: ['720p'],
      fixedSize: '720x720',
      automatic: false,
    });
    expect(settings.parameters.n).toBe(1);
    expect(settings.requestCount).toBe(4);
    expect(settings.totalImageCount).toBe(4);
    expect(settings.estimate && microsToUsd(settings.estimate)).toBe(0.4);
  });

  it('derives separate valid output choices for the current operation', () => {
    const model = configuration();
    model.parameters = [
      parameter({
        key: 'size',
        label: 'Size',
        operations: ['generate'],
        values: ['1280x720'],
        defaultValue: '1280x720',
      }),
      parameter({
        key: 'size',
        label: 'Size',
        operations: ['edit'],
        values: ['720x720'],
        defaultValue: '720x720',
      }),
      nativeCount(),
    ];
    const generate = evaluate(model);
    const edit = evaluate(model, { referenceCount: 1 });
    expect(generate.outputOptions.aspectRatios).toEqual(['16:9']);
    expect(edit.outputOptions.aspectRatios).toEqual(['1:1']);
    expect(edit.parameters.size).toBe('720x720');
    expect(edit.operation).toBe('edit');
    expect(edit.issue).toBeNull();
  });

  it('does not offer sizes from unverified capability definitions', () => {
    const model = configuration();
    model.parameters = [
      parameter({
        key: 'size',
        label: 'Size',
        status: 'unverified',
        values: ['1280x720'],
      }),
    ];
    const settings = evaluate(model);
    expect(settings.parameters).toEqual({});
    expect(settings.outputOptions).toEqual({
      aspectRatios: [],
      resolutions: [],
      automatic: true,
    });
    expect(settings.requestParameters).toEqual({});
  });

  it('represents verified automatic output without pretending the dimensions are fixed', () => {
    const model = configuration();
    model.parameters[0] = parameter({
      key: 'size',
      label: 'Size',
      values: ['auto'],
      defaultValue: 'auto',
    });
    const settings = evaluate(model);
    expect(settings.issue).toBeNull();
    expect(settings.parameters.size).toBe('auto');
    expect(settings.outputOptions.automatic).toBe(true);
    expect(settings.outputOptions.fixedSize).toBeUndefined();
    expect(settings.outputOptions.aspectRatios).toEqual([]);
    expect(settings.outputOptions.resolutions).toEqual([]);
  });

  it('fails closed when no verified size matches a supported UI ratio', () => {
    const model = configuration();
    model.parameters[0] = parameter({
      key: 'size',
      label: 'Size',
      values: ['1536x1024'],
      defaultValue: '1536x1024',
    });
    expect(evaluate(model).issue?.key).toBe('Choose a verified image size.');
  });
});

describe('Configured defaults and image quoting', () => {
  it('prices the complete administrator defaults but sends only the native count override', () => {
    const model = configuration();
    model.priceCards.unshift({
      id: 'high-jpeg',
      operation: 'generate',
      match: { quality: 'high', output_format: 'jpeg', output_compression: 80 },
      unitPriceUsd: 0.3,
    });
    const settings = evaluate(model, { totalImageCount: 4 });
    expect(settings.parameters).toEqual({
      size: '1280x720',
      n: 1,
      quality: 'high',
      output_format: 'jpeg',
      output_compression: 80,
    });
    expect(settings.requestParameters).toEqual({ n: 1 });
    expect(settings.quote?.priceCardId).toBe('high-jpeg');
    expect(settings.estimate && microsToUsd(settings.estimate)).toBe(1.2);
    expect(settings.totalImageCount).toBe(4);
  });

  it('adopts changed administrator defaults without reapplying historical hidden fields', () => {
    const saved = readStoredStudioImageSettings({
      count: 2,
      channelParameters: {
        n: 2,
        size: 'old-size',
        quality: 'low',
        output_format: 'png',
        output_compression: 3,
        seed: 99,
      },
    });
    expect(saved.totalImageCount).toBe(4);
    const model = configuration();
    model.parameters.push(
      parameter({
        key: 'seed',
        label: 'Seed',
        type: 'integer',
        defaultValue: 5,
      })
    );
    const settings = evaluate(model, {
      totalImageCount: saved.totalImageCount ?? 1,
      aspectRatio: '9:16',
      resolution: '1080p',
    });
    expect(settings.issue).toBeNull();
    expect(settings.parameters).toMatchObject({
      size: '1080x1920',
      quality: 'high',
      output_format: 'jpeg',
      output_compression: 80,
      seed: 5,
    });
    expect(settings.requestParameters).toEqual({ n: 1 });
  });

  it('refuses a missing hidden default and identifies the administrator setting', () => {
    const model = configuration();
    model.parameters.push(
      parameter({
        key: 'response_format',
        label: 'Transport',
        defaultValue: undefined,
      })
    );
    expect(evaluate(model).issue).toEqual({
      key: 'The model has no valid default for {{parameter}}. Contact an administrator.',
      values: { parameter: 'Transport' },
    });
  });

  it('does not invent a zero estimate for a missing or ambiguous price', () => {
    const model = configuration();
    model.priceCards = [];
    expect(evaluate(model).issue?.key).toBe(
      'No USD price is configured for these parameters.'
    );
    model.priceCards = [
      { id: 'one', operation: 'generate', match: {}, unitPriceUsd: 0.1 },
      { id: 'two', operation: 'generate', match: {}, unitPriceUsd: 0.2 },
    ];
    expect(evaluate(model).issue?.key).toBe(
      'More than one USD price matches these parameters.'
    );
    expect(evaluate(model).estimate).toBeNull();
  });

  it('rejects positive prices that cannot be represented by the wallet', () => {
    const model = configuration();
    model.priceCards = [
      {
        id: 'tiny',
        operation: 'generate',
        match: {},
        unitPriceUsd: 0.00000001,
      },
    ];
    expect(evaluate(model).issue?.key).toBe(
      'The configured price is outside wallet precision.'
    );
  });

  it('prices a legal native divisor without multiplying the requested total', () => {
    const model = configuration();
    model.parameters[1] = nativeCount({
      values: [2, 4],
      minimum: 2,
      defaultValue: 2,
    });
    const settings = evaluate(model, { totalImageCount: 4 });
    expect(settings.issue).toBeNull();
    expect(settings.availableCounts).toEqual([2, 4]);
    expect(settings.requestParameters).toEqual({ n: 2 });
    expect(settings.requestCount).toBe(2);
    expect(settings.totalImageCount).toBe(4);
    expect(settings.estimate && microsToUsd(settings.estimate)).toBe(0.4);
  });

  it('reports an impossible native combination so generation stays disabled', () => {
    const model = configuration();
    model.parameters[1] = nativeCount({
      values: [3],
      minimum: 3,
      maximum: 3,
      defaultValue: 3,
    });
    const settings = evaluate(model, { totalImageCount: 4 });
    expect(settings.availableCounts).toEqual([]);
    expect(settings.issue).toEqual({
      key: STUDIO_IMAGE_COUNT_ERROR,
      values: { count: 4 },
    });
    expect(settings.estimate).toBeNull();
  });

  it.each([0, 3, 8, 1.5])(
    'reports an unsupported saved total %s instead of changing it',
    (totalImageCount) => {
      const settings = evaluate(undefined, { totalImageCount });
      expect(settings.issue?.key).toBe(STUDIO_IMAGE_COUNT_ERROR);
      expect(settings.totalImageCount).toBe(totalImageCount);
    }
  );
});

describe('Configured references and masks', () => {
  it('keeps the verified edit reference limit and rejects excess attachments', () => {
    const settings = evaluate(undefined, { referenceCount: 8 });
    expect(settings.issue).toBeNull();
    expect(settings.referenceLimit).toBe(8);
    expect(evaluate(undefined, { referenceCount: 9 }).issue?.values).toEqual({
      maximum: 8,
    });
  });

  it('explains edit-only models without inventing a generate operation', () => {
    const model = configuration();
    delete model.operations.generate;
    expect(evaluate(model).issue?.key).toBe(
      'Attach between {{minimum}} and {{maximum}} reference images for this model.'
    );
    expect(evaluate(model, { referenceCount: 1 }).issue).toBeNull();
  });

  it('preserves masks only for verified edits with reference images', () => {
    const model = configuration();
    expect(evaluate(model, { maskImageUrl: '/r2/mask.png' }).issue?.key).toBe(
      'A mask requires reference images and verified mask editing.'
    );
    const settings = evaluate(model, {
      referenceCount: 1,
      maskImageUrl: ' /r2/mask.png ',
    });
    expect(settings.issue).toBeNull();
    expect(settings.maskImageUrl).toBe('/r2/mask.png');
    model.operations.edit = {
      status: 'verified',
      minReferenceImages: 1,
      maxReferenceImages: 8,
      mask: 'unverified',
    };
    expect(
      evaluate(model, { referenceCount: 1, maskImageUrl: '/r2/mask.png' }).issue
    ).not.toBeNull();
  });

  it('rejects malformed mask URLs and preserves invalid stored mask feedback', () => {
    expect(
      evaluate(undefined, {
        referenceCount: 1,
        maskImageUrl: 'javascript:alert(1)',
      }).issue?.key
    ).toBe('Enter a valid mask image URL.');
    expect(
      readStoredStudioImageSettings({ maskImageUrl: 9 }).imageSettingsIssue?.key
    ).toBe('Enter a valid mask image URL.');
    expect(
      readStoredStudioImageSettings({ maskImageUrl: '/r2/mask.png' })
        .maskImageUrl
    ).toBe('/r2/mask.png');
  });

  it('passes minimal configured request parameters and masks through the existing schema', () => {
    const settings = evaluate(undefined, {
      referenceCount: 1,
      totalImageCount: 4,
      maskImageUrl: '/r2/mask.png',
    });
    expect(
      studioCreateInputSchema.safeParse({
        activity: 'image',
        prompt: 'Synthetic prompt',
        imageModel: settings.model?.id,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        count: settings.requestCount,
        channelParameters: settings.requestParameters,
        referenceImages: ['/r2/reference.png'],
        maskImageUrl: settings.maskImageUrl,
      }).success
    ).toBe(true);
  });

  it('keeps the existing PNG upload restriction', () => {
    expect(isPngMaskFile({ type: 'image/png', name: 'mask.PNG' })).toBe(true);
    expect(isPngMaskFile({ type: 'image/jpeg', name: 'mask.png' })).toBe(false);
    expect(isPngMaskFile({ type: 'image/png', name: 'mask.jpg' })).toBe(false);
  });
});

describe('Built-in and unavailable Studio image models', () => {
  it('keeps built-in reference controls without requiring configured prices', () => {
    const settings = evaluate(undefined, {
      modelId: 'flux_2_dev',
      catalog: mergeImageModelCatalog(),
    });
    expect(settings.isConfigured).toBe(false);
    expect(settings.issue).toBeNull();
    expect(settings.referenceLimit).toBeGreaterThan(0);
    expect(settings.requestCount).toBe(1);
    expect(settings.requestParameters).toEqual({});
  });

  it('retains a bound built-in identity while using configured controls', () => {
    const model: ImageModelCatalogEntry = {
      ...configuration(),
      id: 'gpt_image_2',
    };
    const settings = evaluate(model, { totalImageCount: 2 });
    expect(settings.isConfigured).toBe(true);
    expect(settings.model?.id).toBe('gpt_image_2');
    expect(settings.requestCount).toBe(2);
  });

  it('does not fall back from unavailable custom models', () => {
    expect(
      evaluate(undefined, { modelId: 'custom-image:missing' }).issue?.key
    ).toBe('The selected image model is unavailable.');
    expect(evaluate({ ...configuration(), available: false }).issue?.key).toBe(
      'The selected image model is unavailable.'
    );
  });

  it('keeps restored masks blocked after a built-in binding is disabled', () => {
    expect(
      evaluate(undefined, {
        modelId: 'gpt_image_2',
        catalog: mergeImageModelCatalog(),
        maskImageUrl: '/r2/mask.png',
      }).issue
    ).not.toBeNull();
  });
});
