import { z } from 'zod';
import { isBuiltinTextToImageModel } from './models';
import type { BuiltinTextToImageModel } from './models';
import {
  imageChannelParametersSchema,
  saveImageChannelParametersSchema,
  imageChannelParametersSupportOperation,
  imageParameterStatusSchema,
  IMAGE_OPERATIONS,
  IMAGE_PARAMETER_LIMITS,
  matchesImageChannelParameter,
} from './image-channel-parameters';
import {
  imageChannelPriceCardsSchema,
  imageUnitPriceFitsWallet,
} from './image-channel-pricing';
import type {
  ImageChannelParameter,
  ImageOperation,
} from './image-channel-parameters';

export const IMAGE_CHANNEL_PROTOCOL = 'openai-images' as const;
export const IMAGE_CHANNEL_LIMITS = {
  initialRevision: 0,
  requiredLength: 1,
  id: 200,
  name: 200,
  description: 2000,
  baseUrl: 2048,
  upstreamModel: 300,
  apiKey: 8192,
  channels: 100,
  models: 200,
} as const;
export type ConfiguredImageModelId = `custom-image:${string}`;
export type ImageChannelModelId =
  | BuiltinTextToImageModel
  | ConfiguredImageModelId;
type ImageChannelProtocol = typeof IMAGE_CHANNEL_PROTOCOL;
const identifierSchema = z
  .string()
  .trim()
  .min(IMAGE_CHANNEL_LIMITS.requiredLength)
  .max(IMAGE_CHANNEL_LIMITS.id)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const labelSchema = z
  .string()
  .trim()
  .min(IMAGE_CHANNEL_LIMITS.requiredLength)
  .max(IMAGE_CHANNEL_LIMITS.name);
const revisionSchema = z.number().int().nonnegative().safe();
const ASCII_SPACE = 32;
const ASCII_DELETE = 127;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < ASCII_SPACE || code === ASCII_DELETE) return true;
  }
  return false;
}

export function isConfiguredImageModelId(
  value: unknown
): value is ConfiguredImageModelId {
  return (
    typeof value === 'string' &&
    value.length <= IMAGE_CHANNEL_LIMITS.id &&
    /^custom-image:[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value)
  );
}
export const configuredImageModelIdSchema = z.custom<ConfiguredImageModelId>(
  isConfiguredImageModelId,
  'Use a custom-image: model identifier.'
);
export const imageChannelModelIdSchema = z.custom<ImageChannelModelId>(
  (value) =>
    isBuiltinTextToImageModel(value) || isConfiguredImageModelId(value),
  'Select a built-in image model or use a custom-image: model identifier.'
);

function isImageChannelBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const protocol =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
    const rejected = [
      url.username,
      url.password,
      url.search,
      url.hash,
      /[?#\\]/.test(value),
      (value.split('/')[2] ?? '').includes('@'),
      hasControlCharacters(value),
    ];
    return (
      /^https?:\/\//i.test(value) &&
      protocol &&
      Boolean(url.hostname) &&
      !rejected.some(Boolean)
    );
  } catch {
    return false;
  }
}
export const imageChannelBaseUrlSchema = z
  .string()
  .trim()
  .min(IMAGE_CHANNEL_LIMITS.requiredLength)
  .max(IMAGE_CHANNEL_LIMITS.baseUrl)
  .refine(
    isImageChannelBaseUrl,
    'Use HTTPS, or HTTP on localhost, without credentials, query or fragment.'
  )
  .transform((value) => new URL(value).toString().replace(/\/+$/, ''))
  .pipe(z.string().max(IMAGE_CHANNEL_LIMITS.baseUrl));
const channelFields = {
  id: identifierSchema,
  name: labelSchema,
  baseUrl: imageChannelBaseUrlSchema,
  protocol: z.literal(IMAGE_CHANNEL_PROTOCOL),
  enabled: z.boolean(),
};
const imageChannelSchema = z
  .strictObject({
    ...channelFields,
    credentialId: z.ulid().nullable(),
    keyHint: z.string().nullable(),
    hasKey: z.boolean(),
  })
  .refine(
    (channel) =>
      channel.hasKey === Boolean(channel.credentialId) &&
      channel.hasKey === Boolean(channel.keyHint),
    'Invalid channel credential metadata.'
  );
export type ImageChannel = z.infer<typeof imageChannelSchema>;
export const saveImageChannelSchema = z.strictObject({
  revision: revisionSchema,
  ...channelFields,
  apiKey: z
    .string()
    .trim()
    .max(IMAGE_CHANNEL_LIMITS.apiKey)
    .refine((value) => !hasControlCharacters(value), 'Invalid channel API key.')
    .optional(),
});
export type SaveImageChannelInput = z.infer<typeof saveImageChannelSchema>;
export const imageChannelUpstreamModelSchema = z
  .string()
  .trim()
  .min(IMAGE_CHANNEL_LIMITS.requiredLength)
  .max(IMAGE_CHANNEL_LIMITS.upstreamModel)
  .refine(
    (value) => !hasControlCharacters(value),
    'Invalid upstream image model identifier.'
  );
const imageOperationBindingSchema = z
  .strictObject({
    upstreamModel: imageChannelUpstreamModelSchema,
    status: imageParameterStatusSchema,
    minReferenceImages: z
      .number()
      .int()
      .nonnegative()
      .max(IMAGE_PARAMETER_LIMITS.maximumImages),
    maxReferenceImages: z
      .number()
      .int()
      .nonnegative()
      .max(IMAGE_PARAMETER_LIMITS.maximumImages),
    mask: imageParameterStatusSchema,
  })
  .refine(
    (binding) => binding.minReferenceImages <= binding.maxReferenceImages,
    'Minimum reference count must not exceed the maximum.'
  );
export type ImageOperationBinding = z.infer<typeof imageOperationBindingSchema>;
const operationsSchema = z
  .strictObject({
    generate: imageOperationBindingSchema.optional(),
    edit: imageOperationBindingSchema.optional(),
  })
  .refine(
    (operations) => Boolean(operations.generate || operations.edit),
    'Configure an image operation.'
  )
  .refine(
    (operations) =>
      !operations.generate ||
      (operations.generate.minReferenceImages === 0 &&
        operations.generate.maxReferenceImages === 0 &&
        operations.generate.mask === 'unsupported'),
    'Generation cannot accept reference images or masks.'
  )
  .refine(
    (operations) => !operations.edit || operations.edit.minReferenceImages > 0,
    'Editing requires at least one reference image.'
  );
const modelFields = {
  id: imageChannelModelIdSchema,
  name: labelSchema,
  description: z
    .string()
    .trim()
    .max(IMAGE_CHANNEL_LIMITS.description)
    .optional(),
  channelId: identifierSchema,
  enabled: z.boolean(),
  operations: operationsSchema,
  parameters: imageChannelParametersSchema,
  priceCards: imageChannelPriceCardsSchema,
};

function validPriceMatches(
  model: z.infer<z.ZodObject<typeof modelFields>>
): boolean {
  return model.priceCards.every(
    (card) =>
      Boolean(model.operations[card.operation]) &&
      Object.entries(card.match).every(([key, value]) => {
        const definition = model.parameters.find(
          (parameter) =>
            parameter.key === key &&
            parameter.operations.includes(card.operation)
        );
        return Boolean(
          definition && matchesImageChannelParameter(definition, value)
        );
      })
  );
}

function configuredOperationsHavePrices(
  model: z.infer<z.ZodObject<typeof modelFields>>
): boolean {
  if (!model.enabled) return true;
  return IMAGE_OPERATIONS.every(
    (operation) =>
      model.operations[operation]?.status !== 'verified' ||
      model.priceCards.some((card) => card.operation === operation)
  );
}
export const channelImageModelSchema = z
  .strictObject(modelFields)
  .refine(
    (model) =>
      model.parameters.every((parameter) =>
        parameter.operations.every((operation) =>
          Boolean(model.operations[operation])
        )
      ),
    'Parameters must reference configured operations.'
  )
  .refine(
    validPriceMatches,
    'Price matches must reference configured parameter values and operations.'
  )
  .refine(
    configuredOperationsHavePrices,
    'Every enabled verified operation needs a configured USD price.'
  );
export type ChannelImageModel = z.infer<typeof channelImageModelSchema>;
function validateEnabledImageParameters(
  model: ChannelImageModel,
  context: z.RefinementCtx
) {
  if (!model.enabled) return;
  const parameters = saveImageChannelParametersSchema.safeParse(
    model.parameters
  );
  if (!parameters.success) {
    for (const issue of parameters.error.issues)
      context.addIssue({ ...issue, path: ['parameters', ...issue.path] });
  }
}

export const saveChannelImageModelSchema = channelImageModelSchema
  .safeExtend({
    revision: revisionSchema,
  })
  .superRefine(validateEnabledImageParameters)
  .refine(
    (model) =>
      !model.enabled ||
      model.priceCards.every((card) =>
        imageUnitPriceFitsWallet(card.unitPriceUsd)
      ),
    {
      message: 'The configured price is outside wallet precision.',
      path: ['priceCards'],
    }
  );
export type SaveChannelImageModelInput = z.infer<
  typeof saveChannelImageModelSchema
>;
export const syncImageChannelModelsSchema = z.strictObject({
  channelId: identifierSchema,
});
export type SyncImageChannelModelsInput = z.infer<
  typeof syncImageChannelModelsSchema
>;
export const imageChannelsConfigurationSchema = z
  .strictObject({
    revision: revisionSchema,
    channels: z.array(imageChannelSchema).max(IMAGE_CHANNEL_LIMITS.channels),
    models: z.array(channelImageModelSchema).max(IMAGE_CHANNEL_LIMITS.models),
  })
  .refine((configuration) => {
    const channels = new Set(
      configuration.channels.map((channel) => channel.id)
    );
    const models = new Set(configuration.models.map((model) => model.id));
    return (
      channels.size === configuration.channels.length &&
      models.size === configuration.models.length &&
      configuration.models.every((model) => channels.has(model.channelId))
    );
  }, 'Image models must reference unique, configured channels.');
export type ImageChannelsConfiguration = z.infer<
  typeof imageChannelsConfigurationSchema
>;
export type ImageModelRoute = Omit<ChannelImageModel, 'id' | 'enabled'> & {
  modelId: ImageChannelModelId;
  protocol: ImageChannelProtocol;
  baseUrl: string;
  credentialId: string;
};
export type ImageModelRoutingSnapshot = readonly ImageModelRoute[];
export type ImageModelCatalogEntry = {
  id: ImageChannelModelId;
  name: string;
  description?: string;
  available: boolean;
  operations: Partial<
    Record<ImageOperation, Omit<ImageOperationBinding, 'upstreamModel'>>
  >;
  parameters: ImageChannelParameter[];
  priceCards: Omit<ChannelImageModel['priceCards'][number], 'supplierCost'>[];
};
export type ImageModelCatalog = ImageModelCatalogEntry[];
export type ImageChannelModelCandidate = {
  upstreamModel: string;
  name: string;
  description?: string;
  vendor?: string;
};
export type ImageChannelModelsSyncResult = {
  channelId: string;
  candidates: ImageChannelModelCandidate[];
};

export function emptyImageChannelsConfiguration(): ImageChannelsConfiguration {
  return {
    revision: IMAGE_CHANNEL_LIMITS.initialRevision,
    channels: [],
    models: [],
  };
}

export function createImageModelRoutingSnapshot(
  configuration: ImageChannelsConfiguration
): ImageModelRoutingSnapshot {
  return configuration.models.flatMap((model) => {
    const channel = configuration.channels.find(
      (entry) => entry.id === model.channelId
    );
    if (!model.enabled || channel?.enabled === false) return [];
    if (!channel?.credentialId) {
      if (isBuiltinTextToImageModel(model.id))
        throw new Error('Configured image model is unavailable.');
      return [];
    }
    if (
      isConfiguredImageModelId(model.id) &&
      !IMAGE_OPERATIONS.some(
        (operation) => model.operations[operation]?.status === 'verified'
      )
    )
      return [];
    const { id, enabled: _enabled, ...binding } = model;
    return [
      structuredClone({
        ...binding,
        modelId: id,
        protocol: channel.protocol,
        baseUrl: channel.baseUrl,
        credentialId: channel.credentialId,
      }),
    ];
  });
}

function projectImageModelCatalogEntry(
  model: Pick<
    ChannelImageModel,
    'name' | 'description' | 'operations' | 'parameters' | 'priceCards'
  >,
  id: ImageChannelModelId,
  available: boolean
): ImageModelCatalogEntry {
  const operations: ImageModelCatalogEntry['operations'] = {};
  for (const operation of IMAGE_OPERATIONS) {
    const binding = model.operations[operation];
    if (
      binding?.status !== 'verified' ||
      !imageChannelParametersSupportOperation(model.parameters, operation)
    )
      continue;
    const { upstreamModel: _upstreamModel, ...capabilities } = binding;
    operations[operation] = capabilities;
  }
  return {
    id,
    name: model.name,
    available,
    ...(model.description === undefined
      ? {}
      : { description: model.description }),
    operations,
    parameters: model.parameters.filter(
      (parameter) =>
        parameter.status === 'verified' &&
        parameter.operations.some((operation) => Boolean(operations[operation]))
    ),
    priceCards: model.priceCards
      .filter((card) => Boolean(operations[card.operation]))
      .map(({ supplierCost: _supplierCost, ...card }) => card),
  };
}

export function toImageModelCatalog(
  snapshot: ImageModelRoutingSnapshot
): ImageModelCatalog {
  return snapshot.map((route) =>
    projectImageModelCatalogEntry(route, route.modelId, true)
  );
}

export function imageModelCatalogFromConfiguration(
  configuration: ImageChannelsConfiguration
): ImageModelCatalog {
  const active = new Set(
    createImageModelRoutingSnapshot(configuration).map((route) => route.modelId)
  );
  return configuration.models
    .filter(
      (model) => isConfiguredImageModelId(model.id) || active.has(model.id)
    )
    .map((model) =>
      projectImageModelCatalogEntry(model, model.id, active.has(model.id))
    );
}

export function usesConfiguredImageChannel(
  model: unknown,
  routing?: ImageModelRoutingSnapshot
): boolean {
  return (
    isConfiguredImageModelId(model) ||
    (isBuiltinTextToImageModel(model) &&
      routing?.some((route) => route.modelId === model) === true)
  );
}

export function resolveImageModelRoute(
  snapshot: ImageModelRoutingSnapshot | undefined,
  modelId: string
): ImageModelRoute | undefined {
  const route = snapshot?.find((model) => model.modelId === modelId);
  if (route) return route;
  if (modelId.startsWith('custom-image:'))
    throw new Error('Configured image model is unavailable.');
  return undefined;
}
