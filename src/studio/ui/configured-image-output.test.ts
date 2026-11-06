import { describe, expect, it } from 'vitest';
import { studioPartialImageOutput } from './configured-image-output';
import type { StudioImageOutputAsset } from './configured-image-output';

// Synthetic stored Studio outputs, with no provider request.
function asset(
  overrides: Partial<StudioImageOutputAsset> = {}
): StudioImageOutputAsset {
  return {
    activity: 'image',
    status: 'completed',
    input: { imageModel: 'custom-image:test', channelParameters: { n: 2 } },
    outputs: [{ url: '/r2/result.png', contentType: 'image/png' }],
    ...overrides,
  };
}

describe('Studio partial configured image output', () => {
  it('marks a completed asset with fewer images than requested as partially delivered', () => {
    expect(studioPartialImageOutput(asset())).toEqual({
      requested: 2,
      actual: 1,
    });
  });

  it('counts real image outputs and treats a missing output as zero', () => {
    expect(studioPartialImageOutput(asset({ outputs: null }))).toEqual({
      requested: 2,
      actual: 0,
    });
    expect(
      studioPartialImageOutput(
        asset({
          outputs: [
            { url: '/r2/one.webp', contentType: 'image/webp' },
            { url: '/r2/preview.mp4', contentType: 'video/mp4' },
          ],
        })
      )
    ).toEqual({ requested: 2, actual: 1 });
  });

  it('does not confuse separate Studio requests with the native requested count of this asset', () => {
    expect(
      studioPartialImageOutput(
        asset({
          input: {
            imageModel: 'custom-image:test',
            channelParameters: { n: 2 },
            count: 4,
          },
        })
      )
    ).toEqual({ requested: 2, actual: 1 });
  });

  it('has no partial warning once every requested image was stored', () => {
    expect(
      studioPartialImageOutput(
        asset({
          outputs: [
            { url: '/r2/one.png', contentType: 'image/png' },
            { url: '/r2/two.png', contentType: 'image/png' },
          ],
        })
      )
    ).toBeNull();
  });

  it('does not reclassify a queued, running or failed generation as partially complete', () => {
    for (const status of ['queued', 'running', 'failed'] as const)
      expect(studioPartialImageOutput(asset({ status }))).toBeNull();
  });

  it('leaves videos and historical rows without native count alone', () => {
    expect(studioPartialImageOutput(asset({ activity: 'video' }))).toBeNull();
    expect(
      studioPartialImageOutput(
        asset({
          input: { imageModel: 'gpt_image_2' },
        })
      )
    ).toBeNull();
    expect(
      studioPartialImageOutput(
        asset({ input: { imageModel: 'custom-image:test' } })
      )
    ).toBeNull();
  });

  it('ignores corrupt native-count metadata instead of inventing a request amount', () => {
    for (const n of ['2', false, 0, -1, 2.5, 17])
      expect(
        studioPartialImageOutput(
          asset({
            input: {
              imageModel: 'custom-image:test',
              channelParameters: { n },
            },
          })
        )
      ).toBeNull();
  });
});

it.each(['gpt_image_2', 'nano_banana_2'])(
  'reports partial bound built-in delivery for %s from saved channel parameters',
  (imageModel) => {
    expect(
      studioPartialImageOutput(
        asset({ input: { imageModel, channelParameters: { n: 3 } } })
      )
    ).toEqual({ requested: 3, actual: 1 });
  }
);
