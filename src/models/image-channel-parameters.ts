import { z } from 'zod';

export const IMAGE_OPERATIONS = ['generate', 'edit'] as const;
const IMAGE_PARAMETER_STATUSES = [
  'verified',
  'unverified',
  'unsupported',
] as const;
const IMAGE_PARAMETER_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
] as const;
export const IMAGE_PARAMETER_LIMITS = {
  definitions: 64,
  values: 100,
  key: 80,
  label: 200,
  text: 2048,
  requiredLength: 1,
  maximumImages: 16,
  maximumCompression: 100,
} as const;
export type ImageOperation = (typeof IMAGE_OPERATIONS)[number];
export type ImageChannelParameterValue = string | number | boolean;
export type ImageChannelParameterValues = Record<
  string,
  ImageChannelParameterValue
>;
export const imageOperationSchema = z.enum(IMAGE_OPERATIONS);
export const imageParameterStatusSchema = z.enum(IMAGE_PARAMETER_STATUSES);
const imageChannelParameterValueSchema = z.union([
  z.string().max(IMAGE_PARAMETER_LIMITS.text),
  z.number().finite().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  z.boolean(),
]);
const RESERVED_PARAMETER_KEYS = new Set([
  'model',
  'prompt',
  'image',
  'images',
  'image_url',
  'image_urls',
  'image[]',
  'mask',
  'api_key',
  'apikey',
  'authorization',
  'headers',
  'base_url',
  'baseURL',
  'url',
  'stream',
  'streaming',
  'user',
  'extra_body',
  'extra_headers',
  'request_options',
  '__proto__',
  'constructor',
  'prototype',
]);
const parameterKeySchema = z
  .string()
  .min(IMAGE_PARAMETER_LIMITS.requiredLength)
  .max(IMAGE_PARAMETER_LIMITS.key)
  .regex(/^[a-z][a-z0-9_]*$/)
  .refine(
    (key) => !RESERVED_PARAMETER_KEYS.has(key),
    'Reserved image parameter.'
  );
const parameterDefinitionSchema = z.strictObject({
  key: parameterKeySchema,
  label: z
    .string()
    .trim()
    .min(IMAGE_PARAMETER_LIMITS.requiredLength)
    .max(IMAGE_PARAMETER_LIMITS.label),
  type: z.enum(IMAGE_PARAMETER_TYPES),
  status: imageParameterStatusSchema,
  operations: z
    .array(imageOperationSchema)
    .min(IMAGE_PARAMETER_LIMITS.requiredLength)
    .max(IMAGE_OPERATIONS.length),
  required: z.boolean(),
  defaultValue: imageChannelParameterValueSchema.optional(),
  values: z
    .array(imageChannelParameterValueSchema)
    .min(IMAGE_PARAMETER_LIMITS.requiredLength)
    .max(IMAGE_PARAMETER_LIMITS.values)
    .optional(),
  minimum: z
    .number()
    .finite()
    .min(Number.MIN_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  maximum: z
    .number()
    .finite()
    .min(Number.MIN_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;

function matchesType(
  definition: ParameterDefinition,
  value: ImageChannelParameterValue
): boolean {
  if (definition.type === 'integer')
    return typeof value === 'number' && Number.isSafeInteger(value);
  return typeof value === definition.type;
}

export function matchesImageChannelParameter(
  definition: ParameterDefinition,
  value: ImageChannelParameterValue
): boolean {
  if (!matchesType(definition, value)) return false;
  if (definition.values && !definition.values.includes(value)) return false;
  if (typeof value !== 'number') return true;
  return (
    (definition.minimum === undefined || value >= definition.minimum) &&
    (definition.maximum === undefined || value <= definition.maximum)
  );
}

function validParameterBounds(definition: ParameterDefinition): boolean {
  const numeric = definition.type === 'integer' || definition.type === 'number';
  if (
    !numeric &&
    (definition.minimum !== undefined || definition.maximum !== undefined)
  )
    return false;
  return (definition.minimum ?? -Infinity) <= (definition.maximum ?? Infinity);
}

function hasValidParameterShape(definition: ParameterDefinition): boolean {
  if (new Set(definition.operations).size !== definition.operations.length)
    return false;
  if (
    definition.values &&
    new Set(definition.values).size !== definition.values.length
  )
    return false;
  const values = [...(definition.values ?? [])];
  if (definition.defaultValue !== undefined)
    values.push(definition.defaultValue);
  return values.every((value) =>
    matchesImageChannelParameter(definition, value)
  );
}

function validStandardParameter(definition: ParameterDefinition): boolean {
  if (definition.key === 'n')
    return validIntegerRange(
      definition,
      1,
      IMAGE_PARAMETER_LIMITS.maximumImages
    );
  if (definition.key === 'output_compression')
    return validIntegerRange(
      definition,
      0,
      IMAGE_PARAMETER_LIMITS.maximumCompression
    );
  if (STANDARD_STRING_PARAMETERS.has(definition.key))
    return definition.type === 'string';
  return true;
}
const STANDARD_STRING_PARAMETERS = new Set([
  'size',
  'quality',
  'output_format',
  'background',
  'response_format',
  'moderation',
  'input_fidelity',
]);

function validIntegerRange(
  definition: ParameterDefinition,
  minimum: number,
  maximum: number
): boolean {
  if (definition.type !== 'integer') return false;
  if (definition.values)
    return definition.values.every(
      (value) =>
        typeof value === 'number' && value >= minimum && value <= maximum
    );
  return (
    definition.minimum !== undefined &&
    definition.maximum !== undefined &&
    definition.minimum >= minimum &&
    definition.maximum <= maximum
  );
}

export const imageChannelParameterSchema = parameterDefinitionSchema
  .refine(validParameterBounds, 'Invalid image parameter bounds.')
  .refine(
    hasValidParameterShape,
    'Invalid image parameter type, range, values or default.'
  )
  .refine(
    validStandardParameter,
    'Invalid standard image parameter definition.'
  );
export type ImageChannelParameter = z.infer<typeof imageChannelParameterSchema>;
export const imageChannelParametersSchema = z
  .array(imageChannelParameterSchema)
  .max(IMAGE_PARAMETER_LIMITS.definitions)
  .refine((definitions) => {
    const identities = definitions.flatMap((definition) =>
      definition.operations.map((operation) => operation + ':' + definition.key)
    );
    return new Set(identities).size === identities.length;
  }, 'Image parameters must be unique within each operation.');
export const imageChannelParameterValuesSchema = z
  .record(parameterKeySchema, imageChannelParameterValueSchema)
  .refine(
    (values) =>
      Object.keys(values).length <= IMAGE_PARAMETER_LIMITS.definitions,
    'Too many image parameters.'
  );

function resolveParameterValue(
  definition: ImageChannelParameter,
  input: ImageChannelParameterValues
): ImageChannelParameterValue | undefined {
  const value = Object.hasOwn(input, definition.key)
    ? input[definition.key]
    : definition.defaultValue;
  if (value === undefined && definition.required)
    throw new Error(
      'Missing required image parameter: ' + definition.key + '.'
    );
  if (value !== undefined && !matchesImageChannelParameter(definition, value))
    throw new Error('Invalid image parameter: ' + definition.key + '.');
  return value;
}

export function validateImageChannelParameters(
  definitions: readonly ImageChannelParameter[],
  operation: ImageOperation,
  input: unknown
): ImageChannelParameterValues {
  const values = imageChannelParameterValuesSchema.parse(input);
  const active = definitions.filter(
    (definition) =>
      definition.operations.includes(operation) &&
      definition.status === 'verified'
  );
  const allowed = new Set(active.map((definition) => definition.key));
  for (const key of Object.keys(values)) {
    if (!allowed.has(key))
      throw new Error('Image parameter is unavailable: ' + key + '.');
  }
  const result: ImageChannelParameterValues = {};
  for (const definition of active) {
    const value = resolveParameterValue(definition, values);
    if (value !== undefined) result[definition.key] = value;
  }
  return result;
}
