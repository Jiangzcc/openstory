import {
  isValidAudioModel,
  isValidImageToVideoModel,
  isValidTextToImageModel,
  referenceOnlyCapableWith,
  type AudioModel,
  type ImageToVideoModel,
  type TextToImageModel,
} from '@/models/models';
import {
  DEFAULT_GENERATION_MODE,
  availableDefaultVideoModel,
  defaultAnalysisModel,
  defaultAudioModel,
  defaultImageModel,
  defaultVideoModel,
  isGenerationMode,
  type GenerationMode,
} from '@/models/generation-mode';
import {
  isCustomAnalysisModelId,
  isSelectableAnalysisModelId,
  type AnalysisModelId,
} from '@/models/models.config';
import type { ModelConfiguration } from '@/models/model-configuration';
import { useModelDefaults } from '@/models/ui/use-model-defaults';
import { useTextModelCatalog } from '@/models/ui/use-text-model-catalog';
import { useViaAvailability } from '@/models/ui/use-via-availability';
import {
  aspectRatioSchema,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from '@/models/aspect-ratios';
import {
  DEFAULT_RESOLUTION,
  isResolution,
  type Resolution,
} from '@/models/resolutions';
import {
  isGenerationStage,
  NEW_SEQUENCE_STOP_AT,
  stopAtFromFlags,
  type GenerationStage,
} from '@/sequences/pipeline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLogger } from '@/platform/logger';

const logger = getLogger(['openstory', 'ui', 'use-generation-settings']);
// Keep the key: legacy snapshots are explicit preferences; new writes contain only overrides.
const STORAGE_KEY = 'openstory:generation-settings:v6';

export type GenerationSettings = {
  generationMode: GenerationMode;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  analysisModels: AnalysisModelId[];
  imageModel: TextToImageModel;
  imageModels: TextToImageModel[];
  motionModel: ImageToVideoModel;
  videoModels: ImageToVideoModel[];
  stopAt: GenerationStage;
  rememberStopAt: boolean;
  generateStartFrames: boolean;
  generateVoices: boolean;
  draftMotion: boolean;
  musicModel: AudioModel;
  audioModels: AudioModel[];
};

type GenerationPreferences = Partial<GenerationSettings>;
type GenerationVias = {
  byteplus?: boolean;
  referenceOnlyModels?: readonly ImageToVideoModel[];
};

function validList<T>(
  value: unknown,
  valid: (entry: unknown) => entry is T
): T[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(valid)
    ? value
    : undefined;
}

function modelPreferences(raw: Record<string, unknown>): GenerationPreferences {
  const prefs: GenerationPreferences = {};
  const analysis = Array.isArray(raw.analysisModels)
    ? raw.analysisModels.filter(
        (model): model is AnalysisModelId =>
          isSelectableAnalysisModelId(model) || isCustomAnalysisModelId(model)
      )
    : [];
  if (analysis.length > 0) prefs.analysisModels = analysis;
  const images = validList(raw.imageModels, isValidTextToImageModel);
  if (images) prefs.imageModels = images;
  else if (isValidTextToImageModel(raw.imageModel))
    prefs.imageModels = [raw.imageModel];
  const videos = validList(raw.videoModels, isValidImageToVideoModel);
  if (videos) prefs.videoModels = videos;
  else if (isValidImageToVideoModel(raw.motionModel))
    prefs.videoModels = [raw.motionModel];
  const audio = validList(raw.audioModels, isValidAudioModel);
  if (audio) prefs.audioModels = audio;
  else if (isValidAudioModel(raw.musicModel))
    prefs.audioModels = [raw.musicModel];
  return prefs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseGenerationPreferences(
  raw: unknown
): GenerationPreferences {
  if (!isRecord(raw)) return {};
  const bag: Record<string, unknown> = raw;
  const prefs = modelPreferences(bag);
  if (isGenerationMode(bag.generationMode))
    prefs.generationMode = bag.generationMode;
  const aspect = aspectRatioSchema.safeParse(bag.aspectRatio);
  if (aspect.success) prefs.aspectRatio = aspect.data;
  if (isResolution(bag.resolution)) prefs.resolution = bag.resolution;
  if (isGenerationStage(bag.stopAt)) prefs.stopAt = bag.stopAt;
  else if ('autoGenerateMotion' in bag || 'autoGenerateMusic' in bag) {
    prefs.stopAt = stopAtFromFlags({
      autoGenerateMotion: bag.autoGenerateMotion !== false,
      autoGenerateMusic: bag.autoGenerateMusic !== false,
    });
  }
  const flags = [
    'rememberStopAt',
    'generateStartFrames',
    'generateVoices',
    'draftMotion',
  ] as const;
  for (const key of flags) {
    if (typeof bag[key] === 'boolean') prefs[key] = bag[key];
  }
  return prefs;
}

function defaultSettings(
  configuration: Readonly<ModelConfiguration>,
  prefs: GenerationPreferences
): GenerationSettings {
  const mode = prefs.generationMode ?? DEFAULT_GENERATION_MODE;
  const aspectRatio = prefs.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const imageModel = defaultImageModel(mode, configuration);
  const motionModel = prefs.generationMode
    ? defaultVideoModel(mode, aspectRatio, configuration)
    : configuration.newSequenceVideo;
  const musicModel = defaultAudioModel(mode, configuration);
  return {
    generationMode: mode,
    aspectRatio,
    resolution: DEFAULT_RESOLUTION,
    analysisModels: [defaultAnalysisModel(mode, configuration)],
    imageModel,
    imageModels: [imageModel],
    motionModel,
    videoModels: [motionModel],
    musicModel,
    audioModels: [musicModel],
    stopAt: NEW_SEQUENCE_STOP_AT,
    rememberStopAt: false,
    generateStartFrames: false,
    generateVoices: true,
    draftMotion: true,
  };
}

function nonEmptyModels<T extends string>(
  models: T[],
  fallback: T
): [T, ...T[]] {
  const [first, ...rest] = models;
  return first === undefined ? [fallback] : [first, ...rest];
}

function resolveVideoModels(
  settings: GenerationSettings,
  configuration: Readonly<ModelConfiguration>,
  vias: GenerationVias
): [ImageToVideoModel, ...ImageToVideoModel[]] {
  const modeFallback = availableDefaultVideoModel(
    defaultVideoModel(
      settings.generationMode,
      settings.aspectRatio,
      configuration
    ),
    configuration.defaultVideo,
    settings.aspectRatio,
    vias
  );
  return nonEmptyModels(
    [
      ...new Set(
        settings.videoModels.map((model) =>
          availableDefaultVideoModel(
            model,
            modeFallback,
            settings.aspectRatio,
            vias
          )
        )
      ),
    ],
    modeFallback
  );
}

export function resolveGenerationSettings(
  configuration: Readonly<ModelConfiguration>,
  prefs: GenerationPreferences,
  vias: GenerationVias = {}
): GenerationSettings {
  const settings = { ...defaultSettings(configuration, prefs), ...prefs };
  const videoModels = resolveVideoModels(settings, configuration, vias);
  const imageModels = nonEmptyModels(settings.imageModels, settings.imageModel);
  const audioModels = nonEmptyModels(settings.audioModels, settings.musicModel);
  const supportsReferences = (model: ImageToVideoModel) =>
    vias.referenceOnlyModels
      ? vias.referenceOnlyModels.includes(model)
      : referenceOnlyCapableWith(model, { xai: true });
  return {
    ...settings,
    videoModels,
    imageModels,
    audioModels,
    imageModel: imageModels[0],
    motionModel: videoModels[0],
    musicModel: audioModels[0],
    generateStartFrames:
      settings.generateStartFrames || !videoModels.every(supportsReferences),
  };
}

export function updateGenerationPreferences(
  prefs: GenerationPreferences,
  patch: GenerationPreferences
): GenerationPreferences {
  const next = { ...prefs };
  const modeChanged =
    patch.generationMode !== undefined &&
    patch.generationMode !== (prefs.generationMode ?? DEFAULT_GENERATION_MODE);
  if (modeChanged) {
    delete next.analysisModels;
    delete next.imageModels;
    delete next.videoModels;
    delete next.audioModels;
  }
  return { ...next, ...parseGenerationPreferences(patch) };
}

function loadPreferences(): GenerationPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseGenerationPreferences(JSON.parse(stored)) : {};
  } catch (error) {
    logger.warn('Failed to load settings from localStorage:', { err: error });
    return {};
  }
}

function storePreferences(prefs: GenerationPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    logger.warn('Failed to save settings to localStorage:', { err: error });
  }
}

function useGenerationPreferences() {
  const [prefs, setPrefs] = useState<GenerationPreferences>({});
  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => {
    setPrefs(loadPreferences());
    setIsLoaded(true);
  }, []);
  const save = useCallback((patch: GenerationPreferences) => {
    setPrefs((previous) => {
      const next = updateGenerationPreferences(previous, patch);
      storePreferences(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    storePreferences({});
    setPrefs({});
  }, []);
  return { prefs, isLoaded, save, reset };
}

export function useGenerationSettings() {
  const { configuration, isReady } = useModelDefaults();
  const textModelCatalog = useTextModelCatalog();
  const vias = useViaAvailability();
  const { prefs, isLoaded, save, reset } = useGenerationPreferences();
  const settings = useMemo(
    () => resolveGenerationSettings(configuration, prefs, vias),
    [configuration, prefs, vias]
  );
  return {
    settings,
    configuration,
    textModelCatalog,
    isLoaded: isLoaded && isReady,
    save,
    reset,
  };
}
