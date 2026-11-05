import { beforeEach, expect, it, vi } from 'vitest';
import {
  markGoogleRegionBlocked,
  resetGoogleRegionBlock,
} from '@/models/google-region';
import type { TextModelId, TextModelRoute } from '@/models/text-channels';
import type { ResolvedLlmKey } from './db/api-keys';
import type { OrganizationLlmKeyLookup } from './llm-key-routing';

type TeamProvider = Exclude<ResolvedLlmKey['via'], 'compatible'>;
const env = {
  OPENROUTER_KEY: 'mock-platform-openrouter',
  XAI_API_KEY: 'mock-platform-xai',
  GEMINI_API_KEY: 'mock-platform-google',
};
vi.doMock('#env', () => ({ getEnv: () => env }));
const { resolveLlmKeyForModel } = await import('./llm-key-routing');

function mockRoute(
  modelId: TextModelId = 'openai/gpt-5.4-mini'
): TextModelRoute {
  return {
    modelId,
    channelId: 'mock-channel',
    credentialId: 'mock-channel-credential',
    name: 'Mock bound model',
    upstreamModel: 'mock-upstream',
    baseUrl: 'https://mock.invalid/v1',
    protocol: 'openai-responses',
    vision: true,
    structuredOutput: true,
    tools: true,
    contextWindow: 16_000,
    maxOutputTokens: 4_000,
    inputPricePerMillion: 1,
    outputPricePerMillion: 2,
  };
}

function credentials(
  keys: Partial<Record<TeamProvider, OrganizationLlmKeyLookup>> = {}
) {
  return {
    organizationKey: vi.fn(
      async (provider: TeamProvider): Promise<OrganizationLlmKeyLookup> =>
        keys[provider] ?? {}
    ),
    channelSecret: vi.fn(async () => 'mock-channel-secret'),
  };
}

beforeEach(() => resetGoogleRegionBlock());

it.each(['fal', 'openrouter'] as const)(
  'prefers a usable team %s key over a builtin platform binding',
  async (via) => {
    const c = credentials({ [via]: { key: 'mock-team-secret' } });
    c.channelSecret.mockRejectedValue(new Error('Mock unavailable channel'));
    const route = mockRoute();
    expect(await resolveLlmKeyForModel(route.modelId, [route], c)).toEqual({
      key: 'mock-team-secret',
      source: 'organization',
      via,
    });
    expect(c.channelSecret).not.toHaveBeenCalled();
  }
);

it.each([
  { model: 'google/gemini-3.8-flash', via: 'google' },
  { model: 'x-ai/grok-4.7', via: 'xai' },
  { model: 'z-ai/glm-5.3-flash', via: 'llmtr' },
] satisfies { model: TextModelId; via: TeamProvider }[])(
  'preserves the applicable team $via preference for $model',
  async ({ model, via }) => {
    const c = credentials({
      [via]: { key: 'mock-native-team' },
      openrouter: { key: 'mock-team-or' },
    });
    expect(
      await resolveLlmKeyForModel(model, [mockRoute(model)], c)
    ).toMatchObject({ key: 'mock-native-team', source: 'organization', via });
    expect(c.channelSecret).not.toHaveBeenCalled();
  }
);

it.each(['google/gemini-3.8-flash', 'x-ai/grok-4.7'])(
  'does not let a platform native key preempt team OpenRouter for %s',
  async (model) => {
    const c = credentials({ openrouter: { key: 'mock-team-or' } });
    expect(await resolveLlmKeyForModel(model, [], c)).toMatchObject({
      key: 'mock-team-or',
      source: 'organization',
      via: 'openrouter',
    });
  }
);

it('uses the configured platform route when no usable team key covers the builtin model', async () => {
  const c = credentials({
    openrouter: { skippedReason: 'Mock invalid OpenRouter key' },
    fal: { skippedReason: 'Mock undecryptable fal key' },
  });
  const route = mockRoute();
  expect(await resolveLlmKeyForModel(route.modelId, [route], c)).toEqual({
    key: 'mock-channel-secret',
    source: 'platform',
    via: 'compatible',
    route,
  });
});

it('keeps unrelated native and unmapped LLMTR keys from covering a builtin model', async () => {
  const c = credentials({
    xai: { key: 'mock-team-xai' },
    google: { key: 'mock-team-google' },
    llmtr: { key: 'mock-team-llmtr' },
  });
  const route = mockRoute('anthropic/claude-sonnet-5.5');
  expect(await resolveLlmKeyForModel(route.modelId, [route], c)).toMatchObject({
    source: 'platform',
    via: 'compatible',
  });
  expect(c.organizationKey.mock.calls.map(([provider]) => provider)).toEqual([
    'openrouter',
    'fal',
  ]);
});

it('keeps custom identifiers on their administrator route without consulting team keys', async () => {
  const route = mockRoute('custom:mock-exclusive');
  const c = credentials();
  expect(await resolveLlmKeyForModel(route.modelId, [route], c)).toMatchObject({
    source: 'platform',
    via: 'compatible',
    route,
  });
  expect(c.organizationKey).not.toHaveBeenCalled();
});

it('rejects an unavailable custom model without using any other provider', async () => {
  const c = credentials();
  await expect(
    resolveLlmKeyForModel('custom:mock-missing', [], c)
  ).rejects.toThrow('unavailable');
  expect(c.organizationKey).not.toHaveBeenCalled();
  expect(c.channelSecret).not.toHaveBeenCalled();
});

it('propagates a selected platform channel credential failure', async () => {
  const route = mockRoute();
  const c = credentials();
  c.channelSecret.mockRejectedValue(
    new Error('Mock channel credential unavailable')
  );
  await expect(
    resolveLlmKeyForModel(route.modelId, [route], c)
  ).rejects.toThrow('Mock channel credential unavailable');
});

it('retains platform native fallbacks after team choices are exhausted', async () => {
  const c = credentials();
  expect(
    await resolveLlmKeyForModel('google/gemini-3.8-flash', [], c)
  ).toMatchObject({
    key: 'mock-platform-google',
    source: 'platform',
    via: 'google',
  });
});

it('skips native Google for a region-blocked isolate while retaining its team gateway', async () => {
  markGoogleRegionBlocked(
    'Mock Google request',
    new Error('Mock region refusal')
  );
  const c = credentials({
    google: { key: 'mock-team-google' },
    fal: { key: 'mock-team-fal' },
  });
  expect(
    await resolveLlmKeyForModel('google/gemini-3.8-flash', [], c)
  ).toMatchObject({ key: 'mock-team-fal', source: 'organization', via: 'fal' });
  expect(c.organizationKey).not.toHaveBeenCalledWith('google');
});

it('preserves invalid-key diagnostics on an unbound platform fallback', async () => {
  const c = credentials({ openrouter: { skippedReason: 'Mock revoked key' } });
  expect(
    await resolveLlmKeyForModel('openai/gpt-5.4-mini', [], c)
  ).toMatchObject({
    source: 'platform',
    via: 'openrouter',
    fallbackReason: 'Mock revoked key',
  });
});
