import { multiplyMicros, usdToMicros } from '@/billing/money';
import type { Microdollars } from '@/billing/money';
import type { AspectRatio } from '@/models/aspect-ratios';
import { resolveConfiguredImageParameters } from '@/models/configured-image-request';
import type {
  ImageChannelParameterValues,
  ImageOperation,
} from '@/models/image-channel-parameters';
import { quoteConfiguredImagePrice } from '@/models/image-channel-pricing';
import type { ConfiguredImagePriceQuote } from '@/models/image-channel-pricing';
import type { ImageModelCatalogEntry } from '@/models/image-channels';
import { getImageModelDefinition } from '@/models/image-model-catalog';
import type { ImageModelDefinition } from '@/models/image-model-catalog';
import { CONFIGURED_IMAGE_SIZE_ERROR } from '@/models/image-resource-budget';
import { capReferenceImages, supportsReferenceImages } from '@/models/models';
import { mediaUrlSchema } from '@/platform/schemas/media-url.schemas';
import {
  configuredImageOutputOptions,
  CONFIGURED_IMAGE_RESOLUTION_ERROR,
} from '@/models/configured-image-specification';
import type { ConfiguredImageOutputOptions } from '@/models/configured-image-specification';
import { clampResolution, DEFAULT_RESOLUTION } from '@/models/resolutions';
import type { Resolution } from '@/models/resolutions';
import {
  configuredImageCount,
  configuredImageCounts,
  STUDIO_IMAGE_COUNT_ERROR,
} from './configured-image-count';
import {
  isStudioImageCount,
  restoredStudioImageCount,
  STUDIO_IMAGE_COUNTS,
} from './configured-image-draft';

const BUILTIN_REFERENCE_LIMIT = 9;

export type StudioImageControlIssue = {
  key:
    | keyof typeof import('@/ui/i18n/locales/en/image-channels.json')
    | typeof STUDIO_IMAGE_COUNT_ERROR
    | 'The model has no valid default for {{parameter}}. Contact an administrator.';
  values?: Record<string, string | number>;
};
export type StudioImageSettingsInput = {
  modelId: string;
  catalog: readonly ImageModelDefinition[];
  referenceCount: number;
  aspectRatio: AspectRatio;
  resolution?: Resolution;
  totalImageCount: number;
  maskImageUrl?: string;
};
export type StudioImageSettings = {
  isConfigured: boolean;
  model?: ImageModelDefinition;
  configuration?: ImageModelCatalogEntry;
  operation: ImageOperation;
  outputOptions: ConfiguredImageOutputOptions;
  resolution: Resolution;
  availableCounts: readonly number[];
  requestCount: number;
  requestParameters: ImageChannelParameterValues;
  referenceLimit: number;
  maskSupported: boolean;
  maskImageUrl?: string;
  parameters: ImageChannelParameterValues;
  quote: ConfiguredImagePriceQuote | null;
  estimate: Microdollars | null;
  totalImageCount: number;
  aspectRatio: AspectRatio;
  issue: StudioImageControlIssue | null;
};

function studioImageReferenceLimit(
  model: ImageModelDefinition | undefined
): number {
  if (model?.source === 'configured') {
    const binding = model.configuration.operations.edit;
    return binding?.status === 'verified' ? binding.maxReferenceImages : 0;
  }
  if (!model || !supportsReferenceImages(model.id)) return 0;
  return capReferenceImages(
    model.id,
    Array.from({ length: BUILTIN_REFERENCE_LIMIT })
  ).length;
}

function referenceIssue(
  configuration: ImageModelCatalogEntry | undefined,
  operation: ImageOperation,
  referenceCount: number,
  referenceLimit: number
): StudioImageControlIssue | null {
  if (referenceCount > referenceLimit)
    return {
      key:
        referenceLimit === 0
          ? 'This model does not accept reference images. Remove them or select another model.'
          : 'This model accepts up to {{maximum}} reference images. Remove extra images or select another model.',
      values: { maximum: referenceLimit },
    };
  if (!configuration) return null;
  const binding = configuration.operations[operation];
  if (
    binding?.status === 'verified' &&
    referenceCount >= binding.minReferenceImages
  )
    return null;
  const edit = configuration.operations.edit;
  if (operation === 'generate' && edit?.status === 'verified')
    return {
      key: 'Attach between {{minimum}} and {{maximum}} reference images for this model.',
      values: {
        minimum: edit.minReferenceImages,
        maximum: edit.maxReferenceImages,
      },
    };
  return {
    key: 'Configured image parameters are unavailable for this operation.',
  };
}

function studioImageOutputSettings(
  configuration: ImageModelCatalogEntry | undefined,
  operation: ImageOperation,
  input: StudioImageSettingsInput
) {
  const offered = configuredImageOutputOptions(
    configuration?.parameters ?? [],
    operation,
    input.aspectRatio
  );
  const aspectRatio = offered.aspectRatios.includes(input.aspectRatio)
    ? input.aspectRatio
    : (offered.aspectRatios[0] ?? input.aspectRatio);
  const outputOptions =
    aspectRatio === input.aspectRatio
      ? offered
      : configuredImageOutputOptions(
          configuration?.parameters ?? [],
          operation,
          aspectRatio
        );
  return {
    aspectRatio,
    outputOptions,
    resolution: clampResolution(
      input.resolution ?? DEFAULT_RESOLUTION,
      outputOptions.resolutions
    ),
  };
}

function initialImageSettings(
  input: StudioImageSettingsInput
): StudioImageSettings {
  const model = getImageModelDefinition(input.modelId, input.catalog);
  const configuration =
    model?.source === 'configured' ? model.configuration : undefined;
  const operation = input.referenceCount > 0 ? 'edit' : 'generate';
  const output = studioImageOutputSettings(configuration, operation, input);
  return {
    isConfigured: model?.source === 'configured',
    model,
    configuration,
    operation,
    referenceLimit: studioImageReferenceLimit(model),
    ...output,
    availableCounts: configuration
      ? configuredImageCounts(configuration.parameters, operation)
      : STUDIO_IMAGE_COUNTS,
    requestCount: input.totalImageCount,
    requestParameters: {},
    maskSupported:
      configuration?.operations[operation]?.status === 'verified' &&
      configuration.operations[operation].mask === 'verified',
    parameters: {},
    quote: null,
    estimate: null,
    totalImageCount: input.totalImageCount,
    issue: null,
  };
}

function maskIssue(
  input: StudioImageSettingsInput,
  state: StudioImageSettings
): StudioImageControlIssue | null {
  if (!input.maskImageUrl?.trim()) return null;
  if (!state.maskSupported)
    return {
      key: 'A mask requires reference images and verified mask editing.',
    };
  if (!mediaUrlSchema.safeParse(input.maskImageUrl.trim()).success)
    return {
      key: 'Enter a valid mask image URL.',
    };
  return null;
}

function imageQuoteEstimate(
  quote: ConfiguredImagePriceQuote,
  requestCount: number
): Microdollars {
  const perRequest = usdToMicros(quote.totalUsd);
  const total = multiplyMicros(perRequest, requestCount);
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    (quote.totalUsd > 0 && perRequest === 0)
  )
    throw new Error('The configured price is outside wallet precision.');
  return total;
}

function configuredPriceState(
  input: StudioImageSettingsInput,
  state: StudioImageSettings,
  configuration: ImageModelCatalogEntry
): StudioImageSettings {
  const count = configuredImageCount(
    configuration.parameters,
    state.operation,
    input.totalImageCount
  );
  if (!count)
    return {
      ...state,
      issue: {
        key: STUDIO_IMAGE_COUNT_ERROR,
        values: { count: input.totalImageCount },
      },
    };
  const parameters = resolveConfiguredImageParameters(
    configuration.parameters,
    state.operation,
    {
      parameters: count.parameters,
      aspectRatio: state.aspectRatio,
      resolution: state.resolution,
    }
  );
  const quote = quoteConfiguredImagePrice(
    configuration.priceCards,
    state.operation,
    parameters,
    count.imageCount
  );
  return {
    ...state,
    parameters,
    quote,
    estimate: imageQuoteEstimate(quote, count.requestCount),
    requestCount: count.requestCount,
    requestParameters: count.parameters,
    ...(input.maskImageUrl?.trim()
      ? { maskImageUrl: input.maskImageUrl.trim() }
      : {}),
  };
}

const IMAGE_CONTROL_ERRORS: Record<string, StudioImageControlIssue['key']> = {
  [CONFIGURED_IMAGE_SIZE_ERROR]: CONFIGURED_IMAGE_SIZE_ERROR,
  [CONFIGURED_IMAGE_RESOLUTION_ERROR]: 'Choose a verified image size.',
  'No configured image price matches these parameters.':
    'No USD price is configured for these parameters.',
  'Configured image price is ambiguous for these parameters.':
    'More than one USD price matches these parameters.',
  'The image model has no verified size for this aspect ratio.':
    'Choose a verified image size.',
  'The configured price is outside wallet precision.':
    'The configured price is outside wallet precision.',
};

function imageControlError(
  error: unknown,
  configuration: ImageModelCatalogEntry
): StudioImageControlIssue {
  if (!(error instanceof Error))
    return { key: 'Check the image parameters and configured price.' };
  const key = IMAGE_CONTROL_ERRORS[error.message];
  if (key) return { key };
  const parameter = /^(Missing required|Invalid) image parameter: (.+)\.$/.exec(
    error.message
  );
  if (!parameter)
    return { key: 'Check the image parameters and configured price.' };
  const label =
    configuration.parameters.find((field) => field.key === parameter[2])
      ?.label ??
    parameter[2] ??
    '';
  return {
    key: 'The model has no valid default for {{parameter}}. Contact an administrator.',
    values: { parameter: label },
  };
}

function unavailableStudioImageModel(state: StudioImageSettings): boolean {
  return (
    !state.model || (state.isConfigured && !state.configuration?.available)
  );
}

export function evaluateStudioImageSettings(
  input: StudioImageSettingsInput
): StudioImageSettings {
  const state = initialImageSettings(input);
  if (unavailableStudioImageModel(state))
    return {
      ...state,
      issue: { key: 'The selected image model is unavailable.' },
    };
  const issue = referenceIssue(
    state.configuration,
    state.operation,
    input.referenceCount,
    state.referenceLimit
  );
  if (issue) return { ...state, issue };
  if (!isStudioImageCount(input.totalImageCount))
    return {
      ...state,
      issue: {
        key: STUDIO_IMAGE_COUNT_ERROR,
        values: { count: input.totalImageCount },
      },
    };
  if (!state.isConfigured || !state.configuration) {
    const hasSavedSettings = Boolean(input.maskImageUrl);
    return hasSavedSettings
      ? {
          ...state,
          issue: {
            key: 'Configured image parameters are unavailable for this operation.',
          },
        }
      : state;
  }
  const mask = maskIssue(input, state);
  if (mask) return { ...state, issue: mask };
  try {
    return configuredPriceState(input, state, state.configuration);
  } catch (error) {
    return { ...state, issue: imageControlError(error, state.configuration) };
  }
}

export function isPngMaskFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === 'image/png' && /\.png$/i.test(file.name);
}

export type StoredStudioImageSettings = {
  totalImageCount?: number;
  maskImageUrl?: string;
  imageSettingsIssue?: StudioImageControlIssue;
};

export function readStoredStudioImageSettings(input: {
  count?: unknown;
  channelParameters?: unknown;
  maskImageUrl?: unknown;
}): StoredStudioImageSettings {
  const maskIsString =
    input.maskImageUrl === undefined || typeof input.maskImageUrl === 'string';
  return {
    totalImageCount: restoredStudioImageCount(input),
    ...(typeof input.maskImageUrl === 'string'
      ? { maskImageUrl: input.maskImageUrl }
      : {}),
    ...(!maskIsString
      ? {
          imageSettingsIssue: { key: 'Enter a valid mask image URL.' as const },
        }
      : {}),
  };
}
