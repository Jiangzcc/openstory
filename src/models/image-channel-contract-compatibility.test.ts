import { expect, it } from 'vitest';
import { imageConfigurationFixture } from './__tests__/image-model-fixture';
import {
  createImageModelRoutingSnapshot,
  imageChannelsConfigurationSchema,
  imageModelCatalogFromConfiguration,
  resolveImageModelRoute,
  saveChannelImageModelSchema,
  usesConfiguredImageChannel,
} from './image-channels';
import {
  isSelectableImageModelId,
  mergeImageModelCatalog,
} from './image-model-catalog';
import { validateImageChannelParameters } from './image-channel-parameters';
import type { ImageChannelParameter } from './image-channel-parameters';

// Synthetic legacy records; no provider or database access.
function historicalConfiguration(
  id: 'gpt_image_2' | 'custom-image:qwen',
  parameter: Partial<ImageChannelParameter> = {}
) {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing synthetic model.');
  model.id = id;
  model.parameters.push({
    key: 'quality',
    label: 'Quality',
    type: 'string',
    status: 'verified',
    operations: ['generate', 'edit'],
    required: false,
    defaultValue: 'hd',
    values: ['high', 'hd'],
    ...parameter,
  });
  return { configuration, model };
}

it.each(['gpt_image_2', 'custom-image:qwen'] as const)(
  'keeps the historical %s route and valid operation while hiding the invalid operation',
  (id) => {
    const { configuration, model } = historicalConfiguration(id);
    const parsed = imageChannelsConfigurationSchema.parse(configuration);
    expect(parsed.models).toEqual([model]);
    const routing = createImageModelRoutingSnapshot(parsed);
    expect(usesConfiguredImageChannel(id, routing)).toBe(true);
    expect(resolveImageModelRoute(routing, id)?.operations.edit?.status).toBe(
      'verified'
    );
    const catalog = mergeImageModelCatalog(
      imageModelCatalogFromConfiguration(parsed)
    );
    expect(isSelectableImageModelId(id, catalog, 'generate')).toBe(true);
    expect(isSelectableImageModelId(id, catalog, 'edit', 1)).toBe(false);
    expect(() =>
      validateImageChannelParameters(model.parameters, 'edit', {})
    ).toThrow('unavailable');
    expect(
      saveChannelImageModelSchema.safeParse({ ...model, revision: 1 }).success
    ).toBe(false);
    expect(
      saveChannelImageModelSchema.parse({
        ...model,
        enabled: false,
        revision: 1,
      }).enabled
    ).toBe(false);
  }
);

it('keeps a broken built-in binding instead of publishing its original fal capabilities', () => {
  const { configuration, model } = historicalConfiguration('gpt_image_2', {
    key: 'auth',
    defaultValue: 'synthetic',
    values: ['synthetic'],
  });
  const parsed = imageChannelsConfigurationSchema.parse(configuration);
  const routing = createImageModelRoutingSnapshot(parsed);
  expect(usesConfiguredImageChannel(model.id, routing)).toBe(true);
  expect(resolveImageModelRoute(routing, model.id)?.baseUrl).toBe(
    configuration.channels[0]?.baseUrl
  );
  const entries = imageModelCatalogFromConfiguration(parsed);
  expect(entries[0]).toMatchObject({
    id: model.id,
    available: true,
    operations: {},
    parameters: [],
    priceCards: [],
  });
  const catalog = mergeImageModelCatalog(entries);
  expect(isSelectableImageModelId(model.id, catalog)).toBe(false);
  expect(
    saveChannelImageModelSchema.safeParse({
      ...model,
      revision: 1,
      enabled: false,
    }).success
  ).toBe(true);
});

it.each([0.0000001, 0.0000014, 0.1234567])(
  'rejects enabling fractional-microdollar sale prices while keeping %s readable and disableable',
  (unitPriceUsd) => {
    const configuration = imageConfigurationFixture();
    const model = configuration.models[0];
    const price = model?.priceCards[0];
    if (!model || !price) throw new Error('Missing synthetic price.');
    price.unitPriceUsd = unitPriceUsd;
    expect(
      imageChannelsConfigurationSchema.safeParse(configuration).success
    ).toBe(true);
    const active = saveChannelImageModelSchema.safeParse({
      ...model,
      revision: 1,
    });
    expect(active.success).toBe(false);
    if (!active.success)
      expect(active.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['priceCards'],
          message: 'The configured price is outside wallet precision.',
        })
      );
    expect(
      saveChannelImageModelSchema.safeParse({
        ...model,
        enabled: false,
        revision: 1,
      }).success
    ).toBe(true);
  }
);

it('allows zero and integer-microdollar sale prices without constraining supplier-cost precision', () => {
  for (const unitPriceUsd of [0, 0.000001, 0.000007, 0.123456, 1_000_000]) {
    const configuration = imageConfigurationFixture();
    const model = configuration.models[0];
    const price = model?.priceCards[0];
    if (!model || !price) throw new Error('Missing synthetic price.');
    price.unitPriceUsd = unitPriceUsd;
    price.supplierCost = { currency: 'USD', unitPrice: 0.0000001 };
    expect(
      saveChannelImageModelSchema.safeParse({ ...model, revision: 1 }).success
    ).toBe(true);
  }
});
