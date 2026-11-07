import { z } from 'zod';

export const IMAGE_PARAMETER_OPERATIONS = ['generate', 'edit'] as const;
type ImageParameterOperation = (typeof IMAGE_PARAMETER_OPERATIONS)[number];
export const IMAGE_PARAMETER_CONTRACT_LIMITS = {
  definitions: 64,
  key: 80,
  text: 2048,
  size: 24,
  maximumImages: 16,
  maximumCompression: 100,
} as const;
const RESERVED_PARAMETER_KEYS = new Set([
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

export function isSafeImageParameterKey(key: string): boolean {
  return (
    key.length <= IMAGE_PARAMETER_CONTRACT_LIMITS.key &&
    /^[a-z][a-z0-9_]*$/.test(key) &&
    !RESERVED_PARAMETER_KEYS.has(key.replace(/_/g, ''))
  );
}

export const imageParameterScalarSchema = z.union([
  z.string().max(IMAGE_PARAMETER_CONTRACT_LIMITS.text),
  z.number().finite().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  z.boolean(),
]);
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
const unavailableParameterSchema = z.never().optional();
const standardParametersSchema = z.object({
  n: z
    .number()
    .int()
    .min(1)
    .max(IMAGE_PARAMETER_CONTRACT_LIMITS.maximumImages)
    .optional(),
  size: z
    .string()
    .regex(/^(auto|[1-9]\d*x[1-9]\d*)$/)
    .max(IMAGE_PARAMETER_CONTRACT_LIMITS.size)
    .optional(),
  quality: qualitySchema.optional(),
  background: z.enum(['transparent', 'opaque', 'auto']).optional(),
  output_format: z.enum(['png', 'jpeg', 'webp']).optional(),
  output_compression: z
    .number()
    .int()
    .min(0)
    .max(IMAGE_PARAMETER_CONTRACT_LIMITS.maximumCompression)
    .optional(),
  response_format: z.enum(['url', 'b64_json']).optional(),
  input_fidelity: z.enum(['high', 'low']).optional(),
  moderation: z.enum(['low', 'auto']).optional(),
  style: z.enum(['vivid', 'natural']).optional(),
});

function validParameterKeys(values: object): boolean {
  const keys = Object.keys(values);
  return (
    keys.length <= IMAGE_PARAMETER_CONTRACT_LIMITS.definitions &&
    keys.every(isSafeImageParameterKey)
  );
}

export const imageParameterValuesSchema = standardParametersSchema
  .catchall(imageParameterScalarSchema)
  .refine(validParameterKeys, 'Invalid image parameter keys.');
export const imageGenerateParameterValuesSchema = standardParametersSchema
  .extend({ input_fidelity: unavailableParameterSchema })
  .catchall(imageParameterScalarSchema)
  .refine(validParameterKeys, 'Invalid image parameter keys.');
export const imageEditParameterValuesSchema = standardParametersSchema
  .extend({
    moderation: unavailableParameterSchema,
    style: unavailableParameterSchema,
    quality: qualitySchema.exclude(['hd']).optional(),
  })
  .catchall(imageParameterScalarSchema)
  .refine(validParameterKeys, 'Invalid image parameter keys.');
const operationParameters = {
  generate: new Map<string, z.ZodType>(
    Object.entries(imageGenerateParameterValuesSchema.shape)
  ),
  edit: new Map<string, z.ZodType>(
    Object.entries(imageEditParameterValuesSchema.shape)
  ),
};

export function imageParameterContract(
  key: string,
  operation: ImageParameterOperation
) {
  const schema = operationParameters[operation].get(key);
  if (!schema) return undefined;
  return {
    available: schema !== unavailableParameterSchema,
    type: key === 'n' || key === 'output_compression' ? 'integer' : 'string',
    schema,
  };
}
