import type { Resolution } from '@/models/resolutions';
import type {
  ImageChannelParameterValues,
  ImageOperation,
} from '@/models/image-channel-parameters';
import { resolveConfiguredImageParameters } from '@/models/configured-image-request';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { ImageModelRoutingSnapshot } from '@/models/image-channels';
import {
  resolveImageModelRoute,
  usesConfiguredImageChannel,
} from '@/models/image-channels';
import { quoteConfiguredImagePrice } from '@/models/image-channel-pricing';
import { ValidationError } from '@/platform/errors';
import { usdToMicros } from './money';
import type { Microdollars } from './money';

export type ConfiguredImageBillingInput = {
  model: string;
  imageModelRouting?: ImageModelRoutingSnapshot;
  operation: ImageOperation;
  parameters?: ImageChannelParameterValues;
  referenceImageCount?: number;
  hasMask?: boolean;
  imageCount?: number;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
};

function requireReferenceCapability(
  route: NonNullable<ReturnType<typeof resolveImageModelRoute>>,
  input: ConfiguredImageBillingInput
): void {
  const binding = route.operations[input.operation];
  if (binding?.status !== 'verified')
    throw new ValidationError('This image operation is unavailable.');
  const references = input.referenceImageCount ?? 0;
  if (
    !Number.isSafeInteger(references) ||
    references < binding.minReferenceImages ||
    references > binding.maxReferenceImages
  )
    throw new ValidationError(
      'The reference image count is unsupported by this model.'
    );
  if (
    input.hasMask &&
    (input.operation !== 'edit' || binding.mask !== 'verified')
  )
    throw new ValidationError(
      'Mask editing is unavailable for this image model.'
    );
}

function checkedImageMicros(usd: number): Microdollars {
  const cost = usdToMicros(usd);
  if (!Number.isSafeInteger(cost) || cost < 0 || (usd > 0 && cost === 0))
    throw new ValidationError(
      'The configured image price is outside wallet precision.'
    );
  return cost;
}

export function quoteConfiguredImageRequest(
  input: ConfiguredImageBillingInput
) {
  const route = resolveImageModelRoute(input.imageModelRouting, input.model);
  if (!route)
    throw new ValidationError('Configured image model is unavailable.');
  requireReferenceCapability(route, input);
  const parameters = resolveConfiguredImageParameters(
    route.parameters,
    input.operation,
    {
      parameters: input.parameters,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      imageCount: input.imageCount,
    }
  );
  const count =
    input.imageCount ?? (typeof parameters.n === 'number' ? parameters.n : 1);
  if (parameters.n !== undefined && parameters.n !== count)
    throw new ValidationError(
      'Image count does not match the configured request parameters.'
    );
  const quote = quoteConfiguredImagePrice(
    route.priceCards,
    input.operation,
    parameters,
    count
  );
  return {
    ...quote,
    parameters,
    costMicros: checkedImageMicros(quote.totalUsd),
    imageSource: 'platform' as const,
  };
}

export function estimateConfiguredImageCost(
  input: ConfiguredImageBillingInput,
  totalImages: number
): Microdollars {
  if (!Number.isSafeInteger(totalImages) || totalImages < 0)
    throw new ValidationError(
      'Image estimate count must be a nonnegative integer.'
    );
  const quote = quoteConfiguredImageRequest(input);
  const total = checkedImageMicros(quote.unitPriceUsd * totalImages);
  if (!Number.isSafeInteger(total))
    throw new ValidationError(
      'The configured image estimate exceeds wallet precision.'
    );
  return total;
}

export function configuredImageSource(
  model: unknown,
  routing?: ImageModelRoutingSnapshot
) {
  return usesConfiguredImageChannel(model, routing)
    ? ('platform' as const)
    : undefined;
}
