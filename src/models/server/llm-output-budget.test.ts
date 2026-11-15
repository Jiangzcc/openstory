import { describe, expect, it } from 'vitest';
import type { TextModelRoute } from '@/models/text-channels';
import { getLlmMaxOutputTokens } from './llm-output-budget';

// Synthetic saved routes and keys; no provider or credential lookup runs.
const route: TextModelRoute = {
  modelId: 'custom:mock-budget',
  name: 'Mock budget route',
  channelId: 'mock-channel',
  credentialId: 'mock-credential',
  upstreamModel: 'mock-deployment',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://mock.invalid/v1',
  vision: false,
  structuredOutput: true,
  tools: false,
  contextWindow: 1_001,
  maxOutputTokens: 900,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
};

describe('resolved LLM output budget', () => {
  it.each(['custom:mock-budget', 'anthropic/claude-sonnet-5.5'] as const)(
    'uses the matched compatible route for %s',
    (modelId) => {
      const saved = { ...route, modelId };
      expect(
        getLlmMaxOutputTokens(
          modelId,
          { via: 'compatible', key: 'mock-key', route: saved },
          0.65
        )
      ).toBe(650);
    }
  );

  it.each([
    { model: 'custom:other-budget', expected: 32_000 },
    { model: 'some/unlisted-model', expected: 32_000 },
    { model: 'deepseek/deepseek-v3.2', expected: 81_920 },
  ])(
    'retains the static fallback when route and $model differ',
    ({ model, expected }) => {
      expect(
        getLlmMaxOutputTokens(
          model,
          { via: 'compatible', key: 'mock-key', route },
          0.5
        )
      ).toBe(expected);
    }
  );

  it.each(['openrouter', 'fal', 'xai', 'google', 'llmtr'] as const)(
    'keeps the original static budget for a %s key',
    (via) => {
      expect(
        getLlmMaxOutputTokens(
          'deepseek/deepseek-v3.2',
          { via, key: 'mock-key' },
          0.1
        )
      ).toBe(16_384);
    }
  );

  it('keeps the route context ceiling for the whole-window shot budget', () => {
    expect(
      getLlmMaxOutputTokens(
        route.modelId,
        {
          via: 'compatible',
          key: 'mock-key',
          route: { ...route, contextWindow: 500, maxOutputTokens: 2_000 },
        },
        1
      )
    ).toBe(500);
  });
});
