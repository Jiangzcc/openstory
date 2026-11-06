import { CONFIGURED_IMAGE_RESOURCE_LIMITS } from '@/models/image-resource-budget';

export const COMPATIBLE_IMAGE_LIMITS = {
  maxImages: 16,
  maxReferences: 16,
  maxParameters: 64,
  maxParameterKeyLength: 80,
  maxParameterTextLength: 2048,
  maxImageBytes: CONFIGURED_IMAGE_RESOURCE_LIMITS.maxImageBytes,
  maxTotalBytes: 24 * 1024 * 1024,
  maxMaskBytes: 4 * 1024 * 1024,
  maxJsonBytes: 32 * 1024 * 1024 + 64 * 1024,
  maxPixels: CONFIGURED_IMAGE_RESOURCE_LIMITS.maxPixels,
  maxEdge: CONFIGURED_IMAGE_RESOURCE_LIMITS.maxEdge,
  maxPromptLength: 50_000,
  timeoutMs: 10 * 60 * 1000,
  maxRequestIdLength: 128,
  base64ChunkBytes: 32_768,
} as const;

export const COMPATIBLE_IMAGE_STEP_TIMEOUT = '15 minutes';

export const COMPATIBLE_IMAGE_HTTP = {
  badRequest: 400,
  serverError: 500,
} as const;
