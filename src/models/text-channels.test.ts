import { expect, it } from 'vitest';
import type { ChannelTextModel, TextChannel } from './text-channels';
import {
  TEXT_CHANNEL_PROTOCOL,
  TEXT_CHANNEL_PROTOCOLS,
  TEXT_CHANNEL_LIMITS,
  channelTextModelSchema,
  createTextModelRoutingSnapshot,
  emptyTextChannelsConfiguration,
  isCustomTextModelId,
  resolveTextModelRoute,
  saveChannelTextModelSchema,
  saveTextChannelSchema,
  textChannelBaseUrlSchema,
  textChannelsConfigurationSchema,
  toTextModelCatalog,
} from './text-channels';

const channel: TextChannel = {
  id: 'gateway',
  name: 'Internal provider',
  baseUrl: 'https://10.0.0.8:8443/v1',
  protocol: TEXT_CHANNEL_PROTOCOL,
  enabled: true,
  credentialId: '341f120f-edbf-47b0-99e2-9ec24cd78ef9',
  keyHint: '****mock',
  hasKey: true,
};
const model: ChannelTextModel = {
  id: 'custom:example',
  name: 'Example text model',
  channelId: channel.id,
  upstreamModel: 'upstream/example',
  enabled: true,
  vision: true,
  structuredOutput: true,
  tools: false,
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 0.4,
  outputPricePerMillion: 0.8,
};

it.each([
  'https://10.0.0.8:8443/v1',
  'https://localhost/v1',
  'https://[fd00::1]/v1',
  'https://provider.example/api/openai/v1',
])('permits supplied private and public HTTPS base URLs: %s', (baseUrl) => {
  expect(textChannelBaseUrlSchema.parse(baseUrl)).toBe(baseUrl);
});

it.each([
  'http://provider.example/v1',
  'file:///etc/passwd',
  'https://user:secret@provider.example/v1',
  'https://provider.example/v1?key=secret',
  'https://provider.example/v1#secret',
  'https://provider.example/v1?',
  'https://provider.example/v1#',
  'https://provider.example\\@other.example/v1',
  'not-a-url',
])('rejects an unsafe channel base URL: %s', (baseUrl) => {
  expect(textChannelBaseUrlSchema.safeParse(baseUrl).success).toBe(false);
});

it('normalizes trailing slashes without dropping an API path prefix', () => {
  expect(
    textChannelBaseUrlSchema.parse(' https://provider.example/v1/// ')
  ).toBe('https://provider.example/v1');
});

it('requires explicit rates and rejects negative and nonfinite rates', () => {
  const { inputPricePerMillion: _rate, ...missingRate } = model;
  expect(channelTextModelSchema.safeParse(missingRate).success).toBe(false);
  for (const rate of [-1, Infinity, NaN]) {
    expect(
      channelTextModelSchema.safeParse({
        ...model,
        outputPricePerMillion: rate,
      }).success
    ).toBe(false);
  }
  expect(
    channelTextModelSchema.parse({ ...model, inputPricePerMillion: 0 })
      .inputPricePerMillion
  ).toBe(0);
});

it('requires explicit capabilities and safe token limits', () => {
  const { tools: _tools, ...missingCapabilities } = model;
  expect(channelTextModelSchema.safeParse(missingCapabilities).success).toBe(
    false
  );
  for (const contextWindow of [0, -1, 1.5, Infinity]) {
    expect(
      channelTextModelSchema.safeParse({ ...model, contextWindow }).success
    ).toBe(false);
  }
  expect(
    channelTextModelSchema.safeParse({ ...model, maxOutputTokens: 64_000 })
      .success
  ).toBe(false);
  expect(
    saveChannelTextModelSchema.safeParse({ ...model, revision: 0 }).success
  ).toBe(true);
});

it('only accepts built-in IDs or local custom IDs for bindings', () => {
  expect(
    channelTextModelSchema.parse({
      ...model,
      id: 'anthropic/claude-sonnet-5.5',
      tools: true,
    }).id
  ).toBe('anthropic/claude-sonnet-5.5');
  expect(isCustomTextModelId(model.id)).toBe(true);
  for (const id of [
    'new-provider/model',
    'custom:',
    'custom:with spaces',
    'custom:../model',
  ]) {
    expect(channelTextModelSchema.safeParse({ ...model, id }).success).toBe(
      false
    );
  }
});

it('cannot save client-forged credential metadata or protocols', () => {
  const input = {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    protocol: channel.protocol,
    enabled: true,
    revision: 0,
  };
  expect(
    saveTextChannelSchema.safeParse({ ...input, credentialId: 'forged' })
      .success
  ).toBe(false);
  expect(
    saveTextChannelSchema.safeParse({ ...input, protocol: 'fal' }).success
  ).toBe(false);
  expect(
    saveTextChannelSchema.safeParse({
      ...input,
      apiKey: 'mock-key\r\ninjected',
    }).success
  ).toBe(false);
});

it('preserves routes for an empty configuration and rejects unavailable custom models', () => {
  const snapshot = createTextModelRoutingSnapshot(
    emptyTextChannelsConfiguration()
  );
  expect(snapshot).toEqual([]);
  expect(
    resolveTextModelRoute(snapshot, 'anthropic/claude-sonnet-5.5')
  ).toBeUndefined();
  expect(() => resolveTextModelRoute(snapshot, model.id)).toThrow(
    'Custom text model is unavailable.'
  );
});

it('includes only enabled models with enabled credential-bearing channels', () => {
  const configuration = { revision: 3, channels: [channel], models: [model] };
  const [route] = createTextModelRoutingSnapshot(configuration);
  expect(route).toMatchObject({
    modelId: model.id,
    credentialId: channel.credentialId,
    baseUrl: channel.baseUrl,
    channelId: channel.id,
    upstreamModel: model.upstreamModel,
  });
  expect(route).not.toHaveProperty('id');
  expect(route).not.toHaveProperty('keyHint');
  expect(
    createTextModelRoutingSnapshot({
      ...configuration,
      models: [{ ...model, enabled: false }],
    })
  ).toEqual([]);
  expect(
    createTextModelRoutingSnapshot({
      ...configuration,
      channels: [{ ...channel, enabled: false }],
    })
  ).toEqual([]);
  expect(
    createTextModelRoutingSnapshot({
      ...configuration,
      channels: [{ ...channel, credentialId: null }],
    })
  ).toEqual([]);
});

it('projects only public model metadata into the incremental catalog', () => {
  const snapshot = createTextModelRoutingSnapshot({
    revision: 2,
    channels: [channel],
    models: [model],
  });
  const [entry] = toTextModelCatalog(snapshot);
  expect(entry).toEqual({
    id: model.id,
    name: model.name,
    vision: model.vision,
    structuredOutput: model.structuredOutput,
    tools: model.tools,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    inputPricePerMillion: model.inputPricePerMillion,
    outputPricePerMillion: model.outputPricePerMillion,
  });
  for (const privateField of [
    'baseUrl',
    'channelId',
    'credentialId',
    'keyHint',
    'upstreamModel',
  ]) {
    expect(entry).not.toHaveProperty(privateField);
  }
});

it('rejects duplicate records, dangling bindings, and forged key hints in persisted settings', () => {
  expect(
    textChannelsConfigurationSchema.safeParse({
      revision: 0,
      channels: [channel, channel],
      models: [],
    }).success
  ).toBe(false);
  expect(
    textChannelsConfigurationSchema.safeParse({
      revision: 0,
      channels: [channel],
      models: [model, model],
    }).success
  ).toBe(false);
  expect(
    textChannelsConfigurationSchema.safeParse({
      revision: 0,
      channels: [],
      models: [model],
    }).success
  ).toBe(false);
  expect(
    textChannelsConfigurationSchema.safeParse({
      revision: 0,
      channels: [{ ...channel, hasKey: false }],
      models: [],
    }).success
  ).toBe(false);
});

it.each(['structuredOutput', 'tools', 'vision'] as const)(
  'preserves builtin %s guarantees when an enabled binding overrides a native model',
  (capability) => {
    const builtin = {
      ...model,
      id: 'anthropic/claude-sonnet-5.5',
      tools: true,
    };
    expect(
      channelTextModelSchema.safeParse({ ...builtin, [capability]: false })
        .success
    ).toBe(false);
    expect(
      channelTextModelSchema.safeParse({
        ...builtin,
        [capability]: false,
        enabled: false,
      }).success
    ).toBe(true);
    expect(
      channelTextModelSchema.safeParse({ ...model, [capability]: false })
        .success
    ).toBe(true);
  }
);

it('limits configured bindings so routing snapshots remain bounded', () => {
  const models = Array.from(
    { length: TEXT_CHANNEL_LIMITS.models + 1 },
    (_, index) => ({
      ...model,
      id: `custom:bounded-${index}`,
    })
  );
  expect(
    textChannelsConfigurationSchema.safeParse({
      revision: 0,
      channels: [channel],
      models,
    }).success
  ).toBe(false);
});

it.each([
  'http://localhost:4010/v1',
  'http://127.0.0.1:4010/v1',
  'http://[::1]:4010/v1',
])('permits the explicit HTTP loopback development endpoint %s', (baseUrl) => {
  expect(textChannelBaseUrlSchema.parse(baseUrl)).toBe(baseUrl);
});
it.each([
  'http://10.0.0.5/v1',
  'http://localhost.example/v1',
  'http://127.0.0.2/v1',
])('requires HTTPS for every non-allowlisted HTTP origin %s', (baseUrl) => {
  expect(textChannelBaseUrlSchema.safeParse(baseUrl).success).toBe(false);
});

it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
  'validates and snapshots the selected protocol %s',
  (protocol) => {
    const parsed = saveTextChannelSchema.parse({
      revision: 0,
      id: channel.id,
      name: channel.name,
      baseUrl: channel.baseUrl,
      protocol,
      enabled: true,
    });
    expect(parsed.protocol).toBe(protocol);
    const configuration = textChannelsConfigurationSchema.parse({
      revision: 1,
      channels: [{ ...channel, protocol }],
      models: [model],
    });
    const [snapshot] = createTextModelRoutingSnapshot(configuration);
    expect(snapshot?.protocol).toBe(protocol);
    expect(snapshot?.upstreamModel).toBe(model.upstreamModel);
  }
);
