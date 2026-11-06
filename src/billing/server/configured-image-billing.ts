import type { Resolution } from '@/models/resolutions';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { isValidTextToImageModel } from '@/models/models';
import type { ImageChannelParameterValues } from '@/models/image-channel-parameters';
import { loadModelRuntimeConfiguration } from '@/platform/server/db/scoped';
import {
  configuredImageSource,
  quoteConfiguredImageRequest,
} from '@/billing/configured-image-billing';

export type ConfiguredImagePreflightRequest = {
  model: string;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  referenceImageCount?: number;
  parameters?: ImageChannelParameterValues;
  hasMask?: boolean;
  imageCount?: number;
  modelConfiguration?: ModelRuntimeConfiguration;
};

export async function prepareConfiguredImageBilling(
  input: ConfiguredImagePreflightRequest
) {
  if (!isValidTextToImageModel(input.model)) return undefined;
  const modelConfiguration =
    input.modelConfiguration ?? (await loadModelRuntimeConfiguration());
  if (!configuredImageSource(input.model, modelConfiguration.imageModelRouting))
    return undefined;
  const referenceImageCount = input.referenceImageCount ?? 0;
  const quote = quoteConfiguredImageRequest({
    model: input.model,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    imageModelRouting: modelConfiguration.imageModelRouting,
    operation: referenceImageCount > 0 ? 'edit' : 'generate',
    referenceImageCount,
    hasMask: input.hasMask,
    parameters: input.parameters,
    imageCount: input.imageCount,
  });
  return { ...quote, modelConfiguration };
}

export async function configuredImageRoutingFor(
  model: unknown,
  configuration?: ModelRuntimeConfiguration
) {
  return configuredImageRoutingForModels([model], configuration);
}

export async function configuredImageRoutingForModels(
  models: readonly unknown[],
  configuration?: ModelRuntimeConfiguration
) {
  if (!models.some(isValidTextToImageModel)) return undefined;
  const { imageModelRouting } =
    configuration ?? (await loadModelRuntimeConfiguration());
  return models.some((model) => configuredImageSource(model, imageModelRouting))
    ? imageModelRouting
    : undefined;
}
