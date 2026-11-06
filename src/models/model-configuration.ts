import type { ImageModelDefinition } from './image-model-catalog';
import {
  mergeImageModelCatalog,
  isSelectableImageModelId,
} from './image-model-catalog';
import type { AnalysisModelId, AnalysisModelDefinition } from './models.config';
import { mergeTextModelCatalog } from './text-model-catalog';
import type { AudioModel, TextToImageModel, ImageToVideoModel } from './models';
import { z } from 'zod';
import {
  SCRIPT_ANALYSIS_MODELS,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_VISION_MODEL,
  SCENE_SPLIT_MODEL,
  isSelectableAnalysisModelId,
  isCustomAnalysisModelId,
} from './models.config';
import {
  AUDIO_MODELS,
  IMAGE_MODELS,
  IMAGE_TO_VIDEO_MODELS,
  isValidTextToImageModel,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_MUSIC_MODEL,
  PREVIEW_IMAGE_MODEL,
  SHOT_PREVIEW_IMAGE_MODEL,
} from './models';
import {
  TURBO_DEFAULT_ANALYSIS,
  TURBO_DEFAULT_IMAGE,
  TURBO_DEFAULT_VIDEO,
  TURBO_DEFAULT_AUDIO,
  QUALITY_DEFAULT_ANALYSIS,
  QUALITY_DEFAULT_IMAGE,
  QUALITY_DEFAULT_VIDEO,
  QUALITY_DEFAULT_AUDIO,
} from './generation-mode';
import { nativeGeminiTextModel } from './gemini-native';

export type ModelConfiguration = {
  defaultAnalysis: AnalysisModelId;
  defaultImage: TextToImageModel;
  defaultVideo: ImageToVideoModel;
  defaultMusic: AudioModel;
  turboAnalysis: AnalysisModelId;
  turboImage: TextToImageModel;
  turboVideo: ImageToVideoModel;
  turboMusic: AudioModel;
  qualityAnalysis: AnalysisModelId;
  qualityImage: TextToImageModel;
  qualityVideo: ImageToVideoModel;
  qualityMusic: AudioModel;
  newSequenceVideo: ImageToVideoModel;
  sceneSplit: AnalysisModelId;
  vision: AnalysisModelId;
  studioDraft: AnalysisModelId;
  promptShortening: AnalysisModelId;
  styleRecommendation: AnalysisModelId;
  poster: TextToImageModel;
  shotPreview: TextToImageModel;
  talentVideo: AnalysisModelId;
  watchClip: AnalysisModelId;
};

export const DEFAULT_MODEL_CONFIGURATION: Readonly<ModelConfiguration> = {
  defaultAnalysis: DEFAULT_ANALYSIS_MODEL,
  defaultImage: DEFAULT_IMAGE_MODEL,
  defaultVideo: DEFAULT_VIDEO_MODEL,
  defaultMusic: DEFAULT_MUSIC_MODEL,
  turboAnalysis: TURBO_DEFAULT_ANALYSIS,
  turboImage: TURBO_DEFAULT_IMAGE,
  turboVideo: TURBO_DEFAULT_VIDEO,
  turboMusic: TURBO_DEFAULT_AUDIO,
  qualityAnalysis: QUALITY_DEFAULT_ANALYSIS,
  qualityImage: QUALITY_DEFAULT_IMAGE,
  qualityVideo: QUALITY_DEFAULT_VIDEO,
  qualityMusic: QUALITY_DEFAULT_AUDIO,
  newSequenceVideo: 'seedance_v2_5',
  sceneSplit: SCENE_SPLIT_MODEL,
  vision: DEFAULT_VISION_MODEL,
  studioDraft: DEFAULT_VISION_MODEL,
  promptShortening: DEFAULT_ANALYSIS_MODEL,
  styleRecommendation: DEFAULT_ANALYSIS_MODEL,
  poster: PREVIEW_IMAGE_MODEL,
  shotPreview: SHOT_PREVIEW_IMAGE_MODEL,
  talentVideo: 'google/gemini-3.8-flash',
  watchClip: 'google/gemini-4-argon',
};

type ConfigurationKind =
  | 'analysis'
  | 'vision'
  | 'videoUnderstanding'
  | 'image'
  | 'video'
  | 'music';
type ModelConfigurationGroup = 'defaults' | 'turbo' | 'quality' | 'internal';
type ConfigurationField = {
  key: keyof ModelConfiguration;
  label: string;
  description: string;
  group: ModelConfigurationGroup;
  kind: ConfigurationKind;
};

export const MODEL_CONFIGURATION_FIELDS = [
  {
    key: 'defaultAnalysis',
    label: 'Default analysis model',
    description:
      'Used when an operation has no saved or explicit analysis model, including a new assistant conversation.',
    group: 'defaults',
    kind: 'analysis',
  },
  {
    key: 'defaultImage',
    label: 'Default image model',
    description:
      'Used when an image operation has no saved or explicit model, including Studio.',
    group: 'defaults',
    kind: 'image',
  },
  {
    key: 'defaultVideo',
    label: 'Default video model',
    description:
      'Used when a video operation has no saved or explicit model, subject to existing provider availability checks.',
    group: 'defaults',
    kind: 'video',
  },
  {
    key: 'defaultMusic',
    label: 'Default music model',
    description: 'Used when a music operation has no saved or explicit model.',
    group: 'defaults',
    kind: 'music',
  },
  {
    key: 'newSequenceVideo',
    label: 'New sequence video model',
    description:
      'Initial video recommendation for a new sequence, subject to provider availability.',
    group: 'defaults',
    kind: 'video',
  },
  {
    key: 'turboAnalysis',
    label: 'Turbo analysis model',
    description: 'Recommended analysis model when choosing Turbo mode.',
    group: 'turbo',
    kind: 'analysis',
  },
  {
    key: 'turboImage',
    label: 'Turbo image model',
    description: 'Recommended image model when choosing Turbo mode.',
    group: 'turbo',
    kind: 'image',
  },
  {
    key: 'turboVideo',
    label: 'Turbo video model',
    description: 'Recommended video model when choosing Turbo mode.',
    group: 'turbo',
    kind: 'video',
  },
  {
    key: 'turboMusic',
    label: 'Turbo music model',
    description: 'Recommended music model when choosing Turbo mode.',
    group: 'turbo',
    kind: 'music',
  },
  {
    key: 'qualityAnalysis',
    label: 'Quality analysis model',
    description: 'Recommended analysis model when choosing Quality mode.',
    group: 'quality',
    kind: 'analysis',
  },
  {
    key: 'qualityImage',
    label: 'Quality image model',
    description: 'Recommended image model when choosing Quality mode.',
    group: 'quality',
    kind: 'image',
  },
  {
    key: 'qualityVideo',
    label: 'Quality video model',
    description: 'Recommended video model when choosing Quality mode.',
    group: 'quality',
    kind: 'video',
  },
  {
    key: 'qualityMusic',
    label: 'Quality music model',
    description: 'Recommended music model when choosing Quality mode.',
    group: 'quality',
    kind: 'music',
  },
  {
    key: 'sceneSplit',
    label: 'Scene splitting model',
    description:
      'Splits the script into scenes independently of the user-selected analysis model.',
    group: 'internal',
    kind: 'analysis',
  },
  {
    key: 'vision',
    label: 'Image understanding model',
    description:
      'Understands uploaded images and people. Requires image input support.',
    group: 'internal',
    kind: 'vision',
  },
  {
    key: 'studioDraft',
    label: 'Studio prompt drafting model',
    description:
      'Drafts Studio prompts from text and reference images. Requires image input support.',
    group: 'internal',
    kind: 'vision',
  },
  {
    key: 'promptShortening',
    label: 'Prompt shortening model',
    description: 'Shortens prompts when the user requests a shorter version.',
    group: 'internal',
    kind: 'analysis',
  },
  {
    key: 'styleRecommendation',
    label: 'Style recommendation model',
    description: 'Recommends styles for a script.',
    group: 'internal',
    kind: 'analysis',
  },
  {
    key: 'poster',
    label: 'Sequence poster model',
    description:
      'Generates sequence covers independently of the main image model.',
    group: 'internal',
    kind: 'image',
  },
  {
    key: 'shotPreview',
    label: 'Storyboard sketch model',
    description:
      'Generates shot previews independently of the main image model.',
    group: 'internal',
    kind: 'image',
  },
  {
    key: 'talentVideo',
    label: 'Uploaded video person-check model',
    description:
      'Checks people in uploaded videos. Requires a native Google video-capable model and platform credentials.',
    group: 'internal',
    kind: 'videoUnderstanding',
  },
  {
    key: 'watchClip',
    label: 'Assistant video understanding model',
    description:
      'Understands clips independently of the assistant chat model. Requires native Google credentials.',
    group: 'internal',
    kind: 'videoUnderstanding',
  },
] as const satisfies readonly ConfigurationField[];

export type ModelConfigurationOption = { value: string; label: string };

function analysisOptions(
  kind: ConfigurationKind,
  extraModels: readonly AnalysisModelDefinition[],
  structured: boolean
): ModelConfigurationOption[] {
  const catalog: readonly AnalysisModelDefinition[] =
    kind === 'videoUnderstanding'
      ? SCRIPT_ANALYSIS_MODELS
      : mergeTextModelCatalog()
          .map(
            (model) =>
              extraModels.find((entry) => entry.id === model.id) ?? model
          )
          .concat(
            extraModels.filter((model) => isCustomAnalysisModelId(model.id))
          );
  return catalog
    .filter((model) => {
      if (!isSelectableAnalysisModelId(model.id, extraModels)) return false;
      if (structured && model.structuredOutput === false) return false;
      if (kind === 'videoUnderstanding')
        return Boolean(nativeGeminiTextModel(model.id));
      return kind !== 'vision' || model.vision;
    })
    .map((model) => ({ value: model.id, label: model.name }));
}

function mediaOptions(
  kind: ConfigurationKind,
  includeHidden = false
): ModelConfigurationOption[] {
  const catalog =
    kind === 'image'
      ? IMAGE_MODELS
      : kind === 'video'
        ? IMAGE_TO_VIDEO_MODELS
        : AUDIO_MODELS;
  return Object.entries(catalog)
    .filter(
      ([, model]) => includeHidden || !('hidden' in model && model.hidden)
    )
    .map(([value, model]) => ({ value, label: model.name }));
}

function imageOptions(
  key: keyof ModelConfiguration,
  imageModels: readonly ImageModelDefinition[]
): ModelConfigurationOption[] {
  const catalog = (
    imageModels.length ? imageModels : mergeImageModelCatalog()
  ).map((model) =>
    model.id === DEFAULT_MODEL_CONFIGURATION[key]
      ? { ...model, hidden: false }
      : model
  );
  return catalog
    .filter((model) =>
      isSelectableImageModelId(
        model.id,
        catalog,
        key === 'poster' ? 'generate' : undefined
      )
    )
    .map((model) => ({ value: model.id, label: model.name }));
}

export function getModelConfigurationOptions(
  key: keyof ModelConfiguration,
  extraModels: readonly AnalysisModelDefinition[] = [],
  imageModels: readonly ImageModelDefinition[] = []
): ModelConfigurationOption[] {
  const field = MODEL_CONFIGURATION_FIELDS.find((item) => item.key === key);
  if (!field) return [];
  if (field.kind === 'image') return imageOptions(key, imageModels);
  const options = ['analysis', 'vision', 'videoUnderstanding'].includes(
    field.kind
  )
    ? analysisOptions(
        field.kind,
        extraModels,
        !['studioDraft', 'promptShortening'].includes(key)
      )
    : mediaOptions(field.kind);
  const fallback = DEFAULT_MODEL_CONFIGURATION[key];
  if (!options.some((option) => option.value === fallback)) {
    const legacyOption = mediaOptions(field.kind, true).find(
      (option) => option.value === fallback
    );
    options.push(legacyOption ?? { value: fallback, label: fallback });
  }
  return options;
}

function configuredModel<K extends keyof ModelConfiguration>(
  key: K,
  extraModels: readonly AnalysisModelDefinition[],
  allowUnresolvedCustom: boolean,
  imageModels: readonly ImageModelDefinition[]
) {
  const field = MODEL_CONFIGURATION_FIELDS.find((entry) => entry.key === key);
  const unresolvedText =
    allowUnresolvedCustom &&
    (field?.kind === 'analysis' || field?.kind === 'vision');
  return z.custom<ModelConfiguration[K]>(
    (value) =>
      typeof value === 'string' &&
      (getModelConfigurationOptions(key, extraModels, imageModels).some(
        (option) => option.value === value
      ) ||
        (unresolvedText && isCustomAnalysisModelId(value)) ||
        (allowUnresolvedCustom &&
          field?.kind === 'image' &&
          isValidTextToImageModel(value))),
    { message: 'Choose a supported model for this operation' }
  );
}

export function createModelConfigurationSchema(
  extraModels: readonly AnalysisModelDefinition[] = [],
  allowUnresolvedCustom = false,
  imageModels: readonly ImageModelDefinition[] = []
) {
  const field = <K extends keyof ModelConfiguration>(key: K) =>
    configuredModel(key, extraModels, allowUnresolvedCustom, imageModels);
  return z.strictObject({
    defaultAnalysis: field('defaultAnalysis'),
    defaultImage: field('defaultImage'),
    defaultVideo: field('defaultVideo'),
    defaultMusic: field('defaultMusic'),
    turboAnalysis: field('turboAnalysis'),
    turboImage: field('turboImage'),
    turboVideo: field('turboVideo'),
    turboMusic: field('turboMusic'),
    qualityAnalysis: field('qualityAnalysis'),
    qualityImage: field('qualityImage'),
    qualityVideo: field('qualityVideo'),
    qualityMusic: field('qualityMusic'),
    newSequenceVideo: field('newSequenceVideo'),
    sceneSplit: field('sceneSplit'),
    vision: field('vision'),
    studioDraft: field('studioDraft'),
    promptShortening: field('promptShortening'),
    styleRecommendation: field('styleRecommendation'),
    poster: field('poster'),
    shotPreview: field('shotPreview'),
    talentVideo: field('talentVideo'),
    watchClip: field('watchClip'),
  });
}

export const modelConfigurationSchema = createModelConfigurationSchema();
export const modelConfigurationInputSchema = createModelConfigurationSchema(
  [],
  true
);

export function resolveModelConfiguration(
  value: unknown,
  extraModels: readonly AnalysisModelDefinition[] = [],
  imageModels: readonly ImageModelDefinition[] = []
): ModelConfiguration {
  if (value === null || value === undefined)
    return { ...DEFAULT_MODEL_CONFIGURATION };
  const overrides = modelConfigurationInputSchema.partial().parse(value);
  for (const { key } of MODEL_CONFIGURATION_FIELDS) {
    const selected = overrides[key];
    if (
      isCustomAnalysisModelId(selected) &&
      !getModelConfigurationOptions(key, extraModels).some(
        (option) => option.value === selected
      )
    ) {
      delete overrides[key];
    }
  }
  return createModelConfigurationSchema(extraModels, true, imageModels).parse({
    ...DEFAULT_MODEL_CONFIGURATION,
    ...overrides,
  });
}
