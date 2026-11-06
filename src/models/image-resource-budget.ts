const MEBIBYTE = 1024 * 1024;
const WORKER_ISOLATE_BYTES = 128 * MEBIBYTE;
const RUNTIME_HEADROOM_BYTES = 48 * MEBIBYTE;
const RGBA_PIXEL_BYTES = 4;
const DECODE_RGBA_BUFFERS = 4;
const ENCODED_BUFFER_COPIES = 2;

export const CONFIGURED_IMAGE_RESOURCE_LIMITS = {
  maxImageBytes: 10 * MEBIBYTE,
  maxPixels: 64 * MEBIBYTE,
  maxEdge: 32_768,
  maxDecodeBytes: WORKER_ISOLATE_BYTES - RUNTIME_HEADROOM_BYTES,
} as const;
export const CONFIGURED_IMAGE_SIZE_ERROR =
  'The configured image size exceeds supported resource limits.';

export interface ImageResourceDimensions {
  width: number;
  height: number;
}

function validImageDimensions({
  width,
  height,
}: ImageResourceDimensions): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    Math.min(width, height) > 0 &&
    Math.max(width, height) <= CONFIGURED_IMAGE_RESOURCE_LIMITS.maxEdge &&
    width * height <= CONFIGURED_IMAGE_RESOURCE_LIMITS.maxPixels
  );
}

export function fitsConfiguredImageDecodeBudget(
  dimensions: ImageResourceDimensions,
  encodedBytes = 0
): boolean {
  const decodeBytes =
    dimensions.width *
    dimensions.height *
    RGBA_PIXEL_BYTES *
    DECODE_RGBA_BUFFERS;
  return (
    validImageDimensions(dimensions) &&
    Number.isSafeInteger(encodedBytes) &&
    encodedBytes >= 0 &&
    encodedBytes <= CONFIGURED_IMAGE_RESOURCE_LIMITS.maxImageBytes &&
    decodeBytes + encodedBytes * ENCODED_BUFFER_COPIES <=
      CONFIGURED_IMAGE_RESOURCE_LIMITS.maxDecodeBytes
  );
}

export function supportsConfiguredImageSize(size: unknown): boolean {
  if (size === undefined || size === 'auto') return true;
  if (typeof size !== 'string') return false;
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size);
  if (!match) return false;
  return fitsConfiguredImageDecodeBudget({
    width: Number(match[1]),
    height: Number(match[2]),
  });
}

export function requireConfiguredImageSize(size: unknown): void {
  if (!supportsConfiguredImageSize(size))
    throw new Error(CONFIGURED_IMAGE_SIZE_ERROR);
}
