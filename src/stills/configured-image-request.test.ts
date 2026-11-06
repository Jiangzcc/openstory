import { describe, expect, it, vi } from 'vitest';
import {
  dispatchImageRequest,
  imageRequestDimensions,
  imageResolutionTiers,
  buildImageRequest,
} from './build-image-request';
import type { ImageGenerationParams } from './build-image-request';

describe('configured image request dispatch', () => {
  it('routes configured models independently and preserves channel parameters and mask inputs', () => {
    const params: ImageGenerationParams = {
      model: 'custom-image:qwen',
      prompt: 'Mock prompt',
      channelParameters: {
        size: '1536x1024',
        quality: 'high',
        n: 4,
        output_compression: 80,
        enabled_flag: true,
      },
      maskImageUrl: '/r2/mock-mask.png',
      referenceImageUrls: ['/r2/mock.png'],
    };
    const builtin = vi.fn(() => 'builtin');
    const configured = vi.fn(() => 'configured');
    expect(dispatchImageRequest(params, { builtin, configured })).toBe(
      'configured'
    );
    expect(configured).toHaveBeenCalledWith(params);
    expect(builtin).not.toHaveBeenCalled();
    expect(imageResolutionTiers(params.model)).toEqual([]);
    expect(imageRequestDimensions(params.model, '16:9', '4k')).toBeNull();
  });

  it('keeps the original built-in request assembly', () => {
    const params = { model: 'flux_2_dev', prompt: 'Mock prompt' } as const;
    const configured = vi.fn(() => 'configured');
    expect(
      dispatchImageRequest(params, {
        builtin: (input) => buildImageRequest(input).via,
        configured,
      })
    ).toBe('fal');
    expect(configured).not.toHaveBeenCalled();
  });
});
