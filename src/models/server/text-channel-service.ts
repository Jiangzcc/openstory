import { z } from 'zod';
import type { EncryptedApiKey } from '@/platform/server/crypto/api-key-encryption';
import {
  encryptApiKey,
  getKeyHint,
} from '@/platform/server/crypto/api-key-encryption';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';
import type {
  ChannelTextModel,
  SaveChannelTextModelInput,
  SaveTextChannelInput,
  SyncTextChannelModelsInput,
  TextChannel,
  TextChannelProtocol,
  TextChannelModelCandidate,
  TextChannelModelsSyncResult,
  TextChannelsConfiguration,
} from '../text-channels';
import {
  createTextModelRoutingSnapshot,
  saveChannelTextModelSchema,
  saveTextChannelSchema,
  syncTextChannelModelsSchema,
  textChannelsConfigurationSchema,
  toTextModelCatalog,
  TEXT_CHANNEL_LIMITS,
  TEXT_CHANNEL_PROTOCOLS,
  textChannelUpstreamModelSchema,
} from '../text-channels';

export const TEXT_CHANNEL_SYNC_TIMEOUT_MS = 15_000;
export const TEXT_CHANNEL_SYNC_MAX_BYTES = 1_048_576;
const TEXT_CHANNEL_SYNC_MAX_MODELS = 2_000;
const HTTP_OK = 200;
const HTTP_OK_MAX = 299;
const EMPTY_BYTE_COUNT = 0;
const NON_TEXT_MODEL_ID =
  /(?:^|[\s/_.:-])(embedding|embeddings|whisper|asr|tts|speech|audio|image|images|dall-e|flux|stable-diffusion|seedream|seedance|sora|veo|video|rerank|reranker|moderation)(?:$|[\s/_.:-])/i;
const TEXT_MODALITY = 'text';
const TEXT_ENDPOINT_TYPES = {
  [TEXT_CHANNEL_PROTOCOLS.chatCompletions]: 'openai',
  [TEXT_CHANNEL_PROTOCOLS.responses]: 'openai-response',
} as const;
const TEXT_MODEL_TASKS = new Set([TEXT_MODALITY, 'chat', 'completion']);

export type StoredTextChannels = {
  configuration: TextChannelsConfiguration;
  serialized: string | null;
};
export type TextChannelCredential = EncryptedApiKey & { id: string };
export type TextChannelsReadStore = {
  read: () => Promise<StoredTextChannels>;
  resolveSecret: (credentialId: string) => Promise<string>;
};
export type TextChannelsAdminStore = TextChannelsReadStore & {
  commit: (
    previous: string | null,
    next: TextChannelsConfiguration,
    credential?: TextChannelCredential
  ) => Promise<void>;
};

export function createTextChannelsReader(store: TextChannelsReadStore) {
  const get = async () => (await store.read()).configuration;
  const getSnapshot = async () => createTextModelRoutingSnapshot(await get());
  return {
    get,
    getSnapshot,
    getCatalog: async () => toTextModelCatalog(await getSnapshot()),
    resolveSecret: (credentialId: string) => store.resolveSecret(credentialId),
  };
}

function assertRevision(
  configuration: TextChannelsConfiguration,
  revision: number
) {
  if (configuration.revision !== revision) {
    throw new ConflictError(
      'Text channel settings changed. Reload before saving.'
    );
  }
}

function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((existing) => existing.id === row.id)
    ? rows.map((existing) => (existing.id === row.id ? row : existing))
    : [...rows, row];
}

function assertCredentialDestination(
  input: SaveTextChannelInput,
  previous?: TextChannel
) {
  if (!previous?.hasKey) return;
  if (previous.baseUrl === input.baseUrl) return;
  if (input.apiKey) return;
  throw new ValidationError(
    'Provide a new API key when changing a channel base URL.'
  );
}

async function prepareChannel(
  input: SaveTextChannelInput,
  previous?: TextChannel
): Promise<{ channel: TextChannel; credential?: TextChannelCredential }> {
  const { revision: _revision, apiKey, ...metadata } = input;
  assertCredentialDestination(input, previous);
  if (apiKey) {
    const credential = {
      id: crypto.randomUUID(),
      ...(await encryptApiKey(apiKey)),
    };
    const channel: TextChannel = {
      ...metadata,
      credentialId: credential.id,
      keyHint: getKeyHint(apiKey),
      hasKey: true,
    };
    return { channel, credential };
  }
  const channel: TextChannel = previous
    ? { ...previous, ...metadata }
    : { ...metadata, credentialId: null, keyHint: null, hasKey: false };
  if (channel.enabled && !channel.hasKey) {
    throw new ValidationError(
      'Save an API key before enabling a text channel.'
    );
  }
  return { channel };
}

async function saveChannel(
  store: TextChannelsAdminStore,
  value: SaveTextChannelInput
) {
  const input = saveTextChannelSchema.parse(value);
  const saved = await store.read();
  assertRevision(saved.configuration, input.revision);
  const previous = saved.configuration.channels.find(
    (channel) => channel.id === input.id
  );
  const { channel, credential } = await prepareChannel(input, previous);
  const next = textChannelsConfigurationSchema.parse({
    ...saved.configuration,
    revision: input.revision + 1,
    channels: upsertById(saved.configuration.channels, channel),
  });
  await store.commit(saved.serialized, next, credential);
  return next;
}

async function saveModel(
  store: TextChannelsAdminStore,
  value: SaveChannelTextModelInput
) {
  const { revision, ...model } = saveChannelTextModelSchema.parse(value);
  const saved = await store.read();
  assertRevision(saved.configuration, revision);
  if (
    !saved.configuration.channels.some(
      (channel) => channel.id === model.channelId
    )
  ) {
    throw new ValidationError('Select an existing text channel.');
  }
  const next = textChannelsConfigurationSchema.parse({
    ...saved.configuration,
    revision: revision + 1,
    models: upsertById<ChannelTextModel>(saved.configuration.models, model),
  });
  await store.commit(saved.serialized, next);
  return next;
}

export function createTextChannelsAdminService(store: TextChannelsAdminStore) {
  return {
    ...createTextChannelsReader(store),
    saveChannel: (input: SaveTextChannelInput) => saveChannel(store, input),
    saveModel: (input: SaveChannelTextModelInput) => saveModel(store, input),
    syncModels: (input: SyncTextChannelModelsInput) => syncModels(store, input),
  };
}

function normalizeMetadataList(value: string | string[]): string[] {
  const entries = typeof value === 'string' ? value.split(',') : value;
  return entries.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

const metadataListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform(normalizeMetadataList);

const providerModelSchema = z.object({
  id: textChannelUpstreamModelSchema,
  name: z
    .string()
    .trim()
    .min(TEXT_CHANNEL_LIMITS.requiredLength)
    .max(TEXT_CHANNEL_LIMITS.name)
    .optional(),
  description: z.string().max(TEXT_CHANNEL_LIMITS.description).optional(),
  owned_by: z
    .string()
    .trim()
    .min(TEXT_CHANNEL_LIMITS.requiredLength)
    .max(TEXT_CHANNEL_LIMITS.name)
    .optional(),
  type: z.string().optional(),
  task: z.string().optional(),
  modalities: metadataListSchema.optional(),
  input_modalities: metadataListSchema.optional(),
  output_modalities: metadataListSchema.optional(),
  supported_endpoint_types: metadataListSchema.optional(),
  architecture: z
    .object({
      input_modalities: metadataListSchema.optional(),
      output_modalities: metadataListSchema.optional(),
    })
    .optional(),
});
const providerModelsSchema = z.object({
  data: z.array(providerModelSchema).max(TEXT_CHANNEL_SYNC_MAX_MODELS),
});
type ProviderModel = z.infer<typeof providerModelSchema>;

function inputModalities(model: ProviderModel): string[] | undefined {
  return model.input_modalities ?? model.architecture?.input_modalities;
}

function supportsTextModalities(model: ProviderModel): boolean {
  const inputs = inputModalities(model);
  const outputs =
    model.output_modalities ??
    model.architecture?.output_modalities ??
    model.modalities;
  if (inputs && !inputs.includes(TEXT_MODALITY)) return false;
  if (outputs && !outputs.includes(TEXT_MODALITY)) return false;
  return true;
}

function supportsTextEndpoint(
  model: ProviderModel,
  protocol: TextChannelProtocol
): boolean {
  const endpoints = model.supported_endpoint_types;
  return !endpoints || endpoints.includes(TEXT_ENDPOINT_TYPES[protocol]);
}

function isTextCandidate(
  model: ProviderModel,
  protocol: TextChannelProtocol
): boolean {
  if (!supportsTextEndpoint(model, protocol)) return false;
  const declaredType = model.type ?? model.task;
  if (declaredType && !TEXT_MODEL_TASKS.has(declaredType.toLowerCase()))
    return false;
  if (!supportsTextModalities(model)) return false;
  return (
    Boolean(inputModalities(model)?.includes(TEXT_MODALITY)) ||
    !NON_TEXT_MODEL_ID.test(model.id)
  );
}

function projectCandidate(model: ProviderModel): TextChannelModelCandidate {
  return {
    upstreamModel: model.id,
    name: model.name ?? model.id,
    ...(model.description === undefined
      ? {}
      : { description: model.description }),
    ...(model.owned_by === undefined ? {} : { vendor: model.owned_by }),
  };
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (length > TEXT_CHANNEL_SYNC_MAX_BYTES || !response.body) {
    throw new Error('Invalid models response.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = EMPTY_BYTE_COUNT;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TEXT_CHANNEL_SYNC_MAX_BYTES)
        throw new Error('Models response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().finally(() => reader.releaseLock());
  }
  const bytes = new Uint8Array(size);
  let offset = EMPTY_BYTE_COUNT;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function fetchCandidates(channel: TextChannel, apiKey: string) {
  try {
    const response = await fetch(channel.baseUrl + '/models', {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(TEXT_CHANNEL_SYNC_TIMEOUT_MS),
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
    });
    if (
      response.status < HTTP_OK ||
      response.status > HTTP_OK_MAX ||
      response.redirected
    ) {
      throw new Error('Models request failed.');
    }
    const parsed = providerModelsSchema.parse(await readLimitedJson(response));
    const unique = new Map<string, TextChannelModelCandidate>();
    for (const model of parsed.data.filter((entry) =>
      isTextCandidate(entry, channel.protocol)
    ))
      unique.set(model.id, projectCandidate(model));
    const candidates = [...unique.values()];
    if (
      candidates.some((candidate) =>
        Object.values(candidate).some((value) => value.includes(apiKey))
      )
    ) {
      throw new Error('Invalid model metadata.');
    }
    return candidates;
  } catch {
    throw new ValidationError(
      'Could not sync text models. Check the channel URL and API key.'
    );
  }
}

async function syncModels(
  store: TextChannelsReadStore,
  value: SyncTextChannelModelsInput
): Promise<TextChannelModelsSyncResult> {
  const { channelId } = syncTextChannelModelsSchema.parse(value);
  const { configuration } = await store.read();
  const channel = configuration.channels.find(
    (entry) => entry.id === channelId
  );
  if (!channel) throw new NotFoundError('Text channel not found.');
  if (!channel.credentialId)
    throw new ValidationError('Save a channel API key before syncing models.');
  const apiKey = await store.resolveSecret(channel.credentialId);
  const candidates = await fetchCandidates(channel, apiKey);
  return { channelId, candidates };
}
