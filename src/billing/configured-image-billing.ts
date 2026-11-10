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
import {
  IMAGE_OPERATION_ISSUES,
  imageOperationIssue,
} from '@/models/image-operation-capabilities';
import { ValidationError } from '@/platform/errors';
import { multiplyMicros, usdToMicros } from './money';
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

const IMAGE_OPERATION_ERRORS = {
  [IMAGE_OPERATION_ISSUES.unavailable]: 'This image operation is unavailable.',
  [IMAGE_OPERATION_ISSUES.references]:
    'The reference image count is unsupported by this model.',
  [IMAGE_OPERATION_ISSUES.mask]:
    'Mask editing is unavailable for this image model.',
};

function requireReferenceCapability(
  route: NonNullable<ReturnType<typeof resolveImageModelRoute>>,
  input: ConfiguredImageBillingInput
): void {
  const issue = imageOperationIssue({
    binding: route.operations[input.operation],
    operation: input.operation,
    referenceImageCount: input.referenceImageCount ?? 0,
    hasMask: input.hasMask,
  });
  if (issue) throw new ValidationError(IMAGE_OPERATION_ERRORS[issue]);
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
    costMicros: multiplyMicros(checkedImageMicros(quote.unitPriceUsd), count),
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
  const total = multiplyMicros(
    checkedImageMicros(quote.unitPriceUsd),
    totalImages
  );
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
