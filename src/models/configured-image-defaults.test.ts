import { describe, expect, it } from 'vitest';
import { imageCatalogFixture } from './__tests__/image-model-fixture';
import { mergeImageModelCatalog } from './image-model-catalog';
import {
  DEFAULT_MODEL_CONFIGURATION,
  createModelConfigurationSchema,
  getModelConfigurationOptions,
  modelConfigurationInputSchema,
  resolveModelConfiguration,
} from './model-configuration';

describe('configured image defaults', () => {
  it('saves configured image identities in all image and helper slots', () => {
    const model = imageCatalogFixture();
    const catalog = mergeImageModelCatalog([model]);
    const configuration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultImage: model.id,
      turboImage: model.id,
      qualityImage: model.id,
      poster: model.id,
      shotPreview: model.id,
    };
    expect(
      createModelConfigurationSchema([], false, catalog).parse(configuration)
    ).toEqual(configuration);
    expect(modelConfigurationInputSchema.parse(configuration)).toEqual(
      configuration
    );
    expect(getModelConfigurationOptions('poster', [], catalog)).toContainEqual({
      value: model.id,
      label: model.name,
    });
  });

  it('preserves unresolved or disabled saved identities without silently selecting a built-in default', () => {
    const model = imageCatalogFixture({ available: false });
    expect(
      resolveModelConfiguration({ defaultImage: model.id }).defaultImage
    ).toBe(model.id);
    expect(
      resolveModelConfiguration(
        { poster: model.id },
        [],
        mergeImageModelCatalog([model])
      ).poster
    ).toBe(model.id);
    expect(() =>
      createModelConfigurationSchema(
        [],
        false,
        mergeImageModelCatalog([model])
      ).parse({ ...DEFAULT_MODEL_CONFIGURATION, defaultImage: model.id })
    ).toThrow();
  });

  it('requires a generation route for the poster and excludes models without any configured image price', () => {
    const model = imageCatalogFixture();
    const editing = { ...model, operations: { edit: model.operations.edit } };
    const catalog = mergeImageModelCatalog([editing]);
    expect(
      getModelConfigurationOptions('poster', [], catalog).some(
        (option) => option.value === model.id
      )
    ).toBe(false);
    expect(
      getModelConfigurationOptions('shotPreview', [], catalog).some(
        (option) => option.value === model.id
      )
    ).toBe(true);
    expect(
      getModelConfigurationOptions(
        'defaultImage',
        [],
        mergeImageModelCatalog([{ ...model, priceCards: [] }])
      ).some((option) => option.value === model.id)
    ).toBe(false);
  });
});

describe('unavailable built-in image bindings', () => {
  it('keeps saved built-in defaults readable while refusing new unavailable selections', () => {
    const model = imageCatalogFixture({
      id: 'flux_2_dev',
      operations: {},
      priceCards: [],
    });
    const catalog = mergeImageModelCatalog([model]);
    const saved = { ...DEFAULT_MODEL_CONFIGURATION, defaultImage: model.id };
    expect(resolveModelConfiguration(saved, [], catalog)).toEqual(saved);
    expect(() =>
      createModelConfigurationSchema([], false, catalog).parse(saved)
    ).toThrow();
    expect(
      getModelConfigurationOptions('defaultImage', [], catalog).some(
        (option) => option.value === model.id
      )
    ).toBe(false);
  });

  it('keeps a saved poster identity readable after its binding becomes edit-only', () => {
    const model = imageCatalogFixture({ id: 'flux_2_dev' });
    model.operations = { edit: model.operations.edit };
    model.priceCards = model.priceCards.filter(
      (card) => card.operation === 'edit'
    );
    const catalog = mergeImageModelCatalog([model]);
    const saved = { ...DEFAULT_MODEL_CONFIGURATION, poster: model.id };
    expect(resolveModelConfiguration(saved, [], catalog)).toEqual(saved);
    expect(() =>
      createModelConfigurationSchema([], false, catalog).parse(saved)
    ).toThrow();
    expect(
      getModelConfigurationOptions('shotPreview', [], catalog).some(
        (option) => option.value === model.id
      )
    ).toBe(true);
  });
});

const IMAGE_DEFAULT_SLOTS = [
  'defaultImage',
  'turboImage',
  'qualityImage',
  'poster',
  'shotPreview',
] as const;

describe('image default selection availability', () => {
  it.each(IMAGE_DEFAULT_SLOTS)(
    'keeps an unavailable saved %s readable without accepting it as a new choice',
    (key) => {
      const id = DEFAULT_MODEL_CONFIGURATION[key];
      const catalog = mergeImageModelCatalog([
        imageCatalogFixture({ id, operations: {}, priceCards: [] }),
      ]);
      const saved = { ...DEFAULT_MODEL_CONFIGURATION, [key]: id };
      expect(resolveModelConfiguration(saved, [], catalog)).toEqual(saved);
      expect(getModelConfigurationOptions(key, [], catalog)).not.toContainEqual(
        expect.objectContaining({ value: id })
      );
      expect(() =>
        createModelConfigurationSchema([], false, catalog).parse(saved)
      ).toThrow();
    }
  );

  it('refuses an edit-only binding for the built-in poster default', () => {
    const model = imageCatalogFixture({
      id: DEFAULT_MODEL_CONFIGURATION.poster,
    });
    model.operations = { edit: model.operations.edit };
    model.priceCards = model.priceCards.filter(
      (card) => card.operation === 'edit'
    );
    const catalog = mergeImageModelCatalog([model]);
    expect(
      resolveModelConfiguration(DEFAULT_MODEL_CONFIGURATION, [], catalog)
    ).toEqual(DEFAULT_MODEL_CONFIGURATION);
    expect(() =>
      createModelConfigurationSchema([], false, catalog).parse(
        DEFAULT_MODEL_CONFIGURATION
      )
    ).toThrow();
  });
});

describe('hidden built-in image defaults', () => {
  it('preserves the hidden built-in poster default only in its supported slot', () => {
    const id = DEFAULT_MODEL_CONFIGURATION.poster;
    const catalog = mergeImageModelCatalog();
    expect(getModelConfigurationOptions('poster', [], catalog)).toContainEqual(
      expect.objectContaining({ value: id })
    );
    expect(
      getModelConfigurationOptions('defaultImage', [], catalog)
    ).not.toContainEqual(expect.objectContaining({ value: id }));
    expect(
      createModelConfigurationSchema([], false, catalog).parse(
        DEFAULT_MODEL_CONFIGURATION
      )
    ).toEqual(DEFAULT_MODEL_CONFIGURATION);
  });

  it('accepts a verified priced binding for the hidden built-in poster default', () => {
    const model = imageCatalogFixture({
      id: DEFAULT_MODEL_CONFIGURATION.poster,
    });
    const catalog = mergeImageModelCatalog([model]);
    expect(getModelConfigurationOptions('poster', [], catalog)).toContainEqual(
      expect.objectContaining({ value: model.id })
    );
    expect(
      createModelConfigurationSchema([], false, catalog).parse(
        DEFAULT_MODEL_CONFIGURATION
      )
    ).toEqual(DEFAULT_MODEL_CONFIGURATION);
  });
});
