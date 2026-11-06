import { matchesImageChannelParameter } from '@/models/image-channel-parameters';
import type {
  ImageChannelParameter,
  ImageOperation,
} from '@/models/image-channel-parameters';
import {
  isStudioImageCount,
  STUDIO_IMAGE_COUNTS,
} from './configured-image-draft';

export const STUDIO_IMAGE_COUNT_ERROR =
  'This model cannot generate exactly {{count}} images. Choose another count.';

export function configuredImageCount(
  definitions: readonly ImageChannelParameter[],
  operation: ImageOperation,
  total: number
): {
  imageCount: number;
  requestCount: number;
  parameters: { n?: number };
} | null {
  if (!isStudioImageCount(total)) return null;
  const definition = definitions.find(
    (field) =>
      field.key === 'n' &&
      field.status === 'verified' &&
      field.operations.includes(operation)
  );
  if (!definition)
    return { imageCount: 1, requestCount: total, parameters: {} };
  for (let imageCount = 1; imageCount <= total; imageCount += 1) {
    if (
      total % imageCount === 0 &&
      matchesImageChannelParameter(definition, imageCount)
    )
      return {
        imageCount,
        requestCount: total / imageCount,
        parameters: { n: imageCount },
      };
  }
  return null;
}

export function configuredImageCounts(
  definitions: readonly ImageChannelParameter[],
  operation: ImageOperation
): number[] {
  return STUDIO_IMAGE_COUNTS.filter((total) =>
    configuredImageCount(definitions, operation, total)
  );
}
