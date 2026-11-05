import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { parseConfiguredSequenceInput } from './configured-sequence-input';

const SCRIPT = 'INT. LIGHTHOUSE - NIGHT. A keeper lights a lamp.';

describe('configured creation defaults (1)', () => {
  it('uses platform recommendations when model fields are omitted', () => {
    const result = parseConfiguredSequenceInput(
      { script: SCRIPT, stopAt: 'script' },
      {
        ...DEFAULT_MODEL_CONFIGURATION,
        defaultAnalysis: 'google/gemini-3.8-flash',
        defaultImage: 'flux_2_turbo',
        defaultVideo: 'minimax_h3_max',
        defaultMusic: 'ace_step',
      }
    );
    expect(result.analysisModels).toEqual(['google/gemini-3.8-flash']);
    expect(result.imageModels).toEqual(['flux_2_turbo']);
    expect(result.videoModels).toEqual(['minimax_h3_max']);
    expect(result.musicModel).toBe('ace_step');
  });

  it('preserves explicit choices and still validates them', () => {
    const result = parseConfiguredSequenceInput(
      {
        script: SCRIPT,
        stopAt: 'script',
        analysisModels: ['anthropic/claude-sonnet-5.5'],
        imageModels: ['gpt_image_2'],
      },
      {
        ...DEFAULT_MODEL_CONFIGURATION,
        defaultAnalysis: 'google/gemini-3.8-flash',
        defaultImage: 'flux_2_turbo',
      }
    );
    expect(result.analysisModels).toEqual(['anthropic/claude-sonnet-5.5']);
    expect(result.imageModels).toEqual(['gpt_image_2']);
    expect(() =>
      parseConfiguredSequenceInput(
        { script: SCRIPT, analysisModels: ['unintegrated/model'] },
        DEFAULT_MODEL_CONFIGURATION
      )
    ).toThrow();
  });
});

describe('configured creation defaults (2)', () => {
  it('strips client-supplied internal model settings and refuses invalid nulls', () => {
    const result = parseConfiguredSequenceInput(
      {
        script: SCRIPT,
        stopAt: 'script',
        modelConfiguration: { sceneSplit: 'client/model' },
      },
      DEFAULT_MODEL_CONFIGURATION
    );
    expect(result).not.toHaveProperty('modelConfiguration');
    expect(() =>
      parseConfiguredSequenceInput(
        { script: SCRIPT, analysisModels: null },
        DEFAULT_MODEL_CONFIGURATION
      )
    ).toThrow();
  });
});
