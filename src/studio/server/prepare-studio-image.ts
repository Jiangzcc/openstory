import { prepareConfiguredImageBilling } from '@/billing/server/configured-image-billing';
import { resolveImageModelRoute } from '@/models/image-channels';
import { loadModelRuntimeConfiguration } from '@/platform/server/db/scoped';
import type { StudioCreateInput } from '@/studio/schema';
import { requireStudioImageCapabilities } from './studio-image-capabilities';

export async function prepareStudioImage(input: StudioCreateInput) {
  if (input.activity !== 'image') return undefined;
  const modelConfiguration = await loadModelRuntimeConfiguration();
  const configured = await prepareConfiguredImageBilling({
    model: input.imageModel,
    modelConfiguration,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    parameters: input.channelParameters,
    referenceImageCount: input.referenceImages.length,
    hasMask: Boolean(input.maskImageUrl),
  });
  const route = configured
    ? resolveImageModelRoute(
        configured.modelConfiguration.imageModelRouting,
        input.imageModel
      )
    : undefined;
  requireStudioImageCapabilities(input, modelConfiguration.imageModelRouting);
  const operation = input.referenceImages.length > 0 ? 'edit' : 'generate';
  return {
    modelConfiguration,
    configured,
    endpointId: route?.operations[operation]?.upstreamModel,
    modelName: route?.name,
    input: configured
      ? { ...input, channelParameters: configured.parameters }
      : input,
  };
}
