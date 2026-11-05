import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_CONFIGURATION,
  MODEL_CONFIGURATION_FIELDS,
  getModelConfigurationOptions,
  modelConfigurationSchema,
  resolveModelConfiguration,
} from './model-configuration';

describe('model configuration (1)', () => {
  it('preserves the existing recommendations and internal models before configuration', () => {
    expect(resolveModelConfiguration(null)).toEqual(
      DEFAULT_MODEL_CONFIGURATION
    );
    expect(modelConfigurationSchema.parse(DEFAULT_MODEL_CONFIGURATION)).toEqual(
      DEFAULT_MODEL_CONFIGURATION
    );
  });

  it('allows independent overrides without changing creative recommendations', () => {
    const resolved = resolveModelConfiguration({
      sceneSplit: 'google/gemini-3.8-flash',
    });
    expect(resolved.sceneSplit).toBe('google/gemini-3.8-flash');
    expect(resolved.turboAnalysis).toBe(
      DEFAULT_MODEL_CONFIGURATION.turboAnalysis
    );
    expect(resolved.poster).toBe(DEFAULT_MODEL_CONFIGURATION.poster);
  });

  it('rejects text-only models for image understanding', () => {
    expect(() =>
      resolveModelConfiguration({ vision: 'deepseek/deepseek-v4-pro-0813' })
    ).toThrow();
    const options = getModelConfigurationOptions('vision');
    expect(
      options.some((option) => option.value === 'google/gemini-3.8-flash')
    ).toBe(true);
  });

  it('limits native video understanding to existing Google adapters', () => {
    expect(() =>
      resolveModelConfiguration({ watchClip: 'anthropic/claude-sonnet-5.5' })
    ).toThrow();
    expect(() =>
      resolveModelConfiguration({ talentVideo: 'google/gemini-3.8-flash' })
    ).not.toThrow();
  });
});

describe('model configuration (2)', () => {
  it('rejects a wrong media family, arbitrary ids, and unknown settings', () => {
    expect(() =>
      resolveModelConfiguration({ poster: 'seedance_v2_5' })
    ).toThrow();
    expect(() =>
      resolveModelConfiguration({ defaultAnalysis: 'unintegrated/model' })
    ).toThrow();
    expect(() =>
      resolveModelConfiguration({ supplierKey: 'a-secret' })
    ).toThrow();
  });

  it('offers every stored fallback and covers every configured field', () => {
    expect(MODEL_CONFIGURATION_FIELDS).toHaveLength(
      Object.keys(DEFAULT_MODEL_CONFIGURATION).length
    );
    for (const field of MODEL_CONFIGURATION_FIELDS) {
      expect(
        getModelConfigurationOptions(field.key).some(
          (option) => option.value === DEFAULT_MODEL_CONFIGURATION[field.key]
        )
      ).toBe(true);
    }
  });
});
