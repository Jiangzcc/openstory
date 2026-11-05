import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS_MODEL } from '@/models/models.config';
import { REGION_FALLBACK_MODEL } from '@/models/region-policy';
import { chatModelFor } from './chat-model';
import type { TextModelRoute } from '@/models/text-channels';
import { textModelCatalogFromRouting } from '@/models/text-model-catalog';

const CUSTOM_ROUTE: TextModelRoute = {
  modelId: 'custom:request-model',
  name: 'Request model',
  channelId: 'test-channel',
  upstreamModel: 'upstream-model',
  credentialId: 'test-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://models.example/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};

describe('chatModelFor', () => {
  it('takes a selectable model, defaults with none, refuses anything else', () => {
    expect(chatModelFor('anthropic/claude-sonnet-5.5', undefined)).toBe(
      'anthropic/claude-sonnet-5.5'
    );
    expect(chatModelFor(undefined, undefined)).toBe(DEFAULT_ANALYSIS_MODEL);
    expect(() => chatModelFor('nope/model', undefined)).toThrow(
      'not one the assistant can run on'
    );
    expect(() => chatModelFor(null, undefined)).toThrow();
  });

  it('swaps a blocked vendor for the country, like a sequence does', () => {
    expect(chatModelFor('anthropic/claude-sonnet-5.5', 'CN')).toBe(
      REGION_FALLBACK_MODEL
    );
  });
});

describe('configured assistant models', () => {
  it('preserves a registered custom model and a configured custom default', () => {
    const catalog = textModelCatalogFromRouting([CUSTOM_ROUTE]);
    expect(chatModelFor(CUSTOM_ROUTE.modelId, 'CN', catalog)).toBe(
      CUSTOM_ROUTE.modelId
    );
    expect(chatModelFor(undefined, 'CN', catalog, CUSTOM_ROUTE.modelId)).toBe(
      CUSTOM_ROUTE.modelId
    );
  });

  it('refuses an unavailable custom model or default instead of substituting', () => {
    expect(() => chatModelFor(CUSTOM_ROUTE.modelId, 'CN')).toThrow(
      'not one the assistant can run on'
    );
    expect(() =>
      chatModelFor(undefined, 'CN', [], CUSTOM_ROUTE.modelId)
    ).toThrow();
  });

  it('requires tools on custom routes and overridden builtins', () => {
    for (const modelId of [CUSTOM_ROUTE.modelId, DEFAULT_ANALYSIS_MODEL]) {
      const catalog = textModelCatalogFromRouting([
        { ...CUSTOM_ROUTE, modelId, tools: false },
      ]);
      expect(() => chatModelFor(modelId, undefined, catalog)).toThrow(
        'must support tools'
      );
    }
  });

  it('uses a bound builtin route without applying native region substitution', () => {
    const catalog = textModelCatalogFromRouting([
      { ...CUSTOM_ROUTE, modelId: DEFAULT_ANALYSIS_MODEL },
    ]);
    expect(chatModelFor(DEFAULT_ANALYSIS_MODEL, 'CN', catalog)).toBe(
      DEFAULT_ANALYSIS_MODEL
    );
  });
});
