import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  parseStudioComposerPrefs,
  resolveStudioComposerModels,
} from './composer-prefs';

describe('parseStudioComposerPrefs', () => {
  it('keeps a draft-off choice', () => {
    expect(parseStudioComposerPrefs({ draft: false })).toEqual({
      draft: false,
    });
  });

  it('keeps every valid field', () => {
    const prefs = {
      aspectRatio: '9:16',
      resolution: '1080p',
      count: 2,
      duration: 'auto',
      generateAudio: false,
      draft: true,
    };
    expect(parseStudioComposerPrefs(prefs)).toEqual(prefs);
  });

  it('drops only the fields that no longer parse', () => {
    expect(
      parseStudioComposerPrefs({
        videoModel: 'retired_model',
        imageModel: 42,
        aspectRatio: '4:3',
        count: 3,
        duration: -1,
        draft: false,
      })
    ).toEqual({ draft: false });
  });

  it('treats junk as no saved settings', () => {
    expect(parseStudioComposerPrefs(null)).toEqual({});
    expect(parseStudioComposerPrefs('draft')).toEqual({});
    expect(parseStudioComposerPrefs([1])).toEqual({});
  });
});

describe('Studio model recommendations', () => {
  const configured = {
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultImage: 'flux_2_flash' as const,
    defaultVideo: 'minimax_h3_max' as const,
  };

  it('uses administrator defaults rather than the old BytePlus recommendation', () => {
    expect(
      resolveStudioComposerModels({}, configured, '16:9', { byteplus: true })
    ).toEqual({
      imageModel: 'flux_2_flash',
      videoModel: 'minimax_h3_max',
    });
  });

  it('follows a subsequent administrator edit when no model was chosen', () => {
    const prefs = parseStudioComposerPrefs({
      aspectRatio: '9:16',
      draft: false,
    });
    const next = {
      ...configured,
      defaultImage: 'nano_banana_2_lite' as const,
      defaultVideo: 'seedance_v2' as const,
    };
    expect(
      resolveStudioComposerModels(prefs, next, '9:16', {}).imageModel
    ).toBe(next.defaultImage);
    expect(
      resolveStudioComposerModels(prefs, next, '9:16', {}).videoModel
    ).toBe(next.defaultVideo);
    expect(prefs).not.toHaveProperty('imageModel');
    expect(prefs).not.toHaveProperty('videoModel');
  });

  it('retains legacy explicit models across administrator changes', () => {
    const prefs = parseStudioComposerPrefs({
      imageModel: 'gpt_image_2',
      videoModel: 'seedance_v2_5',
    });
    expect(
      resolveStudioComposerModels(prefs, configured, '16:9', { byteplus: true })
    ).toEqual({
      imageModel: 'gpt_image_2',
      videoModel: 'seedance_v2_5',
    });
  });

  it('temporarily falls back for an unavailable via without overwriting the stored pick', () => {
    const prefs = parseStudioComposerPrefs({ videoModel: 'seedance_v2_5' });
    expect(
      resolveStudioComposerModels(prefs, configured, '16:9', {}).videoModel
    ).toBe('minimax_h3_max');
    expect(prefs.videoModel).toBe('seedance_v2_5');
  });
});

describe('Studio configured image model preferences', () => {
  it('retains a stable configured identity without saving channel credentials or parameters', () => {
    expect(
      parseStudioComposerPrefs({
        imageModel: 'custom-image:qwen-image',
        aspectRatio: '1:1',
        channelParameters: { n: 4 },
        apiKey: 'synthetic-not-a-key',
      })
    ).toEqual({ imageModel: 'custom-image:qwen-image', aspectRatio: '1:1' });
  });

  it('keeps an explicit historical configured identity for the dynamic availability guard', () => {
    const prefs = parseStudioComposerPrefs({
      imageModel: 'custom-image:disabled-history',
    });
    expect(
      resolveStudioComposerModels(
        prefs,
        DEFAULT_MODEL_CONFIGURATION,
        '16:9',
        {}
      ).imageModel
    ).toBe('custom-image:disabled-history');
  });
});
