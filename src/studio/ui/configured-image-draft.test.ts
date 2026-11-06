import { describe, expect, it } from 'vitest';
import {
  isStudioImageCount,
  restoredStudioImageCount,
} from './configured-image-draft';

// Synthetic saved inputs; no providers, browser storage or uploads.
describe('Studio image draft quantity restoration', () => {
  it.each([1, 2, 4])('restores a legacy request count of %i', (count) => {
    expect(restoredStudioImageCount({ count })).toBe(count);
  });

  it('multiplies the saved request count and native count exactly once', () => {
    expect(
      restoredStudioImageCount({ count: 2, channelParameters: { n: 2 } })
    ).toBe(4);
    expect(
      restoredStudioImageCount({ count: 4, channelParameters: { n: 1 } })
    ).toBe(4);
    expect(restoredStudioImageCount({ channelParameters: { n: 2 } })).toBe(2);
  });

  it('preserves historical totals outside the picker so validation can report them', () => {
    expect(
      restoredStudioImageCount({ count: 4, channelParameters: { n: 4 } })
    ).toBe(16);
    expect(
      restoredStudioImageCount({ count: 3, channelParameters: { n: 1 } })
    ).toBe(3);
    expect(isStudioImageCount(16)).toBe(false);
    expect(isStudioImageCount(3)).toBe(false);
  });

  it('ignores stale size and hidden defaults when recovering the quantity', () => {
    const parameters = {
      n: 2,
      size: 'old-size',
      quality: 'old-quality',
      seed: 99,
    };
    expect(
      restoredStudioImageCount({ count: 2, channelParameters: parameters })
    ).toBe(4);
    expect(parameters).toEqual({
      n: 2,
      size: 'old-size',
      quality: 'old-quality',
      seed: 99,
    });
    expect(
      restoredStudioImageCount({
        channelParameters: { quality: { stale: true } },
      })
    ).toBe(1);
  });

  it.each([0, -1, 1.5, 5, NaN, Infinity, '2'])(
    'keeps invalid request count %s invalid',
    (count) => {
      expect(isStudioImageCount(restoredStudioImageCount({ count }))).toBe(
        false
      );
    }
  );

  it.each([0, -1, 1.5, 17, NaN, Infinity, '2', null])(
    'keeps invalid native count %s invalid',
    (n) => {
      expect(
        isStudioImageCount(
          restoredStudioImageCount({ count: 2, channelParameters: { n } })
        )
      ).toBe(false);
    }
  );

  it.each([null, [], 'invalid'])(
    'rejects malformed historical parameters %j',
    (channelParameters) => {
      expect(
        isStudioImageCount(restoredStudioImageCount({ channelParameters }))
      ).toBe(false);
    }
  );

  it('defaults records without count metadata to one image', () => {
    expect(restoredStudioImageCount({})).toBe(1);
    expect(restoredStudioImageCount({ channelParameters: {} })).toBe(1);
  });
});
