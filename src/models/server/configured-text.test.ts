import { configuredTextCostUsd } from '@/billing/configured-text-cost';
import { describe, expect, it } from 'vitest';
import {
  assertConfiguredTextTestHost,
  configuredTextApi,
  assertConfiguredTextCapabilities,
  configuredTextModelOptions,
  configuredTextUsage,
} from './configured-text';
import type { TextModelRoute } from '../text-channels';

const route: TextModelRoute = {
  modelId: 'custom:mock-model',
  name: 'Mock text model',
  channelId: 'mock-channel',
  upstreamModel: 'mock-upstream',
  credentialId: 'mock-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://mock.invalid/v1',
  vision: false,
  structuredOutput: true,
  tools: false,
  contextWindow: 8_000,
  maxOutputTokens: 2_000,
  inputPricePerMillion: 0.5,
  outputPricePerMillion: 1.5,
};
const key = { via: 'compatible' as const, key: 'mock-test-key', route };
const usage = {
  promptTokens: 1_000,
  completionTokens: 200,
  totalTokens: 1_200,
};

describe('configured text route contract', () => {
  it('blocks real provider endpoints during E2E generation', () => {
    expect(() =>
      assertConfiguredTextTestHost('https://provider.example/v1', 'true')
    ).toThrow('mock');
    expect(() =>
      assertConfiguredTextTestHost('https://mock.invalid/v1', 'true')
    ).not.toThrow();
    expect(() =>
      assertConfiguredTextTestHost('http://localhost:4010/v1', 'true')
    ).not.toThrow();
    expect(() =>
      assertConfiguredTextTestHost('https://provider.example/v1')
    ).not.toThrow();
  });
  it('clamps token budgets to the configured deployment ceiling', () => {
    expect(configuredTextModelOptions(route, { max_tokens: 100_000 })).toEqual({
      max_tokens: 2_000,
      stream_options: { include_usage: true },
    });
    expect(
      configuredTextModelOptions(route, { max_tokens: 100 })
    ).toMatchObject({ max_tokens: 100 });
  });
  it('uses compatible parameter names without native provider knobs', () => {
    expect(
      configuredTextModelOptions(route, { temperature: 0, top_p: 0.5 })
    ).toEqual({
      max_tokens: 2_000,
      stream_options: { include_usage: true },
      temperature: 0,
      top_p: 0.5,
    });
  });
  it('rejects an unsupported capability before a provider call', () => {
    expect(() =>
      assertConfiguredTextCapabilities(key, { vision: true })
    ).toThrow('vision');
    expect(() =>
      assertConfiguredTextCapabilities(key, { tools: true })
    ).toThrow('tools');
    expect(() =>
      assertConfiguredTextCapabilities(key, { structuredOutput: true })
    ).not.toThrow();
  });
});

describe('configured text cost estimates', () => {
  it('computes costs from channel rates and token counts', () => {
    expect(configuredTextCostUsd(usage, route)).toBeCloseTo(0.0008);
    expect(configuredTextCostUsd(undefined, route)).toBeUndefined();
  });
  it('replaces ambiguous gateway cost metadata with configured USD costs', () => {
    const providerUsage = { ...usage, cost: 999 };
    expect(configuredTextUsage(providerUsage, key)).toEqual({
      ...usage,
      cost: 0.0008,
    });
    expect(
      configuredTextUsage(providerUsage, { via: 'openrouter', key: 'mock' })
    ).toBe(providerUsage);
  });
  it('discards ambiguous costs when token counts are invalid', () => {
    const invalidUsage = { ...usage, promptTokens: Number.NaN, cost: 999 };
    expect(configuredTextUsage(invalidUsage, key)?.cost).toBeUndefined();
  });
  it('retains an explicitly configured zero rate', () => {
    expect(
      configuredTextCostUsd(usage, {
        ...route,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      })
    ).toBe(0);
  });
});

it('maps each saved protocol to the matching compatible SDK API', () => {
  expect(configuredTextApi('openai-chat-completions')).toBe('chat-completions');
  expect(configuredTextApi('openai-responses')).toBe('responses');
});

it('sends Responses token and sampling options without Chat-only fields', () => {
  expect(
    configuredTextModelOptions(
      { ...route, protocol: 'openai-responses' },
      {
        max_tokens: 100_000,
        temperature: 0,
        top_p: 0.5,
        frequency_penalty: 1,
        presence_penalty: 1,
      }
    )
  ).toEqual({ max_output_tokens: 2_000, temperature: 0, top_p: 0.5 });
});

it('applies the same default and context ceilings to Responses output', () => {
  const responsesRoute = { ...route, protocol: 'openai-responses' as const };
  expect(configuredTextModelOptions(responsesRoute)).toEqual({
    max_output_tokens: 2_000,
  });
  expect(
    configuredTextModelOptions(responsesRoute, { max_tokens: 100 })
  ).toEqual({ max_output_tokens: 100 });
  expect(
    configuredTextModelOptions(
      { ...responsesRoute, contextWindow: 500 },
      { max_tokens: 5_000 }
    )
  ).toEqual({ max_output_tokens: 500 });
});
