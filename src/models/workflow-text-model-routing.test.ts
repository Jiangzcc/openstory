import { configuredTextCostUsd } from '@/billing/configured-text-cost';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from './model-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
} from './model-runtime-configuration';
import type { TextChannel, TextModelRoute } from './text-channels';
import {
  TEXT_CHANNEL_LIMITS,
  TEXT_CHANNEL_PROTOCOLS,
  createTextModelRoutingSnapshot,
  resolveTextModelRoute,
  textChannelBaseUrlSchema,
  textChannelsConfigurationSchema,
  toTextModelCatalog,
} from './text-channels';
import { textModelCatalogFromRouting } from './text-model-catalog';
import { getMaxOutputTokens, resolveVisionModel } from './models.config';
import { configuredTextModelOptions } from './server/configured-text';
import {
  packWorkflowTextModelRouting,
  unpackWorkflowTextModelRouting,
} from './workflow-text-model-routing';

const ONE_MIB = 1024 * 1024;
const SNAPSHOT_SIZE_BUDGET = 640 * 1024;
const URL_ENCODED_HAN_LENGTH = encodeURIComponent('模').length;

function mockRoute(overrides: Partial<TextModelRoute> = {}): TextModelRoute {
  return {
    modelId: 'custom:mock-text',
    name: 'Mock text model',
    channelId: 'mock-channel',
    upstreamModel: 'mock-upstream',
    credentialId: '341f120f-edbf-47b0-99e2-9ec24cd78ef9',
    protocol: TEXT_CHANNEL_PROTOCOLS.responses,
    baseUrl: 'https://mock.invalid/v1',
    vision: false,
    structuredOutput: true,
    tools: true,
    contextWindow: 32_000,
    maxOutputTokens: 4_000,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
    description: 'Mock catalog description',
    vendor: 'Mock catalog vendor',
    ...overrides,
  };
}

function executionFields(route: TextModelRoute) {
  const { description: _description, vendor: _vendor, ...execution } = route;
  return execution;
}

function maximalChannels(): TextChannel[] {
  return Array.from({ length: TEXT_CHANNEL_LIMITS.channels }, (_, index) => {
    const prefix = `https://mock.invalid/${index}/`;
    const pathLength = TEXT_CHANNEL_LIMITS.baseUrl - prefix.length;
    return {
      id: String(index).padStart(TEXT_CHANNEL_LIMITS.id, 'c'),
      name: '\0'.repeat(TEXT_CHANNEL_LIMITS.name),
      baseUrl:
        prefix +
        '模'.repeat(Math.floor(pathLength / URL_ENCODED_HAN_LENGTH)) +
        'a'.repeat(pathLength % URL_ENCODED_HAN_LENGTH),
      protocol: TEXT_CHANNEL_PROTOCOLS.chatCompletions,
      userAgent: '"'.repeat(TEXT_CHANNEL_LIMITS.userAgent),
      enabled: true,
      credentialId: String(index).padStart(TEXT_CHANNEL_LIMITS.id, 'k'),
      keyHint: 'mock',
      hasKey: true,
    };
  });
}

function maximalConfiguration(upstreamCharacter: string) {
  const channels = maximalChannels();
  return textChannelsConfigurationSchema.parse({
    revision: 1,
    channels,
    models: channels.map((channel, index) => ({
      id: `custom:${index}`.padEnd(TEXT_CHANNEL_LIMITS.id, 'm'),
      name: '\0'.repeat(TEXT_CHANNEL_LIMITS.name),
      channelId: channel.id,
      upstreamModel: upstreamCharacter.repeat(
        TEXT_CHANNEL_LIMITS.upstreamModel
      ),
      enabled: true,
      vision: false,
      structuredOutput: false,
      tools: false,
      contextWindow: Number.MAX_SAFE_INTEGER,
      maxOutputTokens: Number.MAX_SAFE_INTEGER,
      inputPricePerMillion: Number.MAX_VALUE,
      outputPricePerMillion: Number.MAX_VALUE,
      description: '\0'.repeat(TEXT_CHANNEL_LIMITS.description),
      vendor: '\0'.repeat(TEXT_CHANNEL_LIMITS.name),
    })),
  });
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe('workflow execution routing snapshot', () => {
  it('deduplicates complete channel identities and preserves execution fields', () => {
    const routes = [mockRoute(), mockRoute({ modelId: 'custom:mock-other' })];
    const packed = packWorkflowTextModelRouting(routes);
    expect(packed.channels).toHaveLength(1);
    expect(packed.models.map((model) => model.channelIndex)).toEqual([0, 0]);
    expect(unpackWorkflowTextModelRouting(structuredClone(packed))).toEqual(
      routes.map(executionFields)
    );
    expect(JSON.parse(JSON.stringify(packed))).toEqual(packed);
    expect(JSON.stringify(packed)).not.toContain('Mock catalog description');
    expect(JSON.stringify(packed)).not.toContain('Mock catalog vendor');
  });

  it('does not merge routes with different frozen credentials, endpoints or User-Agents', () => {
    const original = mockRoute();
    const routes = [
      original,
      mockRoute({ modelId: 'custom:credential', credentialId: 'mock-old-key' }),
      mockRoute({ modelId: 'custom:endpoint', baseUrl: 'https://old.invalid' }),
      mockRoute({
        modelId: 'custom:protocol',
        protocol: TEXT_CHANNEL_PROTOCOLS.chatCompletions,
      }),
      mockRoute({ modelId: 'custom:user-agent', userAgent: 'Deployment/2.0' }),
    ];
    const packed = packWorkflowTextModelRouting(routes);
    expect(packed.channels).toHaveLength(routes.length);
    expect(unpackWorkflowTextModelRouting(packed)).toEqual(
      routes.map(executionFields)
    );
  });

  it('retains runtime catalog capabilities, token limits and snapshotted rates', () => {
    const routes = [
      mockRoute(),
      mockRoute({ modelId: 'custom:vision', vision: true }),
    ];
    const unpacked = unpackWorkflowTextModelRouting(
      packWorkflowTextModelRouting(routes)
    );
    const catalog = textModelCatalogFromRouting(unpacked);
    expect(catalog[0]).toMatchObject({
      id: 'custom:mock-text',
      name: 'Mock text model',
      vision: false,
      structuredOutput: true,
      tools: true,
      contextWindow: 32_000,
      maxOutputTokens: 4_000,
    });
    expect(
      resolveVisionModel('custom:mock-text', true, 'custom:vision', catalog)
    ).toBe('custom:vision');
    expect(getMaxOutputTokens('custom:mock-text', 0.5, catalog)).toBe(4_000);
    const route = resolveTextModelRoute(unpacked, 'custom:mock-text');
    if (!route) throw new Error('Mock execution route missing');
    expect(configuredTextModelOptions(route, { max_tokens: 100_000 })).toEqual({
      max_output_tokens: 4_000,
    });
    expect(
      configuredTextCostUsd(
        { promptTokens: 1_000, completionTokens: 200, totalTokens: 1_200 },
        route
      )
    ).toBe(0.0008);
  });

  it('does not change the request-side catalog or its display metadata', () => {
    const route = mockRoute();
    const before = toTextModelCatalog([route]);
    packWorkflowTextModelRouting([route]);
    expect(toTextModelCatalog([route])).toEqual(before);
    expect(before[0]).toMatchObject({
      name: route.name,
      vendor: route.vendor,
      description: route.description,
    });
  });

  it('owns immutable copies of channel and model execution data', () => {
    const route = mockRoute({ userAgent: 'Deployment/2.0' });
    const packed = packWorkflowTextModelRouting([route]);
    route.baseUrl = 'https://replacement.invalid';
    route.inputPricePerMillion = 99;
    route.userAgent = 'Replacement/3.0';
    expect(Object.isFrozen(packed)).toBe(true);
    expect(Object.isFrozen(packed.channels)).toBe(true);
    expect(Object.isFrozen(packed.channels[0])).toBe(true);
    expect(Object.isFrozen(packed.models)).toBe(true);
    expect(Object.isFrozen(packed.models[0])).toBe(true);
    expect(unpackWorkflowTextModelRouting(packed)[0]).toMatchObject({
      baseUrl: 'https://mock.invalid/v1',
      inputPricePerMillion: 0.5,
      userAgent: 'Deployment/2.0',
    });
  });

  it('round-trips custom User-Agents through JSON without exposing them in the catalog', () => {
    const route = mockRoute({ userAgent: 'Deployment/2.0' });
    const packed = packWorkflowTextModelRouting([route]);
    const replayed = unpackWorkflowTextModelRouting(structuredClone(packed));
    expect(replayed).toEqual([executionFields(route)]);
    expect(packed.channels[0]?.userAgent).toBe('Deployment/2.0');
    expect(JSON.parse(JSON.stringify(packed))).toEqual(packed);
    expect(toTextModelCatalog(replayed)[0]).not.toHaveProperty('userAgent');
  });

  it('replays version-one snapshots created before User-Agent was configurable', () => {
    const route = mockRoute();
    const packed = packWorkflowTextModelRouting([route]);
    expect(packed.version).toBe(1);
    expect(packed.channels[0]).not.toHaveProperty('userAgent');
    expect(unpackWorkflowTextModelRouting(packed)).toEqual([
      executionFields(route),
    ]);
  });

  it('replays legacy flat arrays and absent snapshots without upgrading their routes', () => {
    const legacy = {
      ...DEFAULT_MODEL_CONFIGURATION,
      textModelRouting: [mockRoute()],
    };
    expect(unpackModelRuntimeConfiguration(legacy)).toEqual(legacy);
    expect(
      unpackModelRuntimeConfiguration(DEFAULT_MODEL_CONFIGURATION)
    ).toEqual(DEFAULT_MODEL_CONFIGURATION);
    const empty = { ...DEFAULT_MODEL_CONFIGURATION, textModelRouting: [] };
    expect(
      unpackModelRuntimeConfiguration(packModelRuntimeConfiguration(empty))
    ).toEqual(empty);
  });

  it('rejects invalid channel references and format versions instead of losing a binding', () => {
    const packed = packWorkflowTextModelRouting([mockRoute()]);
    expect(() =>
      unpackWorkflowTextModelRouting({ ...packed, channels: [] })
    ).toThrow('Invalid workflow text model routing snapshot');
    const future = { ...packed, version: 2 };
    expect(() => unpackWorkflowTextModelRouting(future)).toThrow(
      'Invalid workflow text model routing snapshot'
    );
    expect(() => resolveTextModelRoute([], 'custom:missing')).toThrow(
      'unavailable'
    );
  });
});

describe('workflow snapshot size boundaries', () => {
  it('rejects paths which exceed the URL limit only after percent encoding', () => {
    const raw =
      'https://mock.invalid/' + '模'.repeat(TEXT_CHANNEL_LIMITS.baseUrl / 2);
    expect(raw.length).toBeLessThan(TEXT_CHANNEL_LIMITS.baseUrl);
    expect(new URL(raw).toString().length).toBeGreaterThan(
      TEXT_CHANNEL_LIMITS.baseUrl
    );
    expect(textChannelBaseUrlSchema.safeParse(raw).success).toBe(false);
  });

  it.each(['模', '\ud800'])(
    'bounds 100 distinct maximal channels with upstream character %j',
    (upstreamCharacter) => {
      const configuration = maximalConfiguration(upstreamCharacter);
      expect(configuration.channels).toHaveLength(TEXT_CHANNEL_LIMITS.channels);
      expect(
        new Set(configuration.channels.map((channel) => channel.baseUrl)).size
      ).toBe(TEXT_CHANNEL_LIMITS.channels);
      for (const channel of configuration.channels) {
        expect(channel.userAgent).toHaveLength(TEXT_CHANNEL_LIMITS.userAgent);
        expect(new TextEncoder().encode(channel.baseUrl).byteLength).toBe(
          TEXT_CHANNEL_LIMITS.baseUrl
        );
        expect(textChannelBaseUrlSchema.parse(channel.baseUrl)).toBe(
          channel.baseUrl
        );
      }
      const routing = createTextModelRoutingSnapshot(configuration);
      const wire = packModelRuntimeConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: routing,
      });
      expect(serializedBytes(routing)).toBeGreaterThan(ONE_MIB);
      expect(serializedBytes(wire)).toBeLessThan(SNAPSHOT_SIZE_BUDGET);
      expect(unpackModelRuntimeConfiguration(wire).textModelRouting).toEqual(
        routing.map(executionFields)
      );
    }
  );
});
