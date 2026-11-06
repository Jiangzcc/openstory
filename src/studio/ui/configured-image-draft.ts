import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';

export const STUDIO_IMAGE_COUNTS = [1, 2, 4] as const;
export type StudioImageCount = (typeof STUDIO_IMAGE_COUNTS)[number];
const INVALID_IMAGE_COUNT = 0;
const MAXIMUM_STUDIO_REQUESTS = 4;

export function isStudioImageCount(value: number): value is StudioImageCount {
  return STUDIO_IMAGE_COUNTS.some((count) => count === value);
}

function storedNativeCount(parameters: unknown): unknown {
  if (parameters === undefined) return 1;
  if (
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters)
  )
    return INVALID_IMAGE_COUNT;
  return 'n' in parameters ? parameters.n : 1;
}

export function restoredStudioImageCount(input: {
  count?: unknown;
  channelParameters?: unknown;
}): number {
  const requests = input.count === undefined ? 1 : input.count;
  const nativeCount = storedNativeCount(input.channelParameters);
  if (
    typeof requests !== 'number' ||
    !Number.isSafeInteger(requests) ||
    requests < 1 ||
    requests > MAXIMUM_STUDIO_REQUESTS
  )
    return INVALID_IMAGE_COUNT;
  if (
    typeof nativeCount !== 'number' ||
    !Number.isSafeInteger(nativeCount) ||
    nativeCount < 1 ||
    nativeCount > IMAGE_PARAMETER_LIMITS.maximumImages
  )
    return INVALID_IMAGE_COUNT;
  return requests * nativeCount;
}
