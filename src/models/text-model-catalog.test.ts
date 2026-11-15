import { describe, expect, it } from 'vitest';
import { SCRIPT_ANALYSIS_MODELS, storedAnalysisModelId } from './models.config';
import {
  mergeTextModelCatalog,
  getTextModelDefinition,
  isKnownTextModelId,
  isSelectableTextModelId,
} from './text-model-catalog';
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

describe('configured catalog lookup and selection boundary', () => {
  it('looks up a custom identity only in the supplied catalog', () => {
    const catalog = mergeTextModelCatalog([custom]);
    expect(getTextModelDefinition(custom.id, catalog)).toMatchObject({
      id: custom.id,
      name: custom.name,
      maxOutputTokens: custom.maxOutputTokens,
    });
    expect(isKnownTextModelId(custom.id, catalog)).toBe(true);
    expect(isSelectableTextModelId(custom.id, catalog)).toBe(true);
    expect(getTextModelDefinition(custom.id)).toBeUndefined();
    expect(isKnownTextModelId('custom:missing', catalog)).toBe(false);
    expect(isSelectableTextModelId('custom:missing', catalog)).toBe(false);
  });

  it('keeps a retired built-in unavailable despite its configured limits', () => {
    const retired = SCRIPT_ANALYSIS_MODELS.find(
      (model) => 'hidden' in model && model.hidden
    );
    if (!retired) throw new Error('Missing retired built-in fixture');
    const catalog = mergeTextModelCatalog([{ ...custom, id: retired.id }]);
    expect(getTextModelDefinition(retired.id, catalog)).toMatchObject({
      hidden: true,
      maxOutputTokens: custom.maxOutputTokens,
    });
    expect(isKnownTextModelId(retired.id, catalog)).toBe(true);
    expect(isSelectableTextModelId(retired.id, catalog)).toBe(false);
  });

  it('keeps the first explicit overlay ahead of the static definition without changing later calls', () => {
    const builtin = SCRIPT_ANALYSIS_MODELS[0];
    const entries = mergeTextModelCatalog([{ ...custom, id: builtin.id }]);
    const override = getTextModelDefinition(builtin.id, entries);
    if (!override) throw new Error('Missing configured built-in fixture');
    expect(
      getTextModelDefinition(builtin.id, [
        override,
        { ...override, maxOutputTokens: 2 },
      ])
    ).toMatchObject({
      maxOutputTokens: custom.maxOutputTokens,
    });
    expect(getTextModelDefinition(builtin.id)?.maxOutputTokens).toBe(
      builtin.maxOutputTokens
    );
  });

  it.each([undefined, null, 7, {}, 'unknown-model'])(
    'rejects an unknown lookup or selection value %s',
    (value) => {
      const catalog = mergeTextModelCatalog([custom]);
      expect(isKnownTextModelId(value, catalog)).toBe(false);
      expect(isSelectableTextModelId(value, catalog)).toBe(false);
    }
  );
});
