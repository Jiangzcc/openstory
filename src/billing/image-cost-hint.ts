import type { Microdollars } from './money';
import { usdToMicros } from './money';
import { estimateImageCost } from './cost-estimation';
import type { EffectiveFalPricing } from './fal-cost';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { Resolution } from '@/models/resolutions';
import type { TextToImageModel } from '@/models/models';
import type { ImageChannelParameterValues } from '@/models/image-channel-parameters';
import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';
import type { ImageModelCatalogEntry } from '@/models/image-channels';
import type { ImageModelDefinition } from '@/models/image-model-catalog';
import { getImageModelDefinition } from '@/models/image-model-catalog';
import { resolveConfiguredImageParameters } from '@/models/configured-image-request';
import { quoteConfiguredImagePrice } from '@/models/image-channel-pricing';
import { imageOperationIssue } from '@/models/image-operation-capabilities';

export type ImageCostHintInput = {
  model: TextToImageModel;
  aspectRatio: AspectRatio;
  referenceImageCount: number | undefined;
  resolution?: Resolution;
  parameters?: ImageChannelParameterValues;
  imageCount?: number;
  hasMask?: boolean;
};
type ImageCostIssue =
  | 'The selected image model is unavailable.'
  | 'Configured image parameters are unavailable for this operation.'
  | 'Check the image parameters and configured price.';
export type ImageCostHint = {
  estimate: Microdollars | null | undefined;
  issue: ImageCostIssue | null;
};

function configuredOperationAvailable(
  input: ImageCostHintInput,
  configuration: ImageModelCatalogEntry
): boolean {
  const references = input.referenceImageCount ?? 0;
  const operation = references > 0 ? 'edit' : 'generate';
  return (
    imageOperationIssue({
      binding: configuration.operations[operation],
      operation,
      referenceImageCount: references,
      hasMask: input.hasMask,
    }) === null
  );
}

function configuredImageCost(
  input: ImageCostHintInput,
  configuration: ImageModelCatalogEntry
): Microdollars {
  const operation = (input.referenceImageCount ?? 0) > 0 ? 'edit' : 'generate';
  const count = input.imageCount ?? 1;
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > IMAGE_PARAMETER_LIMITS.maximumImages
  )
    throw new Error('Invalid image count.');
  const parameters = resolveConfiguredImageParameters(
    configuration.parameters,
    operation,
    {
      parameters: input.parameters,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      imageCount: count,
    }
  );
  if (parameters.n !== undefined && parameters.n !== count)
    throw new Error('Image count does not match the request.');
  const quote = quoteConfiguredImagePrice(
    configuration.priceCards,
    operation,
    parameters,
    count
  );
  return quotedImageMicros(quote.totalUsd);
}

function quotedImageMicros(totalUsd: number): Microdollars {
  const cost = usdToMicros(totalUsd);
  if (!Number.isSafeInteger(cost) || cost < 0 || (totalUsd > 0 && cost === 0))
    throw new Error('The configured price is outside wallet precision.');
  return cost;
}

function configuredImageHint(
  input: ImageCostHintInput,
  configuration: ImageModelCatalogEntry
): ImageCostHint {
  if (!configuredOperationAvailable(input, configuration))
    return {
      estimate: null,
      issue: 'Configured image parameters are unavailable for this operation.',
    };
  try {
    return { estimate: configuredImageCost(input, configuration), issue: null };
  } catch {
    return {
      estimate: null,
      issue: 'Check the image parameters and configured price.',
    };
  }
}

export function imageCostHint(
  input: ImageCostHintInput,
  catalog: readonly ImageModelDefinition[],
  pricing: Record<string, EffectiveFalPricing> | null,
  pricingPending = false
): ImageCostHint {
  const model = getImageModelDefinition(input.model, catalog);
  if (
    !model ||
    (model.source === 'configured' && !model.configuration.available)
  )
    return {
      estimate: null,
      issue: 'The selected image model is unavailable.',
    };
  if (input.referenceImageCount === undefined)
    return { estimate: undefined, issue: null };
  if (model.source === 'configured')
    return configuredImageHint(input, model.configuration);
  if (!pricing)
    return { estimate: pricingPending ? undefined : null, issue: null };
  return {
    estimate: estimateImageCost(
      model.id,
      input.aspectRatio,
      input.imageCount ?? 1,
      {
        pricing,
        resolution: input.resolution,
        edit: input.referenceImageCount > 0,
        referenceImageCount: input.referenceImageCount,
      }
    ),
    issue: null,
  };
}
