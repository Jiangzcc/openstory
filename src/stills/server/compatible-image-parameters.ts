import { supportsConfiguredImageSize } from '@/models/image-resource-budget';
import {
  IMAGE_PARAMETER_CONTRACT_LIMITS,
  imageParameterValuesSchema,
  imageGenerateParameterValuesSchema,
  imageEditParameterValuesSchema,
  isSafeImageParameterKey,
} from '@/models/image-parameter-contract';
import type { z } from 'zod';
import type {
  ImageEditParamsNonStreaming,
  ImageGenerateParamsNonStreaming,
} from 'openai/resources/images';
import { CompatibleImageError } from './compatible-image-error';
import type { CompatibleImageInput } from './compatible-image-types';

export type CompatibleImageParameters = z.infer<
  typeof imageParameterValuesSchema
>;

export function parseCompatibleImageParameters(
  value: unknown
): CompatibleImageParameters {
  if (value && typeof value === 'object')
    validateParameterKeys(Object.keys(value));
  const parsed = parseParameters(
    imageParameterValuesSchema,
    value === undefined ? {} : value
  );
  if (!supportsConfiguredImageSize(parsed.size))
    throw new CompatibleImageError('resource_limit', {
      submissionState: 'not_submitted',
    });
  return parsed;
}

export function compatibleGenerateParameters(
  input: CompatibleImageInput,
  parameters: CompatibleImageParameters
): ImageGenerateParamsNonStreaming {
  const { input_fidelity: _inputFidelity, ...rest } = parseParameters(
    imageGenerateParameterValuesSchema,
    parameters
  );
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
  const {
    moderation: _moderation,
    style: _style,
    ...rest
  } = parseParameters(imageEditParameterValuesSchema, parameters);
  const image =
    input.references.length === 1 ? input.references[0] : [...input.references];
  if (!image)
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  return {
    ...rest,
    model: input.upstreamModel,
    prompt: input.prompt,
    image,
    mask: input.mask,
    stream: false,
  };
}

function parseParameters<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
  return parsed.data;
}

function validateParameterKeys(keys: string[]): void {
  if (
    keys.length > IMAGE_PARAMETER_CONTRACT_LIMITS.definitions ||
    !keys.every(isSafeImageParameterKey)
  )
    throw new CompatibleImageError('invalid_input', {
      submissionState: 'not_submitted',
    });
}
