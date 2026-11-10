import { expect, it } from 'vitest';
import type { TokenUsage } from '@tanstack/ai';
import type { TextModelRoute } from '@/models/text-channels';
import { configuredTextCostUsd } from './configured-text-cost';

// Synthetic USD rates and usage only; no provider or credential access.
const route: TextModelRoute = {
  modelId: 'custom:mock-text',
  name: 'Synthetic text model',
  channelId: 'mock-channel',
  upstreamModel: 'mock-upstream',
  credentialId: '01K00000000000000000000000',
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
const usage: TokenUsage = {
  promptTokens: 1_000,
  completionTokens: 200,
  totalTokens: 1_200,
};
const EXPECTED_USD = 0.0008;
const invalidCounts = [Number.NaN, Infinity, -Infinity, -1];

it('uses configured USD rates independently of gateway cost and total-token metadata', () => {
  expect(
    configuredTextCostUsd(
      { ...usage, cost: 999, totalTokens: Number.NaN },
      route
    )
  ).toBe(EXPECTED_USD);
  expect(configuredTextCostUsd(undefined, route)).toBeUndefined();
});

it.each(invalidCounts)('rejects invalid prompt tokens %s', (promptTokens) => {
  expect(
    configuredTextCostUsd({ ...usage, promptTokens }, route)
  ).toBeUndefined();
});

it.each(invalidCounts)(
  'rejects invalid completion tokens %s',
  (completionTokens) => {
    expect(
      configuredTextCostUsd({ ...usage, completionTokens }, route)
    ).toBeUndefined();
  }
);

it.each(['promptTokens', 'completionTokens'] as const)(
  'rejects a missing provider field %s',
  (field) => {
    const malformedUsage = { ...usage };
    Reflect.deleteProperty(malformedUsage, field);
    expect(configuredTextCostUsd(malformedUsage, route)).toBeUndefined();
  }
);

it('preserves zero usage, explicit free rates and individual token-side charges', () => {
  expect(
    configuredTextCostUsd(
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      route
    )
  ).toBe(0);
  expect(
    configuredTextCostUsd(usage, {
      ...route,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    })
  ).toBe(0);
  expect(
    configuredTextCostUsd(usage, { ...route, inputPricePerMillion: 0 })
  ).toBe(0.0003);
  expect(
    configuredTextCostUsd(usage, { ...route, outputPricePerMillion: 0 })
  ).toBe(0.0005);
});

it('retains fractional counts and sub-microdollar precision until the wallet boundary', () => {
  expect(
    configuredTextCostUsd(
      { promptTokens: 1.5, completionTokens: 0.5, totalTokens: 2 },
      route
    )
  ).toBe(0.0000015);
  expect(
    configuredTextCostUsd(
      { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
      route
    )
  ).toBe(0.0000005);
});
