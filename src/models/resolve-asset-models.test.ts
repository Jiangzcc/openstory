import { describe, expect, it } from 'vitest';
import {
  resolveImageModel,
  resolveUpscaleModel,
  requireUpscaleModel,
  resolveVideoModel,
  UPSCALE_FALLBACK_MODEL,
} from './resolve-asset-models';
import { createImageModelRoutingSnapshot } from './image-channels';
import { imageConfigurationFixture } from './__tests__/image-model-fixture';

describe('resolveImageModel', () => {
  it('prefers the explicit per-request model', () => {
    expect(
      resolveImageModel({
        explicit: 'gpt_image_2',
        lastFailedAttemptModel: 'phota',
        selectedVersionModel: 'nano_banana_pro',
        sequenceModel: 'flux_2_max',
      })
    ).toBe('gpt_image_2');
  });

  it('prefers the last failed attempt over the selected version', () => {
    // The shot succeeded on nano_banana_pro, the user then tried phota and it
    // failed. A retry must re-run phota, not silently fall back to the older
    // successful model.
    expect(
      resolveImageModel({
        lastFailedAttemptModel: 'phota',
        selectedVersionModel: 'nano_banana_pro',
        sequenceModel: 'flux_2_max',
      })
    ).toBe('phota');
  });

  it('uses the selected version when there is no failed attempt', () => {
    expect(
      resolveImageModel({
        selectedVersionModel: 'nano_banana_pro',
        sequenceModel: 'flux_2_max',
      })
    ).toBe('nano_banana_pro');
  });

  it('falls back to the sequence default with no selected version', () => {
    expect(
      resolveImageModel({
        selectedVersionModel: null,
        sequenceModel: 'flux_2_max',
      })
    ).toBe('flux_2_max');
  });

  it('falls back to the app default when the sequence has not loaded', () => {
    expect(resolveImageModel({ sequenceModel: undefined })).toBe('gpt_image_2');
  });

  it('falls through to the NEXT tier when a tier is set but retired', () => {
    // A model id retired after the version was written must not skip the
    // user's sequence choice for the global app default.
    expect(
      resolveImageModel({
        selectedVersionModel: 'retired_model',
        sequenceModel: 'flux_2_max',
      })
    ).toBe('flux_2_max');
  });

  it('falls through a retired failed attempt to the selected version', () => {
    expect(
      resolveImageModel({
        lastFailedAttemptModel: 'retired_model',
        selectedVersionModel: 'nano_banana_pro',
        sequenceModel: 'flux_2_max',
      })
    ).toBe('nano_banana_pro');
  });

  it('falls back to the app default when every tier is invalid/empty', () => {
    expect(
      resolveImageModel({
        selectedVersionModel: 'also_not_a_model',
        sequenceModel: '',
      })
    ).toBe('gpt_image_2');
  });
});

describe('resolveVideoModel', () => {
  it('prefers the explicit per-request model', () => {
    expect(
      resolveVideoModel({
        explicit: 'seedance_v2',
        selectedVersionModel: 'kling_v3_pro',
        sequenceModel: 'kling_v3_pro',
      })
    ).toBe('seedance_v2');
  });

  it('prefers the last failed attempt over the selected version', () => {
    expect(
      resolveVideoModel({
        lastFailedAttemptModel: 'minimax_h3_max',
        selectedVersionModel: 'kling_v3_pro',
        sequenceModel: 'seedance_v2',
      })
    ).toBe('minimax_h3_max');
  });

  it('uses the selected version when there is no failed attempt', () => {
    expect(
      resolveVideoModel({
        selectedVersionModel: 'kling_v3_pro',
        sequenceModel: 'seedance_v2',
      })
    ).toBe('kling_v3_pro');
  });

  it('falls back to the sequence default with no selected version', () => {
    expect(
      resolveVideoModel({
        selectedVersionModel: null,
        sequenceModel: 'kling_v3_pro',
      })
    ).toBe('kling_v3_pro');
  });

  it('falls back to the app default when the sequence has not loaded', () => {
    expect(resolveVideoModel({ sequenceModel: undefined })).toBe('seedance_v2');
  });

  it('falls through to the NEXT tier when a tier is set but retired', () => {
    expect(
      resolveVideoModel({
        selectedVersionModel: 'retired_model',
        sequenceModel: 'kling_v3_pro',
      })
    ).toBe('kling_v3_pro');
  });

  it('falls back to the app default when every tier is invalid/empty', () => {
    expect(
      resolveVideoModel({
        selectedVersionModel: 'bogus',
        sequenceModel: '',
      })
    ).toBe('seedance_v2');
  });
});

describe('resolveUpscaleModel', () => {
  it('upscales on the model that generated the grid', () => {
    // The upscale is an edit of that model's own tile — rendering it on a
    // different model restyles the shot AND (since the resulting version
    // becomes the frame's selection) rewrites the shot's resolved model.
    expect(resolveUpscaleModel('gpt_image_2')).toBe('gpt_image_2');
    expect(resolveUpscaleModel('flux_2_max')).toBe('flux_2_max');
  });

  it('falls back for a model with no edit endpoint', () => {
    // hidream_i1 has no EDIT_ENDPOINTS entry, so an upscale request would be
    // routed to its text-to-image endpoint, ignore the tile, and return a
    // fresh render instead of an upscale.
    expect(resolveUpscaleModel('hidream_i1')).toBe(UPSCALE_FALLBACK_MODEL);
  });

  it('falls back for a missing or retired source model', () => {
    expect(resolveUpscaleModel(null)).toBe(UPSCALE_FALLBACK_MODEL);
    expect(resolveUpscaleModel(undefined)).toBe(UPSCALE_FALLBACK_MODEL);
    expect(resolveUpscaleModel('retired_model')).toBe(UPSCALE_FALLBACK_MODEL);
  });
});

describe('configured upscale model routing', () => {
  const model = 'custom-image:qwen';
  it('keeps the configured identity for tile hashes without inventing a built-in endpoint', () => {
    expect(resolveUpscaleModel(model)).toBe(model);
  });
  it('requires the frozen verified edit binding before execution', () => {
    const routing = createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    );
    expect(requireUpscaleModel(model, routing)).toBe(model);
  });
  it('fails explicitly when the configured model is missing or disabled', () => {
    expect(() => requireUpscaleModel(model)).toThrow(
      'Configured image model is unavailable.'
    );
    const configuration = imageConfigurationFixture();
    for (const entry of configuration.models) entry.enabled = false;
    expect(() =>
      requireUpscaleModel(model, createImageModelRoutingSnapshot(configuration))
    ).toThrow('Configured image model is unavailable.');
  });
  it.each(['unverified', 'unsupported'] as const)(
    'refuses a %s edit binding',
    (status) => {
      const configuration = imageConfigurationFixture();
      for (const entry of configuration.models) {
        if (entry.operations.edit) entry.operations.edit.status = status;
      }
      const routing = createImageModelRoutingSnapshot(configuration);
      expect(() => requireUpscaleModel(model, routing)).toThrow(
        'verified image editing'
      );
    }
  );
});

it('uses a captured edit binding even when the built-in has no native edit endpoint', () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model.');
  model.id = 'hidream_i1';
  const routing = createImageModelRoutingSnapshot(configuration);
  expect(resolveUpscaleModel(model.id, routing)).toBe(model.id);
  expect(requireUpscaleModel(model.id, routing)).toBe(model.id);
  expect(requireUpscaleModel(model.id, [])).toBe(UPSCALE_FALLBACK_MODEL);
});

it.each(['unverified', 'unsupported'] as const)(
  'rejects a %s captured edit binding despite native editing support',
  (status) => {
    const configuration = imageConfigurationFixture();
    const model = configuration.models[0];
    if (!model?.operations.edit) throw new Error('Missing mock edit binding.');
    model.id = 'gpt_image_2';
    model.operations.edit.status = status;
    const routing = createImageModelRoutingSnapshot(configuration);
    expect(resolveUpscaleModel(model.id, routing)).toBe(model.id);
    expect(() => requireUpscaleModel(model.id, routing)).toThrow(
      'verified image editing'
    );
  }
);

it('rejects missing captured editing instead of using the built-in edit capability', () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model.');
  model.id = 'gpt_image_2';
  delete model.operations.edit;
  const routing = createImageModelRoutingSnapshot(configuration);
  expect(() => requireUpscaleModel(model.id, routing)).toThrow(
    'verified image editing'
  );
});

it('checks the old task snapshot after live binding capabilities have changed', () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model?.operations.edit) throw new Error('Missing mock edit binding.');
  model.id = 'gpt_image_2';
  const frozen = createImageModelRoutingSnapshot(configuration);
  model.operations.edit.status = 'unsupported';
  expect(requireUpscaleModel(model.id, frozen)).toBe(model.id);
  expect(() =>
    requireUpscaleModel(
      model.id,
      createImageModelRoutingSnapshot(configuration)
    )
  ).toThrow('verified image editing');
});

it('validates a channel-bound fallback with its frozen capability too', () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model?.operations.edit) throw new Error('Missing mock edit binding.');
  model.id = UPSCALE_FALLBACK_MODEL;
  model.operations.edit.status = 'unsupported';
  const routing = createImageModelRoutingSnapshot(configuration);
  expect(() => requireUpscaleModel('hidream_i1', routing)).toThrow(
    'verified image editing'
  );
});
