import { describe, expect, it } from 'vitest';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { quoteConfiguredImageRequest } from './configured-image-billing';

function mockResolutionRouting() {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model');
  const size = model.parameters.find((field) => field.key === 'size');
  if (!size) throw new Error('Missing mock size field');
  size.values = ['1280x720', '1920x1080'];
  size.defaultValue = '1280x720';
  model.priceCards = [
    {
      id: 'mock-720',
      operation: 'generate',
      match: { size: '1280x720' },
      unitPriceUsd: 0.1,
    },
    {
      id: 'mock-1080',
      operation: 'generate',
      match: { size: '1920x1080' },
      unitPriceUsd: 0.2,
    },
  ];
  return createImageModelRoutingSnapshot(configuration);
}

describe('configured image resolution pricing', () => {
  it.each([
    ['720p', '1280x720', 100_000],
    ['1080p', '1920x1080', 200_000],
  ] as const)(
    'quotes %s using its resolved %s specification',
    (resolution, size, costMicros) => {
      const quote = quoteConfiguredImageRequest({
        model: 'custom-image:qwen',
        imageModelRouting: mockResolutionRouting(),
        operation: 'generate',
        aspectRatio: '16:9',
        resolution,
        imageCount: 1,
      });
      expect(quote.parameters).toEqual({ size });
      expect(quote.costMicros).toBe(costMicros);
    }
  );

  it('uses the same size and charge when the resolved parameters are frozen onto the request', () => {
    const imageModelRouting = mockResolutionRouting();
    const input = {
      model: 'custom-image:qwen',
      imageModelRouting,
      operation: 'generate',
      aspectRatio: '16:9',
      resolution: '1080p',
      imageCount: 1,
    } as const;
    const quote = quoteConfiguredImageRequest(input);
    const frozen = quoteConfiguredImageRequest({
      ...input,
      parameters: quote.parameters,
    });
    expect(frozen.parameters).toEqual(quote.parameters);
    expect(frozen.costMicros).toBe(quote.costMicros);
  });

  it('rejects a missing tier before falling through to a different price', () => {
    expect(() =>
      quoteConfiguredImageRequest({
        model: 'custom-image:qwen',
        imageModelRouting: mockResolutionRouting(),
        operation: 'generate',
        aspectRatio: '16:9',
        resolution: '4k',
        imageCount: 1,
      })
    ).toThrow('resolution');
  });
});
