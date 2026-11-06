import { WORKFLOW_IMAGE_ROUTING_SIZE_ERROR } from '../workflow-image-model-routing';
import type { KeyboardEvent } from 'react';
import { z } from 'zod';
import { generateId } from '@/platform/id';
import { IMAGE_MODELS, isBuiltinTextToImageModel } from '@/models/models';
import {
  IMAGE_CHANNEL_PROTOCOL,
  configuredImageModelIdSchema,
  saveChannelImageModelSchema,
  saveImageChannelSchema,
} from '@/models/image-channels';
import type {
  ChannelImageModel,
  ImageChannel,
  ImageChannelModelCandidate,
} from '@/models/image-channels';
import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';
import type {
  ImageChannelParameter,
  ImageOperation,
} from '@/models/image-channel-parameters';

const CUSTOM_IMAGE_PREFIX = 'custom-image:';
export const CUSTOM_IMAGE_MODEL_OPTION = '__custom_image_model__';
export const IMAGE_FORM_NUMBER_STEP = 'any';
export const IMAGE_FORM_INTEGER_STEP = 1;
export const IMAGE_FORM_MINIMUM = 0;
export const IMAGE_FORM_TEXT_ROWS = 3;
export const IMAGE_VERIFICATION_OPTIONS = [
  { value: 'unverified', label: 'Unverified' },
  { value: 'verified', label: 'Verified' },
  { value: 'unsupported', label: 'Unsupported' },
] as const;
export const IMAGE_OPERATION_OPTIONS = [
  { value: 'generate', label: 'Generate' },
  { value: 'edit', label: 'Edit' },
] as const;
export const IMAGE_PARAMETER_TYPE_OPTIONS = [
  { value: 'string', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
] as const;
export const IMAGE_PARAMETER_PRESETS = [
  { key: 'size', label: 'Image size', type: 'string' },
  { key: 'quality', label: 'Quality', type: 'string' },
  { key: 'n', label: 'Image count', type: 'integer' },
  { key: 'output_format', label: 'Output format', type: 'string' },
  { key: 'output_compression', label: 'Output compression', type: 'integer' },
  { key: 'background', label: 'Background', type: 'string' },
  { key: 'moderation', label: 'Moderation', type: 'string' },
  { key: 'input_fidelity', label: 'Input fidelity', type: 'string' },
  { key: 'response_format', label: 'Response format', type: 'string' },
  { key: '', label: 'Custom parameter', type: 'string' },
] as const;
export type ImageFormIssue = { path: string; message: string };
export type ImageParameterRow = {
  rowId: string;
  parameter: ImageChannelParameter;
};

export function createImageChannelDraft(channel?: ImageChannel) {
  return {
    id: channel?.id ?? generateId(),
    name: channel?.name ?? '',
    baseUrl: channel?.baseUrl ?? '',
    protocol: IMAGE_CHANNEL_PROTOCOL,
    enabled: channel?.enabled ?? false,
  };
}

export function createImageModelDraft(
  channelId = '',
  candidate?: ImageChannelModelCandidate
): ChannelImageModel {
  return {
    id: configuredImageModelIdSchema.parse(CUSTOM_IMAGE_PREFIX + generateId()),
    name: candidate?.name ?? '',
    description: candidate?.description ?? '',
    channelId,
    enabled: false,
    operations: candidate
      ? {
          generate: {
            upstreamModel: candidate.upstreamModel,
            status: 'unverified',
            minReferenceImages: 0,
            maxReferenceImages: 0,
            mask: 'unsupported',
          },
        }
      : {},
    parameters: [],
    priceCards: [],
  };
}

export function imageModelBindingOptions(
  models: readonly ChannelImageModel[],
  currentId: string
) {
  return Object.keys(IMAGE_MODELS)
    .filter(isBuiltinTextToImageModel)
    .map((id) => ({
      value: id,
      label: IMAGE_MODELS[id].name + ' (' + id + ')',
      disabled: id !== currentId && models.some((model) => model.id === id),
    }));
}

export function imageModelBindingIdentity(
  model: ChannelImageModel,
  choice: string
) {
  return isBuiltinTextToImageModel(choice)
    ? { id: choice, name: IMAGE_MODELS[choice].name, builtin: true }
    : { id: model.id, name: model.name, builtin: false };
}

export function createImageParameterRow(preset = ''): ImageParameterRow {
  const definition = IMAGE_PARAMETER_PRESETS.find(
    (item) => item.key === preset
  );
  const parameter: ImageChannelParameter = {
    key: definition?.key ?? '',
    label: definition?.label ?? '',
    type: definition?.type ?? 'string',
    status: 'unverified',
    operations: ['generate'],
    required: false,
  };
  if (preset === 'n') {
    parameter.minimum = IMAGE_FORM_INTEGER_STEP;
    parameter.maximum = IMAGE_PARAMETER_LIMITS.maximumImages;
  }
  if (preset === 'output_compression') {
    parameter.minimum = IMAGE_FORM_MINIMUM;
    parameter.maximum = IMAGE_PARAMETER_LIMITS.maximumCompression;
  }
  return { rowId: generateId(), parameter };
}

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
function optionalNumber(data: FormData, key: string) {
  const value = text(data, key).trim();
  return value ? Number(value) : undefined;
}
function scalar(value: string, type: string) {
  if (type === 'number' || type === 'integer')
    return value.trim() ? Number(value) : NaN;
  if (type === 'boolean' && value === 'true') return true;
  if (type === 'boolean' && value === 'false') return false;
  return value;
}

export function readImageChannelForm(data: FormData, revision: number) {
  const apiKey = text(data, 'apiKey').trim();
  return saveImageChannelSchema.safeParse({
    revision,
    id: text(data, 'id'),
    name: text(data, 'name'),
    baseUrl: text(data, 'baseUrl'),
    protocol: IMAGE_CHANNEL_PROTOCOL,
    enabled: data.has('enabled'),
    ...(apiKey ? { apiKey } : {}),
  });
}

function readOperation(data: FormData, operation: ImageOperation) {
  const field = (name: string) => operation + '.' + name;
  if (!data.has(field('configured'))) return undefined;
  return {
    upstreamModel: text(data, field('upstreamModel')),
    status: text(data, field('status')),
    minReferenceImages:
      operation === 'generate' ? 0 : Number(text(data, field('minimum'))),
    maxReferenceImages:
      operation === 'generate' ? 0 : Number(text(data, field('maximum'))),
    mask: operation === 'generate' ? 'unsupported' : text(data, field('mask')),
  };
}

function readParameter(data: FormData, id: string) {
  const field = (name: string) => 'parameter.' + id + '.' + name;
  const type = text(data, field('type'));
  const values = text(data, field('values'))
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    key: text(data, field('key')),
    label: text(data, field('label')),
    type,
    status: text(data, field('status')),
    operations: IMAGE_OPERATION_OPTIONS.filter((item) =>
      data.has(field(item.value))
    ).map((item) => item.value),
    required: data.has(field('required')),
    ...(data.has(field('useDefault'))
      ? { defaultValue: scalar(text(data, field('default')), type) }
      : {}),
    ...(values.length
      ? { values: values.map((value) => scalar(value, type)) }
      : {}),
    minimum: optionalNumber(data, field('minimum')),
    maximum: optionalNumber(data, field('maximum')),
  };
}

const jsonMatchSchema = z.string().transform((value, context): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'Enter a valid JSON object for the price match.',
    });
    return z.NEVER;
  }
});

function readPriceCard(data: FormData, id: string) {
  const field = (name: string) => 'price.' + id + '.' + name;
  const match = jsonMatchSchema.safeParse(text(data, field('match')));
  return {
    id,
    operation: text(data, field('operation')),
    match: match.success ? match.data : text(data, field('match')),
    unitPriceUsd: optionalNumber(data, field('unitPriceUsd')),
    ...(data.has(field('supplierCost'))
      ? {
          supplierCost: {
            currency: text(data, field('currency')),
            unitPrice: optionalNumber(data, field('unitCost')),
          },
        }
      : {}),
  };
}

export function readImageModelForm(data: FormData, revision: number) {
  return saveChannelImageModelSchema.safeParse({
    revision,
    id: text(data, 'id'),
    name: text(data, 'name'),
    description: text(data, 'description').trim() || undefined,
    channelId: text(data, 'channelId'),
    enabled: data.has('enabled'),
    operations: {
      generate: readOperation(data, 'generate'),
      edit: readOperation(data, 'edit'),
    },
    parameters: data
      .getAll('parameterId')
      .map((id) => readParameter(data, typeof id === 'string' ? id : '')),
    priceCards: data
      .getAll('priceId')
      .map((id) => readPriceCard(data, typeof id === 'string' ? id : '')),
  });
}

export function imageFormIssues(error: z.ZodError): ImageFormIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message:
      issue.code === 'custom'
        ? issue.message
        : 'Check this field and its allowed values.',
  }));
}

const IMAGE_SAVE_ERROR_MESSAGES = new Set([
  WORKFLOW_IMAGE_ROUTING_SIZE_ERROR,
  'Image channel settings changed. Reload before saving.',
  'Provide a new API key when changing a channel base URL.',
  'Save an API key before enabling an image channel.',
  'Create a new image model identifier when changing an upstream model.',
  'Select an existing image channel.',
]);

export function imageSaveErrorMessage(error: Error): string {
  return IMAGE_SAVE_ERROR_MESSAGES.has(error.message)
    ? error.message
    : 'Could not save changes.';
}

export function submitImageTextareaOnShortcut(
  event: KeyboardEvent<HTMLTextAreaElement>
) {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}
