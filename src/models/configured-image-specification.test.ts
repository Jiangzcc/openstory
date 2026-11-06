import { describe, expect, it } from 'vitest';
import type { ImageChannelParameter } from './image-channel-parameters';
import {
  configuredImageOutputOptions,
  resolveConfiguredImageSize,
} from './configured-image-specification';
import { resolveConfiguredImageParameters } from './configured-image-request';

const mockSize: ImageChannelParameter = {
  key: 'size',
  label: 'Mock size',
  type: 'string',
  status: 'verified',
  operations: ['generate', 'edit'],
  required: true,
  defaultValue: '512x512',
  values: [
    '512x512',
    '720x720',
    '1280x720',
    '720x1280',
    '1080x1080',
    '1920x1080',
    '1080x1920',
  ],
};

describe('configured image product specifications', () => {
  it.each([
    ['16:9', '720p', '1280x720'],
    ['9:16', '720p', '720x1280'],
    ['1:1', '720p', '720x720'],
    ['16:9', '1080p', '1920x1080'],
    ['9:16', '1080p', '1080x1920'],
    ['1:1', '1080p', '1080x1080'],
  ] as const)(
    'maps %s and %s to the verified size %s',
    (aspectRatio, resolution, size) => {
      expect(
        resolveConfiguredImageParameters([mockSize], 'generate', {
          aspectRatio,
          resolution,
        })
      ).toEqual({ size });
    }
  );

  it('uses the same available tiers for generation and editing', () => {
    for (const operation of ['generate', 'edit'] as const) {
      const options = configuredImageOutputOptions(
        [mockSize],
        operation,
        '16:9'
      );
      expect(options.aspectRatios).toEqual(['16:9', '9:16', '1:1']);
      expect(options.resolutions).toEqual(['720p', '1080p']);
      expect(options.fixedSize).toBeUndefined();
    }
  });

  it('reports fixed sizes without claiming unsupported proportions', () => {
    const fixed = { ...mockSize, values: ['512x512'] };
    expect(configuredImageOutputOptions([fixed], 'edit', '1:1')).toMatchObject({
      aspectRatios: ['1:1'],
      resolutions: ['720p'],
      fixedSize: '512x512',
      automatic: false,
    });
    expect(() => resolveConfiguredImageSize(fixed, '16:9', '720p')).toThrow(
      'aspect ratio'
    );
  });

  it('preserves legacy resolution when no product tier was requested and explicit stored sizes', () => {
    expect(resolveConfiguredImageSize(mockSize, '1:1')).toBe('512x512');
    expect(
      resolveConfiguredImageParameters([mockSize], 'generate', {
        aspectRatio: '16:9',
        resolution: '1080p',
        parameters: { size: '720x720' },
      })
    ).toEqual({ size: '720x720' });
  });

  it('uses existing nearest-tier rules for a provider rounded dimension', () => {
    const rounded = {
      ...mockSize,
      defaultValue: '1280x720',
      values: ['1280x720', '1904x1071'],
    };
    expect(resolveConfiguredImageSize(rounded, '16:9', '1080p')).toBe(
      '1904x1071'
    );
  });

  it('derives dimensions for verified unconstrained string parameters and applies the Worker budget', () => {
    const flexible = { ...mockSize, values: undefined };
    expect(resolveConfiguredImageSize(flexible, '9:16', '1080p')).toBe(
      '1080x1920'
    );
    expect(
      configuredImageOutputOptions([flexible], 'generate', '16:9').resolutions
    ).toEqual(['720p', '1080p']);
    expect(() => resolveConfiguredImageSize(flexible, '16:9', '4k')).toThrow(
      'resolution'
    );
  });

  it('keeps unverified, other-operation, and oversized sizes unavailable', () => {
    const oversized = {
      ...mockSize,
      values: ['4096x4096'],
      defaultValue: '4096x4096',
    };
    expect(
      configuredImageOutputOptions([oversized], 'generate', '1:1').aspectRatios
    ).toEqual([]);
    expect(
      configuredImageOutputOptions(
        [{ ...mockSize, status: 'unverified' }],
        'generate',
        '16:9'
      ).resolutions
    ).toEqual([]);
    expect(
      configuredImageOutputOptions(
        [{ ...mockSize, operations: ['generate'] }],
        'edit',
        '16:9'
      ).resolutions
    ).toEqual([]);
  });

  it('does not invent fixed dimensions for automatic-only output', () => {
    const automatic = { ...mockSize, values: ['auto'], defaultValue: 'auto' };
    expect(
      configuredImageOutputOptions([automatic], 'generate', '16:9')
    ).toEqual({ aspectRatios: [], resolutions: [], automatic: true });
    expect(resolveConfiguredImageSize(automatic, '16:9', '1080p')).toBe('auto');
  });

  it('rejects an unavailable tier instead of substituting another tier', () => {
    expect(() => resolveConfiguredImageSize(mockSize, '16:9', '4k')).toThrow(
      'resolution'
    );
  });
});
