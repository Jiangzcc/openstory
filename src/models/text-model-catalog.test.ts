import { describe, expect, it } from 'vitest';
import { SCRIPT_ANALYSIS_MODELS, storedAnalysisModelId } from './models.config';
import { mergeTextModelCatalog } from './text-model-catalog';
import type { TextModelCatalogEntry } from './text-channels';

const custom: TextModelCatalogEntry = {
  id: 'custom:mock-model',
  name: 'Mock model',
  vision: true,
  structuredOutput: true,
  tools: false,
  contextWindow: 16_000,
  maxOutputTokens: 1_000,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
};

describe('incremental text model catalog', () => {
  it('adds configured models without changing the built-in registry', () => {
    const original = SCRIPT_ANALYSIS_MODELS.length;
    const merged = mergeTextModelCatalog([custom]);
    expect(merged).toHaveLength(original + 1);
    expect(merged.at(-1)).toMatchObject({
      id: custom.id,
      name: custom.name,
      vision: true,
    });
    expect(SCRIPT_ANALYSIS_MODELS).toHaveLength(original);
    expect(mergeTextModelCatalog()).toHaveLength(original);
  });
  it('overrides deployment limits while retaining built-in ranking and retirement', () => {
    const retired = SCRIPT_ANALYSIS_MODELS.find(
      (model) => 'hidden' in model && model.hidden
    );
    if (!retired) throw new Error('Expected a retired built-in model fixture.');
    const merged = mergeTextModelCatalog([{ ...custom, id: retired.id }]);
    expect(merged.find((model) => model.id === retired.id)).toMatchObject({
      maxOutputTokens: custom.maxOutputTokens,
      qualityRank: retired.qualityRank,
      hidden: true,
    });
  });
  it('preserves stored custom identity without inventing model metadata', () => {
    expect(storedAnalysisModelId('custom:unavailable')).toBe(
      'custom:unavailable'
    );
    expect(storedAnalysisModelId('unknown-model')).not.toBe('unknown-model');
  });
});
