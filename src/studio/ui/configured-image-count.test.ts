import { describe, expect, it } from 'vitest';
import type { ImageChannelParameter } from '@/models/image-channel-parameters';
import {
  configuredImageCount,
  configuredImageCounts,
} from './configured-image-count';

function nativeCount(
  overrides: Partial<ImageChannelParameter> = {}
): ImageChannelParameter {
  return {
    key: 'n',
    label: 'Count',
    type: 'integer',
    status: 'verified',
    operations: ['generate'],
    required: true,
    minimum: 1,
    maximum: 16,
    defaultValue: 4,
    ...overrides,
  };
}

// Synthetic operation capabilities, never supplier traffic.
describe('Configured Studio image batch planning', () => {
  it.each([1, 2, 4])(
    'keeps %i total images as one image per request when possible',
    (total) => {
      expect(configuredImageCount([nativeCount()], 'generate', total)).toEqual({
        imageCount: 1,
        requestCount: total,
        parameters: { n: 1 },
      });
    }
  );

  it('uses the smallest legal native divisor when a single image is unavailable', () => {
    const definition = nativeCount({ values: [2, 4], minimum: 2 });
    expect(configuredImageCounts([definition], 'generate')).toEqual([2, 4]);
    expect(configuredImageCount([definition], 'generate', 4)).toEqual({
      imageCount: 2,
      requestCount: 2,
      parameters: { n: 2 },
    });
    expect(configuredImageCount([definition], 'generate', 1)).toBeNull();
  });

  it('supports range-only native capabilities and respects their bounds', () => {
    const definition = nativeCount({ minimum: 2, maximum: 2, defaultValue: 2 });
    expect(
      configuredImageCount([definition], 'generate', 4)?.requestCount
    ).toBe(2);
    expect(configuredImageCount([definition], 'generate', 1)).toBeNull();
  });

  it('never rounds up or adds extra images for a non-dividing native count', () => {
    const definition = nativeCount({
      values: [3],
      defaultValue: 3,
      minimum: 3,
      maximum: 3,
    });
    expect(configuredImageCounts([definition], 'generate')).toEqual([]);
    expect(configuredImageCount([definition], 'generate', 4)).toBeNull();
  });

  it.each(['unverified', 'unsupported'] as const)(
    'ignores %s native capabilities',
    (status) => {
      expect(
        configuredImageCount([nativeCount({ status })], 'generate', 4)
      ).toEqual({
        imageCount: 1,
        requestCount: 4,
        parameters: {},
      });
    }
  );

  it('does not send native n when it is absent from the current operation', () => {
    expect(configuredImageCount([nativeCount()], 'edit', 4)).toEqual({
      imageCount: 1,
      requestCount: 4,
      parameters: {},
    });
    expect(configuredImageCount([], 'generate', 2)?.requestCount).toBe(2);
  });

  it.each([0, 3, 8, 1.5, NaN])(
    'rejects totals outside the 1/2/4 picker: %s',
    (total) => {
      expect(
        configuredImageCount([nativeCount()], 'generate', total)
      ).toBeNull();
    }
  );
});
