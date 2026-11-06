import { describe, expect, it } from 'vitest';
import { microsToUsd } from '@/billing/money';
import { quoteConfiguredImageRequest } from '@/billing/configured-image-billing';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { studioCreateInputSchema } from '@/studio/schema';
import type { StudioCreateInput } from '@/studio/schema';
import { requireStudioImageCapabilities } from './studio-image-capabilities';

type ImageInput = Extract<StudioCreateInput, { activity: 'image' }>;
const REFERENCE_URL = 'https://example.com/mock-reference.png';

function imageInput(overrides: Partial<ImageInput> = {}): StudioCreateInput {
  return studioCreateInputSchema.parse({
    activity: 'image',
    imageModel: 'hidream_i1',
    prompt: 'Synthetic image capability test',
    aspectRatio: '1:1',
    ...overrides,
  });
}

// Synthetic binding and prices; no provider call is made.
function builtinRouting() {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model?.operations.edit) throw new Error('Missing mock edit binding.');
  model.id = 'hidream_i1';
  model.operations.edit.maxReferenceImages = 16;
  return createImageModelRoutingSnapshot(configuration);
}

describe('Studio image capabilities follow the effective channel', () => {
  it('keeps unsupported builtin references rejected at the server boundary', () => {
    const input = imageInput({ referenceImages: [REFERENCE_URL] });
    expect(() => requireStudioImageCapabilities(input)).toThrow(
      'does not take reference images'
    );
  });

  it('preserves the original builtin reference limit without a binding', () => {
    const input = imageInput({
      imageModel: 'gpt_image_2',
      referenceImages: Array.from({ length: 10 }, () => REFERENCE_URL),
    });
    expect(() => requireStudioImageCapabilities(input)).toThrow(
      'Too many reference images'
    );
  });

  it('rejects channel parameters and masks for an unbound builtin', () => {
    const input = imageInput({ channelParameters: { size: '1024x1024' } });
    expect(() => requireStudioImageCapabilities(input)).toThrow(
      'Channel parameters require a configured image model'
    );
    const mask = imageInput({
      imageModel: 'gpt_image_2',
      referenceImages: [REFERENCE_URL],
      maskImageUrl: REFERENCE_URL,
    });
    expect(() => requireStudioImageCapabilities(mask)).toThrow(
      'Channel parameters require a configured image model'
    );
  });

  it('uses bound builtin edit capabilities and USD pricing under the same id', () => {
    const input = imageInput({
      referenceImages: Array.from({ length: 10 }, () => REFERENCE_URL),
      maskImageUrl: REFERENCE_URL,
      channelParameters: { size: '1024x1024' },
    });
    if (input.activity !== 'image') throw new Error('Expected image input.');
    const routing = builtinRouting();
    expect(() => requireStudioImageCapabilities(input, routing)).not.toThrow();
    const quote = quoteConfiguredImageRequest({
      model: input.imageModel,
      imageModelRouting: routing,
      operation: 'edit',
      referenceImageCount: input.referenceImages.length,
      hasMask: true,
      parameters: input.channelParameters,
    });
    expect(quote.imageSource).toBe('platform');
    expect(microsToUsd(quote.costMicros)).toBe(0.2);
  });

  it('rejects a bound operation with no verified edit capability', () => {
    const routing = builtinRouting().map((route) => ({
      ...route,
      operations: { generate: route.operations.generate },
    }));
    expect(() =>
      quoteConfiguredImageRequest({
        model: 'hidream_i1',
        imageModelRouting: routing,
        operation: 'edit',
        referenceImageCount: 1,
      })
    ).toThrow();
  });

  it('keeps mask-without-reference invalid in the transport schema', () => {
    expect(() => imageInput({ maskImageUrl: REFERENCE_URL })).toThrow(
      'A mask requires a reference image'
    );
  });
});
