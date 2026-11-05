import { describe, expect, it } from 'vitest';
import {
  AUDIO_MODELS,
  IMAGE_MODELS,
  IMAGE_TO_VIDEO_MODELS,
  isValidAudioModel,
  isValidImageToVideoModel,
  isValidTextToImageModel,
} from './models';
import { isSelectableAnalysisModelId } from './models.config';
import {
  applyGenerationMode,
  compareSelectorModels,
  DEFAULT_GENERATION_MODE,
  defaultAnalysisModel,
  defaultAudioModel,
  availableDefaultVideoModel,
  defaultImageModel,
  defaultVideoModel,
  isTurboImageModel,
  isTurboVideoModel,
  styleMayApplyImage,
  styleMayApplyVideo,
  QUALITY_DEFAULT_ANALYSIS,
  QUALITY_DEFAULT_IMAGE,
  QUALITY_DEFAULT_VIDEO,
  selectorGroup,
  TURBO_ANALYSIS_MODELS,
  isTurboAnalysisModel,
  TURBO_AUDIO_MODELS,
  TURBO_DEFAULT_ANALYSIS,
  TURBO_DEFAULT_AUDIO,
  TURBO_DEFAULT_IMAGE,
  TURBO_DEFAULT_VIDEO,
  TURBO_IMAGE_MODELS,
  TURBO_VIDEO_MODELS,
} from './generation-mode';

import { DEFAULT_MODEL_CONFIGURATION } from './model-configuration';

const baseSettings = {
  generationMode: 'quality' as const,
  analysisModels: ['openai/gpt-6-astra' as const],
  imageModels: ['gpt_image_2' as const],
  videoModels: ['seedance_v2' as const],
  audioModels: ['elevenlabs_music' as const],
  aspectRatio: '16:9' as const,
};

describe('applyGenerationMode', () => {
  it('snaps every catalog to turbo defaults when entering turbo', () => {
    const next = applyGenerationMode(baseSettings, 'turbo');
    expect(next.generationMode).toBe('turbo');
    expect(next.analysisModels).toEqual([TURBO_DEFAULT_ANALYSIS]);
    expect(next.imageModels).toEqual([TURBO_DEFAULT_IMAGE]);
    expect(next.videoModels).toEqual([TURBO_DEFAULT_VIDEO]);
    expect(next.audioModels).toEqual([TURBO_DEFAULT_AUDIO]);
  });

  it('snaps to quality defaults when entering quality', () => {
    const next = applyGenerationMode(
      { ...baseSettings, generationMode: 'turbo' },
      'quality'
    );
    expect(next.analysisModels).toEqual([QUALITY_DEFAULT_ANALYSIS]);
    expect(next.imageModels).toEqual([QUALITY_DEFAULT_IMAGE]);
    expect(next.videoModels).toEqual([QUALITY_DEFAULT_VIDEO]);
  });

  it('keeps a quality pick while staying in turbo', () => {
    const next = applyGenerationMode(
      {
        ...baseSettings,
        generationMode: 'turbo',
        imageModels: ['gpt_image_2'],
        videoModels: ['seedance_v2'],
      },
      'turbo'
    );
    expect(next.imageModels).toEqual(['gpt_image_2']);
    expect(next.videoModels).toEqual(['seedance_v2']);
  });
});

describe('mode defaults', () => {
  it('turbo defaults are Lite / H3 Max / Sonnet 5.5', () => {
    expect(defaultAnalysisModel('turbo')).toBe(TURBO_DEFAULT_ANALYSIS);
    expect(defaultImageModel('turbo')).toBe(TURBO_DEFAULT_IMAGE);
    expect(defaultVideoModel('turbo', '16:9')).toBe(TURBO_DEFAULT_VIDEO);
    expect(TURBO_DEFAULT_IMAGE).toBe('nano_banana_2_lite');
    expect(TURBO_DEFAULT_VIDEO).toBe('minimax_h3_max');
    expect(TURBO_DEFAULT_ANALYSIS).toBe('anthropic/claude-sonnet-5.5');
  });

  it('quality defaults are Gemini 4 Argon / GPT Image 2 / Seedance 2.5', () => {
    expect(defaultAnalysisModel('quality')).toBe('google/gemini-4-argon');
    expect(isTurboAnalysisModel('google/gemini-4-argon')).toBe(false);
    expect(defaultImageModel('quality')).toBe('gpt_image_2');
    expect(defaultVideoModel('quality', '16:9')).toBe('seedance_v2_5');
    expect(QUALITY_DEFAULT_VIDEO).toBe('seedance_v2_5');
  });
});

describe('selector grouping', () => {
  it('puts Lite in Fast and GPT Image 2 in Quality', () => {
    expect(selectorGroup('nano_banana_2_lite', TURBO_IMAGE_MODELS)).toBe(
      'fast'
    );
    expect(selectorGroup('gpt_image_2', TURBO_IMAGE_MODELS)).toBe('quality');
  });

  it('orders Fast by turbo list, then Quality with the default first', () => {
    const ids = [
      'gpt_image_2',
      'flux_2_flash',
      'nano_banana_2_lite',
      'seedream_v5',
    ];
    ids.sort((a, b) =>
      compareSelectorModels(
        a,
        b,
        TURBO_IMAGE_MODELS,
        QUALITY_DEFAULT_IMAGE,
        (id) =>
          isValidTextToImageModel(id) ? IMAGE_MODELS[id].qualityRank : 99
      )
    );
    expect(ids[0]).toBe('nano_banana_2_lite');
    expect(ids[1]).toBe('flux_2_flash');
    expect(ids[2]).toBe('gpt_image_2');
  });

  it('puts Seedance 2.5 then 2.0 in Quality, and Mini last in Fast', () => {
    const ids = [
      'seedance_v2_mini',
      'kling_v3_pro',
      'seedance_v2',
      'gemini_omni_flash',
      'seedance_v2_5',
      'grok_imagine_video_1_5',
      'minimax_h3_max',
    ];
    ids.sort((a, b) =>
      compareSelectorModels(
        a,
        b,
        TURBO_VIDEO_MODELS,
        QUALITY_DEFAULT_VIDEO,
        (id) =>
          isValidImageToVideoModel(id)
            ? IMAGE_TO_VIDEO_MODELS[id].qualityRank
            : 99
      )
    );
    expect(ids).toEqual([
      'minimax_h3_max',
      'grok_imagine_video_1_5',
      'seedance_v2_mini',
      'seedance_v2_5',
      'seedance_v2',
      'gemini_omni_flash',
      'kling_v3_pro',
    ]);
  });
});

describe('styleMayApplyImage / styleMayApplyVideo', () => {
  it('lets Quality apply any catalog model', () => {
    expect(styleMayApplyImage('quality', 'gpt_image_2')).toBe(true);
    expect(styleMayApplyVideo('quality', 'seedance_v2')).toBe(true);
  });

  it('blocks Turbo from applying a Quality-only rec', () => {
    expect(styleMayApplyImage('turbo', 'gpt_image_2')).toBe(false);
    expect(styleMayApplyImage('turbo', 'grok_imagine_image')).toBe(false);
    expect(styleMayApplyVideo('turbo', 'seedance_v2')).toBe(false);
  });

  it('allows Turbo to apply a Fast rec', () => {
    expect(styleMayApplyImage('turbo', 'nano_banana_2_lite')).toBe(true);
    expect(styleMayApplyVideo('turbo', 'minimax_h3_max')).toBe(true);
    expect(styleMayApplyVideo('turbo', 'seedance_v2_mini')).toBe(true);
  });
});

describe('isTurboAnalysisModel / isTurboImageModel / isTurboVideoModel', () => {
  it('flags Lite and H3 Max, not GPT Image 2 or Seedance 2.0', () => {
    expect(isTurboImageModel('nano_banana_2_lite')).toBe(true);
    expect(isTurboImageModel('gpt_image_2')).toBe(false);
    expect(isTurboVideoModel('minimax_h3_max')).toBe(true);
    expect(isTurboVideoModel('seedance_v2_mini')).toBe(true);
    expect(isTurboVideoModel('seedance_v2')).toBe(false);
    expect(isTurboVideoModel('seedance_v2_5')).toBe(false);
  });

  it('flags Luna, not Fable or Astra', () => {
    expect(isTurboAnalysisModel('openai/gpt-6-luna')).toBe(true);
    expect(isTurboAnalysisModel('anthropic/claude-fable-5.1')).toBe(false);
    expect(isTurboAnalysisModel('openai/gpt-6-astra')).toBe(false);
    expect(isSelectableAnalysisModelId('openai/gpt-6-astra')).toBe(true);
  });
});

describe('DEFAULT_GENERATION_MODE', () => {
  it('is turbo', () => {
    expect(DEFAULT_GENERATION_MODE).toBe('turbo');
  });
});

describe('turbo catalogs', () => {
  it('only list live, selectable models', () => {
    for (const id of TURBO_ANALYSIS_MODELS) {
      expect(isSelectableAnalysisModelId(id)).toBe(true);
    }
    for (const id of TURBO_IMAGE_MODELS) {
      expect(isValidTextToImageModel(id)).toBe(true);
      expect('hidden' in IMAGE_MODELS[id]).toBe(false);
    }
    for (const id of TURBO_VIDEO_MODELS) {
      expect(isValidImageToVideoModel(id)).toBe(true);
      expect('hidden' in IMAGE_TO_VIDEO_MODELS[id]).toBe(false);
    }
    for (const id of TURBO_AUDIO_MODELS) {
      expect(isValidAudioModel(id)).toBe(true);
      expect(AUDIO_MODELS[id].type).toBe('music');
    }
  });
});

describe('administrator mode recommendations', () => {
  const configured = {
    ...DEFAULT_MODEL_CONFIGURATION,
    turboAnalysis: 'z-ai/glm-5.3-flash' as const,
    turboImage: 'flux_2_flash' as const,
    turboVideo: 'seedance_v2' as const,
    turboMusic: 'ace_step' as const,
    qualityAnalysis: 'anthropic/claude-sonnet-5.5' as const,
    qualityImage: 'nano_banana_2_lite' as const,
    qualityVideo: 'minimax_h3_max' as const,
    qualityMusic: 'ace_step_1_5' as const,
  };

  it('uses all configured recommendations on a mode switch', () => {
    expect(
      applyGenerationMode(baseSettings, 'turbo', configured)
    ).toMatchObject({
      analysisModels: [configured.turboAnalysis],
      imageModels: [configured.turboImage],
      videoModels: [configured.turboVideo],
      audioModels: [configured.turboMusic],
    });
    expect(
      applyGenerationMode(
        { ...baseSettings, generationMode: 'turbo' },
        'quality',
        configured
      )
    ).toMatchObject({
      analysisModels: [configured.qualityAnalysis],
      imageModels: [configured.qualityImage],
      videoModels: [configured.qualityVideo],
      audioModels: [configured.qualityMusic],
    });
  });

  it('keeps an explicit same-mode choice', () => {
    expect(applyGenerationMode(baseSettings, 'quality', configured)).toEqual(
      baseSettings
    );
    expect(defaultAnalysisModel('quality', configured)).toBe(
      configured.qualityAnalysis
    );
    expect(defaultImageModel('turbo', configured)).toBe(configured.turboImage);
    expect(defaultAudioModel('quality', configured)).toBe(
      configured.qualityMusic
    );
  });

  it('honors a configured video even when BytePlus is available', () => {
    expect(
      availableDefaultVideoModel('minimax_h3_max', 'seedance_v2', '16:9', {
        byteplus: true,
      })
    ).toBe('minimax_h3_max');
  });

  it('keeps provider and aspect compatibility fallbacks', () => {
    expect(
      availableDefaultVideoModel('seedance_v2_5', 'minimax_h3_max', '16:9', {})
    ).toBe('minimax_h3_max');
    expect(
      availableDefaultVideoModel('seedance_v2_5', 'minimax_h3_max', '16:9', {
        byteplus: true,
      })
    ).toBe('seedance_v2_5');
  });
});
