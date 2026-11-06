import { describe, expect, it } from 'vitest';
import {
  imageCatalogFixture,
  imageConfigurationFixture,
} from './__tests__/image-model-fixture';
import { imageModelCatalogFromConfiguration } from './image-channels';
import {
  IMAGE_MODELS,
  isBuiltinTextToImageModel,
  isValidTextToImageModel,
  safeTextToImageModel,
} from './models';
import {
  mergeImageModelCatalog,
  getImageModelDefinition,
  imageModelDisplayName,
  imageModelSupportsOperation,
  isSelectableImageModelId,
  imageModelSelectionError,
} from './image-model-catalog';

describe('configured image model catalog', () => {
  it('preserves built-in identities while recognizing configured identity without pretending it is built in', () => {
    expect(mergeImageModelCatalog().map((model) => model.id)).toEqual(
      Object.keys(IMAGE_MODELS)
    );
    expect(isBuiltinTextToImageModel('gpt_image_2')).toBe(true);
    expect(isBuiltinTextToImageModel('custom-image:gpt-image-2')).toBe(false);
    expect(isValidTextToImageModel('custom-image:gpt-image-2')).toBe(true);
    expect(isValidTextToImageModel('custom-image:')).toBe(false);
    expect(isValidTextToImageModel('__proto__')).toBe(false);
    expect(safeTextToImageModel('custom-image:retired')).toBe(
      'custom-image:retired'
    );
  });

  it('uses configured names without conflating the fal GPT identity and keeps arbitrary verified size options', () => {
    const entry = imageCatalogFixture({
      id: 'custom-image:gpt-image-2',
      name: 'Gateway GPT Image 2',
    });
    const catalog = mergeImageModelCatalog([entry]);
    expect(imageModelDisplayName(entry.id, catalog)).toBe(entry.name);
    expect(imageModelDisplayName('gpt_image_2', catalog)).toBe(
      IMAGE_MODELS.gpt_image_2.name
    );
    const model = getImageModelDefinition(entry.id, catalog);
    expect(
      model?.source === 'configured' &&
        model.configuration.parameters[0]?.values
    ).toHaveLength(5);
    expect(imageModelDisplayName('custom-image:removed', catalog)).toBe(
      'custom-image:removed'
    );
  });

  it('retains historical names but refuses unavailable, unpriced and unknown configured models', () => {
    const entry = imageCatalogFixture({ available: false });
    const catalog = mergeImageModelCatalog([entry]);
    expect(imageModelDisplayName(entry.id, catalog)).toBe(entry.name);
    expect(isSelectableImageModelId(entry.id, catalog)).toBe(false);
    expect(imageModelSelectionError([entry.id], catalog)).toBeInstanceOf(Error);
    expect(isSelectableImageModelId('custom-image:unknown', catalog)).toBe(
      false
    );
    expect(
      isSelectableImageModelId(
        entry.id,
        mergeImageModelCatalog([imageCatalogFixture({ priceCards: [] })])
      )
    ).toBe(false);
  });

  it('filters generation, editing and reference counts by verified per-model capabilities', () => {
    const entry = imageCatalogFixture({
      operations: {
        edit: {
          status: 'verified',
          minReferenceImages: 1,
          maxReferenceImages: 8,
          mask: 'unsupported',
        },
      },
    });
    const catalog = mergeImageModelCatalog([entry]);
    const model = getImageModelDefinition(entry.id, catalog);
    if (!model) throw new Error('Missing mock model.');
    expect(imageModelSupportsOperation(model, 'generate')).toBe(false);
    expect(isSelectableImageModelId(entry.id, catalog, 'generate')).toBe(false);
    expect(isSelectableImageModelId(entry.id, catalog, 'edit', 5)).toBe(true);
    expect(isSelectableImageModelId(entry.id, catalog, 'edit', 0)).toBe(false);
    expect(isSelectableImageModelId(entry.id, catalog, 'edit', 9)).toBe(false);
  });
});

it('replaces the original ID once and preserves built-in metadata', () => {
  const entry = imageCatalogFixture({
    id: 'gpt_image_2',
    name: 'Mock gateway GPT',
  });
  const original = getImageModelDefinition(entry.id);
  const catalog = mergeImageModelCatalog([entry]);
  expect(catalog).toHaveLength(Object.keys(IMAGE_MODELS).length);
  expect(catalog.filter((model) => model.id === entry.id)).toHaveLength(1);
  expect(getImageModelDefinition(entry.id, catalog)).toMatchObject({
    ...original,
    source: 'configured',
    configuration: entry,
  });
});

it.each(['model', 'channel'] as const)(
  'restores the original built-in entry when the %s is disabled',
  (disabled) => {
    const config = imageConfigurationFixture();
    const model = config.models[0];
    const channel = config.channels[0];
    if (!model || !channel) throw new Error('Missing mock configuration.');
    model.id = 'gpt_image_2';
    model.name = 'Disabled mock override';
    if (disabled === 'model') model.enabled = false;
    else channel.enabled = false;
    const entries = imageModelCatalogFromConfiguration(config);
    expect(entries).toEqual([]);
    const catalog = mergeImageModelCatalog(entries);
    expect(getImageModelDefinition(model.id, catalog)).toEqual(
      getImageModelDefinition(model.id)
    );
  }
);

it('does not inherit native edit capability or native prices through an active binding', () => {
  const entry = imageCatalogFixture({ id: 'gpt_image_2', priceCards: [] });
  const model = getImageModelDefinition(
    entry.id,
    mergeImageModelCatalog([entry])
  );
  if (!model) throw new Error('Missing mock model.');
  expect(model.source).toBe('configured');
  expect(isSelectableImageModelId(entry.id, [model], 'edit', 1)).toBe(false);
  entry.operations = {};
  expect(imageModelSupportsOperation(model, 'generate')).toBe(false);
  expect(imageModelSupportsOperation(model, 'edit', 1)).toBe(false);
});

it('keeps enabled unverified built-in bindings unavailable without restoring native behavior', () => {
  const config = imageConfigurationFixture();
  const model = config.models[0];
  if (!model) throw new Error('Missing mock model.');
  model.id = 'gpt_image_2';
  for (const binding of Object.values(model.operations))
    binding.status = 'unverified';
  const catalog = mergeImageModelCatalog(
    imageModelCatalogFromConfiguration(config)
  );
  expect(getImageModelDefinition(model.id, catalog)?.source).toBe('configured');
  expect(isSelectableImageModelId(model.id, catalog)).toBe(false);
});
