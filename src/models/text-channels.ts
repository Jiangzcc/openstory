import { z } from 'zod';
import { SCRIPT_ANALYSIS_MODELS } from './models.config';

export const TEXT_CHANNEL_PROTOCOLS = {
  chatCompletions: 'openai-chat-completions',
  responses: 'openai-responses',
} as const;
export const TEXT_CHANNEL_PROTOCOL = TEXT_CHANNEL_PROTOCOLS.chatCompletions;
export const DEFAULT_TEXT_CHANNEL_USER_AGENT = 'OpenStory/0.1.0';
const TEXT_CHANNEL_INITIAL_REVISION = 0;
export const TEXT_CHANNEL_LIMITS = {
  requiredLength: 1,
  id: 200,
  name: 200,
  baseUrl: 2_048,
  upstreamModel: 300,
  description: 2_000,
  apiKey: 8_192,
  userAgent: 256,
  models: 100,
  channels: 100,
} as const;

type BuiltinTextModelId = (typeof SCRIPT_ANALYSIS_MODELS)[number]['id'];
export type CustomTextModelId = `custom:${string}`;
export type TextModelId = BuiltinTextModelId | CustomTextModelId;
export type TextChannelProtocol =
  (typeof TEXT_CHANNEL_PROTOCOLS)[keyof typeof TEXT_CHANNEL_PROTOCOLS];

const identifierSchema = z
  .string()
  .trim()
  .min(TEXT_CHANNEL_LIMITS.requiredLength)
  .max(TEXT_CHANNEL_LIMITS.id)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const labelSchema = z
  .string()
  .trim()
  .min(TEXT_CHANNEL_LIMITS.requiredLength)
  .max(TEXT_CHANNEL_LIMITS.name);
const revisionSchema = z.number().int().nonnegative().safe();
const tokenLimitSchema = z.number().int().positive().safe();
const rateSchema = z.number().finite().nonnegative();

export function isCustomTextModelId(
  value: unknown
): value is CustomTextModelId {
  return (
    typeof value === 'string' &&
    /^custom:[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) &&
    value.length <= TEXT_CHANNEL_LIMITS.id
  );
}

const textModelIdSchema = z.custom<TextModelId>(
  (value) =>
    isCustomTextModelId(value) ||
    SCRIPT_ANALYSIS_MODELS.some((model) => model.id === value),
  'Select a built-in text model or use a custom: model identifier.'
);

const ASCII_SPACE = 32;
const ASCII_DELETE = 127;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < ASCII_SPACE || code === ASCII_DELETE) return true;
  }
  return false;
}

const TEXT_CHANNEL_LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

function permitsTextChannelProtocol(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' && TEXT_CHANNEL_LOOPBACK_HOSTS.has(url.hostname)
  );
}

function isTextChannelBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = value.split('/')[2] ?? '';
    const rejected = [
      url.username,
      url.password,
      url.search,
      url.hash,
      /[?#\\]/.test(value),
      authority.includes('@'),
      hasControlCharacters(value),
    ];
    return (
      /^https?:\/\//i.test(value) &&
      permitsTextChannelProtocol(url) &&
      Boolean(url.hostname) &&
      !rejected.some(Boolean)
    );
  } catch {
    return false;
  }
}

export const textChannelBaseUrlSchema = z
  .string()
  .trim()
  .min(TEXT_CHANNEL_LIMITS.requiredLength)
  .max(TEXT_CHANNEL_LIMITS.baseUrl)
  .refine(
    isTextChannelBaseUrl,
    'Use HTTPS, or HTTP on localhost, without credentials, query or fragment.'
  )
  .transform((value) => new URL(value).toString().replace(/\/+$/, ''))
  .pipe(z.string().max(TEXT_CHANNEL_LIMITS.baseUrl));

const channelFields = {
  id: identifierSchema,
  name: labelSchema,
  baseUrl: textChannelBaseUrlSchema,
  protocol: z.enum(TEXT_CHANNEL_PROTOCOLS),
  userAgent: z
    .string()
    .max(TEXT_CHANNEL_LIMITS.userAgent)
    .regex(/^[\x20-\x7e]*$/, 'Use printable ASCII characters for User-Agent.')
    .transform((value) => value.trim())
    .optional(),
  enabled: z.boolean(),
};

export function resolveTextChannelUserAgent(userAgent?: string): string {
  return userAgent?.trim() || DEFAULT_TEXT_CHANNEL_USER_AGENT;
}

const textChannelSchema = z
  .strictObject({
    ...channelFields,
    credentialId: identifierSchema.nullable(),
    keyHint: z.string().nullable(),
    hasKey: z.boolean(),
  })
  .refine(
    (channel) =>
      channel.hasKey === Boolean(channel.credentialId) &&
      channel.hasKey === Boolean(channel.keyHint),
    'Invalid channel credential metadata.'
  );
export type TextChannel = z.infer<typeof textChannelSchema>;

export const saveTextChannelSchema = z.strictObject({
  revision: revisionSchema,
  ...channelFields,
  apiKey: z
    .string()
    .trim()
    .max(TEXT_CHANNEL_LIMITS.apiKey)
    .refine((value) => !hasControlCharacters(value), 'Invalid channel API key.')
    .optional(),
});
export type SaveTextChannelInput = z.infer<typeof saveTextChannelSchema>;

export const textChannelUpstreamModelSchema = z
  .string()
  .trim()
  .min(TEXT_CHANNEL_LIMITS.requiredLength)
  .max(TEXT_CHANNEL_LIMITS.upstreamModel)
  .refine(
    (value) => !hasControlCharacters(value),
    'Invalid upstream model identifier.'
  );

type BindingCapabilities = {
  id: TextModelId;
  enabled: boolean;
  structuredOutput: boolean;
  tools: boolean;
  vision: boolean;
};

function preservesBuiltinCapabilities(model: BindingCapabilities): boolean {
  if (!model.enabled) return true;
  const builtin = SCRIPT_ANALYSIS_MODELS.find((entry) => entry.id === model.id);
  if (!builtin) return true;
  return (
    model.structuredOutput && model.tools && (!builtin.vision || model.vision)
  );
}

export const channelTextModelSchema = z
  .strictObject({
    id: textModelIdSchema,
    name: labelSchema,
    channelId: identifierSchema,
    upstreamModel: textChannelUpstreamModelSchema,
    enabled: z.boolean(),
    vision: z.boolean(),
    structuredOutput: z.boolean(),
    tools: z.boolean(),
    contextWindow: tokenLimitSchema,
    maxOutputTokens: tokenLimitSchema,
    inputPricePerMillion: rateSchema,
    outputPricePerMillion: rateSchema,
    description: z
      .string()
      .trim()
      .max(TEXT_CHANNEL_LIMITS.description)
      .optional(),
    vendor: labelSchema.optional(),
  })
  .refine(
    (model) => model.maxOutputTokens <= model.contextWindow,
    'Maximum output tokens must not exceed the context window.'
  )
  .refine(
    preservesBuiltinCapabilities,
    'Built-in text model bindings must preserve structured output, tools, and vision support.'
  );
export type ChannelTextModel = z.infer<typeof channelTextModelSchema>;

export const saveChannelTextModelSchema = channelTextModelSchema.safeExtend({
  revision: revisionSchema,
});
export type SaveChannelTextModelInput = z.infer<
  typeof saveChannelTextModelSchema
>;

export const syncTextChannelModelsSchema = z.strictObject({
  channelId: identifierSchema,
});
export type SyncTextChannelModelsInput = z.infer<
  typeof syncTextChannelModelsSchema
>;

export const textChannelsConfigurationSchema = z
  .strictObject({
    revision: revisionSchema,
    channels: z.array(textChannelSchema).max(TEXT_CHANNEL_LIMITS.channels),
    models: z.array(channelTextModelSchema).max(TEXT_CHANNEL_LIMITS.models),
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
  }, 'Model bindings must reference unique, configured channels.');
export type TextChannelsConfiguration = z.infer<
  typeof textChannelsConfigurationSchema
>;

export type TextModelRoute = Omit<ChannelTextModel, 'id' | 'enabled'> & {
  modelId: TextModelId;
  protocol: TextChannelProtocol;
  baseUrl: string;
  credentialId: string;
  userAgent?: string;
};
export type TextModelRoutingSnapshot = readonly TextModelRoute[];
export type TextModelCatalogEntry = Omit<
  ChannelTextModel,
  'channelId' | 'upstreamModel' | 'enabled'
>;
export type TextModelCatalog = TextModelCatalogEntry[];
export type TextChannelModelCandidate = {
  upstreamModel: string;
  name: string;
  description?: string;
  vendor?: string;
};
export type TextChannelModelsSyncResult = {
  channelId: string;
  candidates: TextChannelModelCandidate[];
};

export function emptyTextChannelsConfiguration(): TextChannelsConfiguration {
  return { revision: TEXT_CHANNEL_INITIAL_REVISION, channels: [], models: [] };
}

export function createTextModelRoutingSnapshot(
  configuration: TextChannelsConfiguration
): TextModelRoutingSnapshot {
  const channels = new Map(
    configuration.channels.map((channel) => [channel.id, channel])
  );
  return configuration.models.flatMap((model) => {
    const channel = channels.get(model.channelId);
    if (!model.enabled || !channel?.enabled || !channel.credentialId) return [];
    const { id, enabled: _enabled, ...binding } = model;
    const { protocol, baseUrl, credentialId } = channel;
    return [
      {
        ...binding,
        modelId: id,
        protocol,
        baseUrl,
        credentialId,
        userAgent: resolveTextChannelUserAgent(channel.userAgent),
      },
    ];
  });
}

export function toTextModelCatalog(
  snapshot: TextModelRoutingSnapshot
): TextModelCatalog {
  return snapshot.map((model) => ({
    id: model.modelId,
    name: model.name,
    vision: model.vision,
    structuredOutput: model.structuredOutput,
    tools: model.tools,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    inputPricePerMillion: model.inputPricePerMillion,
    outputPricePerMillion: model.outputPricePerMillion,
    ...(model.description === undefined
      ? {}
      : { description: model.description }),
    ...(model.vendor === undefined ? {} : { vendor: model.vendor }),
  }));
}

export function resolveTextModelRoute(
  snapshot: TextModelRoutingSnapshot | undefined,
  modelId: string
): TextModelRoute | undefined {
  const route = snapshot?.find((model) => model.modelId === modelId);
  if (route) return route;
  if (modelId.startsWith('custom:'))
    throw new Error('Custom text model is unavailable.');
  return undefined;
}
