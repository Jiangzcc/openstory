import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import { IMAGE_MODELS } from '@/models/models';
import type { ImageModelCatalogEntry } from '@/models/image-channels';
import type {
  ImageChannelParameter,
  ImageOperation,
} from '@/models/image-channel-parameters';
import { resolveConfiguredImageParameters } from '@/models/configured-image-request';
import { clampResolution } from '@/models/resolutions';
import { includesStage } from '@/sequences/pipeline';
import { describe, expect, it } from 'vitest';
import {
  availableResolutions,
  resolutionCeilingNote,
} from './resolution-support';

describe('availableResolutions', () => {
  it('offers only what a video model can render', () => {
    // Seedance 2.0 serves all three; Seedance 2.5 stops at 1080p.
    expect(availableResolutions({ videoModels: ['seedance_v2'] })).toEqual([
      '720p',
      '1080p',
      '4k',
    ]);
    expect(availableResolutions({ videoModels: ['seedance_v2_5'] })).toEqual([
      '720p',
      '1080p',
    ]);
    // H3 Max is the Turbo default; fal added 1080P (latent refinement from a
    // native 768P source) alongside 480P/768P.
    expect(availableResolutions({ videoModels: ['minimax_h3_max'] })).toEqual([
      '720p',
      '1080p',
    ]);
  });

  it('offers nothing for a model with a fixed output', () => {
    // Kling v3 Pro's schema has no resolution field at all.
    expect(availableResolutions({ videoModels: ['kling_v3_pro'] })).toEqual([]);
    // Nano Banana 2 Lite is fixed 1K.
    expect(
      availableResolutions({ imageModels: ['nano_banana_2_lite'] })
    ).toEqual([]);
  });

  it('does not offer 4K on an image model that cannot reach it', () => {
    // FLUX.2 stops at 2048 per edge — a 4K pill would promise a size it
    // never returns.
    expect(availableResolutions({ imageModels: ['flux_2_dev'] })).toEqual([
      '720p',
      '1080p',
    ]);
    expect(availableResolutions({ imageModels: ['gpt_image_2'] })).toEqual([
      '720p',
      '1080p',
      '4k',
    ]);
  });

  it('unions the selection — a capped video model keeps 4K stills available', () => {
    expect(
      availableResolutions({
        imageModels: ['gpt_image_2'],
        videoModels: ['seedance_v2_5'],
      })
    ).toEqual(['720p', '1080p', '4k']);
  });
});

describe('resolutionCeilingNote', () => {
  it('is silent when every model serves the tier', () => {
    expect(
      resolutionCeilingNote('1080p', { videoModels: ['seedance_v2'] })
    ).toBeNull();
  });

  it('names the model that will render below the tier', () => {
    expect(
      resolutionCeilingNote('4k', {
        imageModels: ['gpt_image_2'],
        videoModels: ['seedance_v2_5'],
      })
    ).toBe('Seedance 2.5 renders below 4K');
  });

  it('keeps fixed-size models apart from lower — 1K is not "below 720p"', () => {
    expect(
      resolutionCeilingNote('720p', {
        imageModels: ['nano_banana_2_lite'],
        videoModels: ['seedance_v2'],
      })
    ).toBe('Nano Banana 2 Lite renders at a fixed size');
    expect(
      resolutionCeilingNote('4k', {
        imageModels: ['gpt_image_2', 'nano_banana_2_lite'],
        videoModels: ['seedance_v2_5'],
      })
    ).toBe(
      'Seedance 2.5 renders below 4K · Nano Banana 2 Lite renders at a fixed size'
    );
  });

  it('calls a one-tier model fixed, even when the ask matches that tier', () => {
    // Seedance 2.0 Mini advertises 480p and 720p, which both land in the 720p
    // band — so the tier never moves it. Staying silent because 720p "matches"
    // left the picker showing a lone 720p pill that did nothing.
    expect(
      resolutionCeilingNote('720p', { videoModels: ['seedance_v2_mini'] })
    ).toBe('Seedance 2.0 Mini renders at a fixed size');
    // The screenshot case: a fixed image model plus a one-tier video model
    // leaves nothing to choose, so the caption has to carry the whole row.
    expect(
      resolutionCeilingNote('720p', {
        imageModels: ['nano_banana_2_lite'],
        videoModels: ['seedance_v2_mini'],
      })
    ).toBe('Nano Banana 2 Lite and Seedance 2.0 Mini render at a fixed size');
  });

  // No catalog model currently has a floor above 720p, so the "renders above"
  // branch has no live case to pin (LTX 2.3 Pro, 1080p floor, was retired in #1511).

  it('reads the aspect ratio — a tier can be out of reach at one shape only', () => {
    // Seedream's documented pixel range puts 720p out of reach when square,
    // and 4K within it. Dropping the ratio offers a pill it cannot render.
    expect(
      availableResolutions({ imageModels: ['seedream_v5'], aspectRatio: '1:1' })
    ).toEqual(['1080p', '4k']);
    expect(
      availableResolutions({
        imageModels: ['seedream_v5'],
        aspectRatio: '16:9',
      })
    ).toEqual(['720p', '1080p']);
  });

  it('collapses a long selection rather than wrapping the caption', () => {
    // GPT Image 2 keeps 4K on offer; the other three can't reach it.
    const note = resolutionCeilingNote('4k', {
      imageModels: [
        'gpt_image_2',
        'flux_2_dev',
        'flux_2_flash',
        'flux_2_turbo',
      ],
    });
    expect(note).toMatch(/and 1 more render below 4K/);
  });
});

// Synthetic channel capabilities; no provider calls or database access.
function mockSize(
  operations: ImageOperation[],
  values?: string[],
  defaultValue = values?.[0] ?? '1280x720'
): ImageChannelParameter {
  return {
    key: 'size',
    label: 'Mock size',
    type: 'string',
    status: 'verified',
    operations,
    required: true,
    defaultValue,
    ...(values ? { values } : {}),
  };
}

function configuredSelection(overrides: Partial<ImageModelCatalogEntry> = {}) {
  const model = imageCatalogFixture({
    parameters: [
      mockSize(['generate'], ['1280x720', '1920x1080', '1080x1920']),
      mockSize(['edit'], ['1280x720', '720x1280']),
    ],
    ...overrides,
  });
  return {
    imageModels: [model.id],
    imageCatalog: mergeImageModelCatalog([model]),
    aspectRatio: '16:9' as const,
  };
}

it.each(['images', 'dialogue'] as const)(
  'preserves configured 1080p for a still-only %s run without draft motion',
  (stopAt) => {
    const selection = configuredSelection();
    const tiers = availableResolutions({
      ...selection,
      videoModels: includesStage(stopAt, 'motion') ? ['seedance_v2_5'] : [],
    });
    const resolution = clampResolution('1080p', tiers);
    expect(resolution).toBe('1080p');
    const model = selection.imageCatalog.find(
      (entry) => entry.id === selection.imageModels[0]
    );
    if (model?.source !== 'configured') throw new Error('Missing mock model');
    expect(
      resolveConfiguredImageParameters(
        model.configuration.parameters,
        'generate',
        {
          aspectRatio: selection.aspectRatio,
          resolution,
        }
      )
    ).toEqual({ size: '1920x1080' });
  }
);

it('derives configured tiers from verified dimensions for the selected ratio', () => {
  const selection = configuredSelection();
  expect(availableResolutions(selection)).toEqual(['720p', '1080p']);
  expect(availableResolutions({ ...selection, aspectRatio: '9:16' })).toEqual([
    '720p',
    '1080p',
  ]);
  expect(availableResolutions({ ...selection, aspectRatio: '1:1' })).toEqual(
    []
  );
  expect(resolutionCeilingNote('1080p', selection)).toBeNull();
  expect(resolutionCeilingNote('4k', selection)).toBe(
    'Configured Qwen renders below 4K'
  );
});

it.each([
  ['generate', 0, ['720p', '1080p']],
  ['edit', 1, ['720p']],
  ['edit', 8, ['720p']],
  ['edit', 0, []],
  ['edit', 9, []],
  ['generate', 1, []],
] as const)(
  'uses %s dimensions only when the actual reference count is %i',
  (imageOperation, imageReferenceCount, tiers) => {
    const selection = {
      ...configuredSelection(),
      imageOperation,
      imageReferenceCount,
    };
    expect(availableResolutions(selection)).toEqual(tiers);
  }
);

it.each([
  [0, ['720p', '1080p']],
  [1, ['720p']],
  [9, []],
] as const)(
  'resolves the image operation from %i actual reference images',
  (imageReferenceCount, tiers) => {
    expect(
      availableResolutions({ ...configuredSelection(), imageReferenceCount })
    ).toEqual(tiers);
  }
);

it('keeps verified edit-only tiers available before shot references are known', () => {
  const original = imageCatalogFixture();
  const selection = configuredSelection({
    operations: { edit: original.operations.edit },
    parameters: [mockSize(['edit'], ['1920x1080'])],
  });
  expect(availableResolutions(selection)).toEqual(['1080p']);
  expect(
    availableResolutions({ ...selection, imageReferenceCount: 0 })
  ).toEqual([]);
  expect(
    availableResolutions({ ...selection, imageReferenceCount: 1 })
  ).toEqual(['1080p']);
  expect(resolutionCeilingNote('1080p', selection)).toBe(
    'Configured Qwen renders at a fixed size'
  );
});

it('keeps operation-specific fixed output separate from a variable-size operation', () => {
  const selection = configuredSelection();
  expect(
    resolutionCeilingNote('1080p', {
      ...selection,
      imageOperation: 'edit',
      imageReferenceCount: 1,
    })
  ).toBe('Configured Qwen renders at a fixed size');
  expect(
    resolutionCeilingNote('1080p', {
      ...selection,
      imageOperation: 'generate',
      imageReferenceCount: 0,
    })
  ).toBeNull();
});

it('unions configured image and built-in video tiers without replacing either', () => {
  const selection = configuredSelection();
  expect(
    availableResolutions({
      ...selection,
      videoModels: ['seedance_v2'],
    })
  ).toEqual(['720p', '1080p', '4k']);
  expect(
    resolutionCeilingNote('4k', {
      ...selection,
      videoModels: ['seedance_v2'],
    })
  ).toBe('Configured Qwen renders below 4K');
});

it('uses the current bound built-in catalog instead of its original fal tiers', () => {
  const selection = configuredSelection({
    id: 'gpt_image_2',
    parameters: [mockSize(['generate', 'edit'], ['1920x1080'])],
  });
  expect(availableResolutions(selection)).toEqual(['1080p']);
  expect(resolutionCeilingNote('1080p', selection)).toBe(
    IMAGE_MODELS.gpt_image_2.name + ' renders at a fixed size'
  );
  expect(
    availableResolutions({
      ...selection,
      imageCatalog: mergeImageModelCatalog(),
    })
  ).toEqual(['720p', '1080p', '4k']);
});

it('keeps unavailable historical configurations out of the tier choices', () => {
  for (const id of ['custom-image:qwen', 'gpt_image_2'] as const) {
    const selection = configuredSelection({ id, available: false });
    expect(availableResolutions(selection)).toEqual([]);
    expect(resolutionCeilingNote('1080p', selection)).toContain(
      'uses image channel size settings.'
    );
  }
  const missing = { imageModels: ['custom-image:historical'] } as const;
  expect(availableResolutions(missing)).toEqual([]);
  expect(resolutionCeilingNote('1080p', missing)).toBe(
    'custom-image:historical uses image channel size settings.'
  );
});

it.each(['unverified', 'unsupported'] as const)(
  'does not offer dimensions from a %s operation',
  (status) => {
    const original = imageCatalogFixture();
    const generate = original.operations.generate;
    if (!generate) throw new Error('Missing mock operation');
    const selection = configuredSelection({
      operations: { generate: { ...generate, status } },
    });
    expect(availableResolutions(selection)).toEqual([]);
  }
);

it('does not offer operation sizes without a corresponding price card', () => {
  const selection = configuredSelection({ priceCards: [] });
  expect(availableResolutions(selection)).toEqual([]);
});

it.each(['unverified', 'unsupported'] as const)(
  'does not offer dimensions from a %s size field',
  (status) => {
    const selection = configuredSelection({
      parameters: [{ ...mockSize(['generate'], ['1920x1080']), status }],
    });
    expect(availableResolutions(selection)).toEqual([]);
    expect(resolutionCeilingNote('1080p', selection)).toContain(
      'uses image channel size settings.'
    );
  }
);

it('derives flexible-size tiers within the shared image resource budget', () => {
  const selection = configuredSelection({
    parameters: [mockSize(['generate', 'edit'])],
  });
  expect(availableResolutions(selection)).toEqual(['720p', '1080p']);
  expect(resolutionCeilingNote('1080p', selection)).toBeNull();
});

it.each([['auto'], ['4096x4096']] as const)(
  'does not invent tiers for automatic or oversized output %s',
  (size) => {
    const selection = configuredSelection({
      parameters: [mockSize(['generate', 'edit'], [size])],
    });
    expect(availableResolutions(selection)).toEqual([]);
    expect(resolutionCeilingNote('1080p', selection)).toContain(
      'uses image channel size settings.'
    );
  }
);
