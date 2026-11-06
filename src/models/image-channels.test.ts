import { expect, expectTypeOf, it } from 'vitest';
import { generateId } from '@/platform/id';
import type {
  ChannelImageModel,
  ImageChannelsConfiguration,
} from './image-channels';
import {
  IMAGE_CHANNEL_PROTOCOL,
  channelImageModelSchema,
  configuredImageModelIdSchema,
  imageChannelModelIdSchema,
  createImageModelRoutingSnapshot,
  emptyImageChannelsConfiguration,
  imageChannelBaseUrlSchema,
  imageChannelsConfigurationSchema,
  imageModelCatalogFromConfiguration,
  isConfiguredImageModelId,
  resolveImageModelRoute,
  saveImageChannelSchema,
  toImageModelCatalog,
  usesConfiguredImageChannel,
} from './image-channels';

// Synthetic configuration; never contacts the provider.
const model: ChannelImageModel = {
  id: 'custom-image:mock',
  name: 'Mock model',
  description: 'Mock only',
  channelId: 'mock',
  enabled: true,
  operations: {
    generate: {
      upstreamModel: 'mock/Image',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
    edit: {
      upstreamModel: 'mock/Edit',
      status: 'unverified',
      minReferenceImages: 1,
      maxReferenceImages: 3,
      mask: 'unverified',
    },
  },
  parameters: [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate'],
      required: true,
      defaultValue: 'auto',
      values: ['auto', '1024x1024'],
    },
  ],
  priceCards: [
    {
      id: 'base',
      operation: 'generate',
      match: { size: 'auto' },
      unitPriceUsd: 0.04,
      supplierCost: { currency: 'USD', unitPrice: 0.01 },
    },
  ],
};
function mockConfiguration(): ImageChannelsConfiguration {
  return {
    ...emptyImageChannelsConfiguration(),
    models: [structuredClone(model)],
    channels: [
      {
        id: 'mock',
        name: 'Mock channel',
        baseUrl: 'https://10.0.0.4/v1',
        protocol: IMAGE_CHANNEL_PROTOCOL,
        enabled: true,
        credentialId: generateId(),
        keyHint: '****mock',
        hasKey: true,
      },
    ],
  };
}

it('recognizes only bounded custom-image identities without conflating builtins', () => {
  expect(isConfiguredImageModelId('custom-image:qwen/edit')).toBe(true);
  for (const id of [
    'gpt_image_2',
    'custom:text',
    'custom-image:',
    'custom-image:bad key',
    null,
  ])
    expect(isConfiguredImageModelId(id)).toBe(false);
});

it('uses separate channel/model namespace and exact generation/edit upstream mappings', () => {
  const configuration =
    imageChannelsConfigurationSchema.parse(mockConfiguration());
  const route = requireValue(createImageModelRoutingSnapshot(configuration)[0]);
  expect(route).toMatchObject({
    modelId: model.id,
    operations: model.operations,
    baseUrl: 'https://10.0.0.4/v1',
  });
  expect(route).not.toHaveProperty('id');
  expect(resolveImageModelRoute([route], model.id)).toBe(route);
  expect(resolveImageModelRoute([], 'gpt_image_2')).toBeUndefined();
  expect(() => resolveImageModelRoute([], model.id)).toThrow('unavailable');
});

it('publishes no endpoint/upstream/credentials/supplier costs and excludes pending capabilities', () => {
  const [entry] = toImageModelCatalog(
    createImageModelRoutingSnapshot(mockConfiguration())
  );
  const serialized = JSON.stringify(entry);
  for (const secret of [
    'baseUrl',
    'channelId',
    'credentialId',
    'upstreamModel',
    'supplierCost',
    'mock/Edit',
  ])
    expect(serialized).not.toContain(secret);
  expect(entry?.operations).not.toHaveProperty('edit');
  expect(entry?.available).toBe(true);
});

it('preserves names for disabled history without making the model executable', () => {
  const config = mockConfiguration();
  requireValue(config.models[0]).enabled = false;
  expect(createImageModelRoutingSnapshot(config)).toEqual([]);
  expect(imageModelCatalogFromConfiguration(config)[0]).toMatchObject({
    id: model.id,
    name: model.name,
    available: false,
  });
  requireValue(config.models[0]).enabled = true;
  requireValue(config.channels[0]).enabled = false;
  expect(createImageModelRoutingSnapshot(config)).toEqual([]);
  requireValue(config.channels[0]).enabled = true;
  requireValue(config.channels[0]).credentialId = null;
  expect(createImageModelRoutingSnapshot(config)).toEqual([]);
});

it('keeps unverified-only models as configured drafts rather than active routes', () => {
  const config = mockConfiguration();
  requireValue(requireValue(config.models[0]).operations.generate).status =
    'unverified';
  expect(createImageModelRoutingSnapshot(config)).toEqual([]);
  expect(imageModelCatalogFromConfiguration(config)[0]?.available).toBe(false);
});

it('rejects absent enabled-operation rates and impossible price matches', () => {
  expect(
    channelImageModelSchema.safeParse({ ...model, priceCards: [] }).success
  ).toBe(false);
  expect(
    channelImageModelSchema.safeParse({
      ...model,
      enabled: false,
      priceCards: [],
    }).success
  ).toBe(true);
  expect(
    channelImageModelSchema.safeParse({
      ...model,
      priceCards: [{ ...model.priceCards[0], match: { size: 'unknown' } }],
    }).success
  ).toBe(false);
  expect(
    channelImageModelSchema.safeParse({
      ...model,
      priceCards: [{ ...model.priceCards[0], match: { quality: 'high' } }],
    }).success
  ).toBe(false);
});

it('refuses duplicate ids, dangling channels and invalid operation capabilities', () => {
  const config = mockConfiguration();
  expect(
    imageChannelsConfigurationSchema.safeParse({
      ...config,
      models: [model, model],
    }).success
  ).toBe(false);
  expect(
    imageChannelsConfigurationSchema.safeParse({ ...config, channels: [] })
      .success
  ).toBe(false);
  expect(
    channelImageModelSchema.safeParse({
      ...model,
      operations: {
        generate: { ...model.operations.generate, maxReferenceImages: 1 },
      },
    }).success
  ).toBe(false);
  expect(
    channelImageModelSchema.safeParse({
      ...model,
      operations: { edit: { ...model.operations.edit, minReferenceImages: 0 } },
    }).success
  ).toBe(false);
});

it.each([
  'https://user:pass@example.com/v1',
  'https://example.com/v1?key=secret',
  'https://example.com/#x',
  'https://example.com\\path',
  'http://example.com/v1',
  'file:///tmp/a',
  'https://example.com/v1\nheader',
])('rejects unsafe channel endpoint %s', (url) => {
  expect(imageChannelBaseUrlSchema.safeParse(url).success).toBe(false);
});

it('normalizes private HTTPS/loopback endpoints and rejects injected save metadata', () => {
  expect(imageChannelBaseUrlSchema.parse('https://10.0.0.4:8443/v1///')).toBe(
    'https://10.0.0.4:8443/v1'
  );
  expect(imageChannelBaseUrlSchema.parse('http://localhost:4000/v1')).toBe(
    'http://localhost:4000/v1'
  );
  const config = mockConfiguration();
  expect(
    saveImageChannelSchema.safeParse({
      revision: 0,
      ...config.channels[0],
      apiKey: 'mock',
    }).success
  ).toBe(false);
});

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing mock test value.');
  return value;
}

it('accepts built-in bindings without changing the custom identity guard', () => {
  for (const id of ['gpt_image_2', model.id]) {
    expect(imageChannelModelIdSchema.parse(id)).toBe(id);
    expect(channelImageModelSchema.parse({ ...model, id }).id).toBe(id);
  }
  expect(configuredImageModelIdSchema.safeParse('gpt_image_2').success).toBe(
    false
  );
  for (const id of ['unknown-image', 'custom-image:', '__proto__', null])
    expect(imageChannelModelIdSchema.safeParse(id).success).toBe(false);
});

it('reports channel routing as a boolean independently of custom syntax identity', () => {
  expectTypeOf(usesConfiguredImageChannel).returns.toEqualTypeOf<boolean>();
  const config = mockConfiguration();
  requireValue(config.models[0]).id = 'gpt_image_2';
  const routing = createImageModelRoutingSnapshot(config);
  expect(usesConfiguredImageChannel(model.id)).toBe(true);
  expect(usesConfiguredImageChannel(model.id, [])).toBe(true);
  expect(usesConfiguredImageChannel('gpt_image_2')).toBe(false);
  expect(usesConfiguredImageChannel('gpt_image_2', routing)).toBe(true);
  expect(isConfiguredImageModelId('gpt_image_2')).toBe(false);
  for (const id of ['flux_2_max', 'custom-image:', '__proto__', null])
    expect(usesConfiguredImageChannel(id, routing)).toBe(false);
});

it('keeps enabled unverified built-in bindings on the channel path', () => {
  const config = mockConfiguration();
  const builtin = requireValue(config.models[0]);
  builtin.id = 'gpt_image_2';
  requireValue(builtin.operations.generate).status = 'unverified';
  builtin.priceCards = [];
  const parsed = imageChannelsConfigurationSchema.parse(config);
  const routing = createImageModelRoutingSnapshot(parsed);
  expect(usesConfiguredImageChannel(builtin.id, routing)).toBe(true);
  expect(
    resolveImageModelRoute(routing, builtin.id)?.operations.generate?.status
  ).toBe('unverified');
  expect(imageModelCatalogFromConfiguration(parsed)[0]).toMatchObject({
    id: builtin.id,
    available: true,
    operations: {},
    priceCards: [],
  });
});

it('refuses active built-in bindings without their configured channel credential', () => {
  const config = mockConfiguration();
  requireValue(config.models[0]).id = 'gpt_image_2';
  const channel = requireValue(config.channels[0]);
  channel.credentialId = null;
  channel.keyHint = null;
  channel.hasKey = false;
  expect(() => createImageModelRoutingSnapshot(config)).toThrow('unavailable');
  expect(() => imageModelCatalogFromConfiguration(config)).toThrow(
    'unavailable'
  );
  config.channels = [];
  expect(() => createImageModelRoutingSnapshot(config)).toThrow('unavailable');
});

it('retains an unpriced built-in binding instead of treating it as unbound', () => {
  const config = mockConfiguration();
  const builtin = requireValue(config.models[0]);
  builtin.id = 'gpt_image_2';
  builtin.priceCards = [];
  expect(channelImageModelSchema.safeParse(builtin).success).toBe(false);
  const routing = createImageModelRoutingSnapshot(config);
  expect(usesConfiguredImageChannel(builtin.id, routing)).toBe(true);
  expect(resolveImageModelRoute(routing, builtin.id)?.priceCards).toEqual([]);
});

it('retains an active built-in route with missing operations until explicit validation rejects it', () => {
  const config = mockConfiguration();
  const builtin = requireValue(config.models[0]);
  builtin.id = 'gpt_image_2';
  builtin.operations = {};
  expect(channelImageModelSchema.safeParse(builtin).success).toBe(false);
  const routing = createImageModelRoutingSnapshot(config);
  expect(usesConfiguredImageChannel(builtin.id, routing)).toBe(true);
  expect(resolveImageModelRoute(routing, builtin.id)?.operations).toEqual({});
  expect(imageModelCatalogFromConfiguration(config)[0]).toMatchObject({
    id: builtin.id,
    available: true,
    operations: {},
    priceCards: [],
  });
});
