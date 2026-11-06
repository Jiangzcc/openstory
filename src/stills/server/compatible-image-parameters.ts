import { supportsConfiguredImageSize } from '@/models/image-resource-budget';
import { z } from 'zod';
import type {
  ImageEditParamsNonStreaming,
  ImageGenerateParamsNonStreaming,
} from 'openai/resources/images';
import { CompatibleImageError } from './compatible-image-error';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import type { CompatibleImageInput } from './compatible-image-types';

const qualitySchema = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'auto',
  'standard',
  'hd',
]);
const scalarSchema = z.union([
  z.string().max(COMPATIBLE_IMAGE_LIMITS.maxParameterTextLength),
  z.number().finite().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  z.boolean(),
]);
const reservedKeys = new Set([
  'model',
  'prompt',
  'image',
  'images',
  'imageurl',
  'imageurls',
  'mask',
  'apikey',
  'authorization',
  'auth',
  'headers',
  'baseurl',
  'url',
  'stream',
  'streaming',
  'user',
  'extrabody',
  'extraheaders',
  'requestoptions',
  'proto',
  'constructor',
  'prototype',
]);
const parametersSchema = z
  .object({
    n: z
      .number()
      .int()
      .min(1)
      .max(COMPATIBLE_IMAGE_LIMITS.maxImages)
      .optional(),
    size: z
      .string()
      .regex(/^(auto|[1-9]\d*x[1-9]\d*)$/)
      .max(24)
      .optional(),
    quality: qualitySchema.optional(),
    background: z.enum(['transparent', 'opaque', 'auto']).optional(),
    output_format: z.enum(['png', 'jpeg', 'webp']).optional(),
    output_compression: z.number().int().min(0).max(100).optional(),
    response_format: z.enum(['url', 'b64_json']).optional(),
    input_fidelity: z.enum(['high', 'low']).optional(),
    moderation: z.enum(['low', 'auto']).optional(),
    style: z.enum(['vivid', 'natural']).optional(),
  })
  .catchall(scalarSchema);

export type CompatibleImageParameters = z.infer<typeof parametersSchema>;

export function parseCompatibleImageParameters(
  value: unknown
): CompatibleImageParameters {
  if (value && typeof value === 'object')
    validateParameterKeys(Object.keys(value));
  const parsed = parametersSchema.safeParse(value === undefined ? {} : value);
  if (!parsed.success)
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  if (!supportsConfiguredImageSize(parsed.data.size))
    throw new CompatibleImageError('resource_limit', {
      submissionState: 'not_submitted',
    });
  return parsed.data;
}

export function compatibleGenerateParameters(
  input: CompatibleImageInput,
  parameters: CompatibleImageParameters
): ImageGenerateParamsNonStreaming {
  const { input_fidelity, ...rest } = parameters;
  if (input_fidelity !== undefined)
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  return {
    ...rest,
    model: input.upstreamModel,
    prompt: input.prompt,
    stream: false,
  };
}

export function compatibleEditParameters(
  input: CompatibleImageInput,
  parameters: CompatibleImageParameters
): ImageEditParamsNonStreaming {
  const { moderation, style, quality, ...rest } = parameters;
  if (moderation !== undefined || style !== undefined || quality === 'hd') {
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  }
  const image =
    input.references.length === 1 ? input.references[0] : [...input.references];
  if (!image)
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  return {
    ...rest,
    quality,
    model: input.upstreamModel,
    prompt: input.prompt,
    image,
    mask: input.mask,
    stream: false,
  };
}

function validateParameterKeys(keys: string[]): void {
  if (
    keys.length > COMPATIBLE_IMAGE_LIMITS.maxParameters ||
    keys.some(isUnsafeParameterKey)
  ) {
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  }
}

function isUnsafeParameterKey(key: string): boolean {
  return (
    key.length > COMPATIBLE_IMAGE_LIMITS.maxParameterKeyLength ||
    !/^[a-z][a-z0-9_]*$/.test(key) ||
    reservedKeys.has(key.replace(/_/g, ''))
  );
}
