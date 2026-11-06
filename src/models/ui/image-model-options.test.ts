import { describe, expect, it } from 'vitest';
import { imageCatalogFixture } from '../__tests__/image-model-fixture';
import { mergeImageModelCatalog } from '../image-model-catalog';
import { imageModelSelectorOptions } from './image-model-options';
import { IMAGE_MODELS } from '../models';
import { getModelConfigurationOptions } from '../model-configuration';

describe('image selector options', () => {
  it('only offers priced operations compatible with the requested reference count', () => {
    const model = imageCatalogFixture({
      operations: {
        edit: {
          status: 'verified',
          minReferenceImages: 1,
          maxReferenceImages: 8,
          mask: 'unsupported',
        },
      },
    });
    const catalog = mergeImageModelCatalog([model]);
    expect(
      imageModelSelectorOptions(catalog, { operation: 'generate' }).some(
        (option) => option.id === model.id
      )
    ).toBe(false);
    expect(
      imageModelSelectorOptions(catalog, {
        operation: 'edit',
        referenceCount: 4,
      }).find((option) => option.id === model.id)?.disabled
    ).toBe(false);
    expect(
      imageModelSelectorOptions(catalog, {
        operation: 'edit',
        referenceCount: 9,
      }).some((option) => option.id === model.id)
    ).toBe(false);
  });

  it('retains selected historical names as disabled entries and never invents a fallback', () => {
    const model = imageCatalogFixture({ available: false });
    const catalog = mergeImageModelCatalog([model]);
    const selectedIds = [model.id, 'custom-image:removed'] as const;
    const options = imageModelSelectorOptions(catalog, { selectedIds });
    expect(options.find((option) => option.id === model.id)).toMatchObject({
      name: model.name,
      disabled: true,
    });
    expect(
      options.find((option) => option.id === selectedIds[1])
    ).toMatchObject({ name: selectedIds[1], disabled: true });
    expect(
      imageModelSelectorOptions(catalog).some(
        (option) => option.id === model.id
      )
    ).toBe(false);
  });
});

// Catalog records below are local mock metadata and never call a provider.
it('keeps one original built-in name and ID in pickers and default-model options when bound', () => {
  const binding = imageCatalogFixture({
    id: 'gpt_image_2',
    name: 'Fixture override',
  });
  const custom = imageCatalogFixture();
  const catalog = mergeImageModelCatalog([binding, custom]);
  const options = imageModelSelectorOptions(catalog, {
    selectedIds: [binding.id],
  });
  expect(options.filter((option) => option.id === binding.id)).toEqual([
    expect.objectContaining({
      id: 'gpt_image_2',
      name: IMAGE_MODELS.gpt_image_2.name,
      disabled: false,
    }),
  ]);
  expect(options.some((option) => option.id === 'nano_banana_2_lite')).toBe(
    true
  );
  expect(options.some((option) => option.id === 'nano_banana_2')).toBe(false);
  expect(options.find((option) => option.id === custom.id)?.name).toBe(
    custom.name
  );
  expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  const defaults = getModelConfigurationOptions('defaultImage', [], catalog);
  expect(new Set(defaults.map((option) => option.value)).size).toBe(
    defaults.length
  );
  expect(defaults.filter((option) => option.value === binding.id)).toEqual([
    { value: binding.id, label: IMAGE_MODELS.gpt_image_2.name },
  ]);
});

it('uses configured operation capabilities instead of the built-in reference capability', () => {
  const binding = imageCatalogFixture({
    id: 'gpt_image_2',
    operations: {
      generate: {
        status: 'verified',
        minReferenceImages: 0,
        maxReferenceImages: 0,
        mask: 'unsupported',
      },
    },
  });
  const options = imageModelSelectorOptions(mergeImageModelCatalog([binding]), {
    selectedIds: [binding.id],
    operation: 'edit',
    referenceCount: 1,
  });
  expect(options.filter((option) => option.id === binding.id)).toEqual([
    expect.objectContaining({ disabled: true }),
  ]);
});
