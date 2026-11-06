import { z } from 'zod';
import { generateId } from '@/platform/id';
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
import type { ChannelImageModel, ImageChannel } from '../image-channels';
import type {
  ImageChannelsConfiguration,
  SaveImageChannelInput,
  SaveChannelImageModelInput,
  SyncImageChannelModelsInput,
  ImageChannelModelCandidate,
  ImageChannelModelsSyncResult,
} from '../image-channels';
import {
  createImageModelRoutingSnapshot,
  isConfiguredImageModelId,
  imageModelCatalogFromConfiguration,
  saveImageChannelSchema,
  saveChannelImageModelSchema,
  syncImageChannelModelsSchema,
  imageChannelsConfigurationSchema,
  imageChannelUpstreamModelSchema,
  IMAGE_CHANNEL_LIMITS,
} from '../image-channels';
import { IMAGE_OPERATIONS } from '../image-channel-parameters';
import {
  WORKFLOW_IMAGE_ROUTING_MAX_BYTES,
  WORKFLOW_IMAGE_ROUTING_SIZE_ERROR,
  workflowImageRoutingSnapshotBytes,
} from '../workflow-image-model-routing';

export const IMAGE_CHANNEL_SYNC_TIMEOUT_MS = 15_000;
export const IMAGE_CHANNEL_SYNC_MAX_BYTES = 1_048_576;
const IMAGE_CHANNEL_SYNC_MAX_MODELS = 2_000;
const HTTP_OK = 200;
const HTTP_OK_MAX = 299;
const EMPTY_BYTE_COUNT = 0;
const IMAGE_MODEL_ID =
  /(?:image|dall-e|flux|seedream|stable-diffusion|qwen.*edit)/i;
const IMAGE_MODEL_TASKS = new Set([
  'image',
  'images',
  'image-generation',
  'text-to-image',
  'image-to-image',
]);
export type StoredImageChannels = {
  configuration: ImageChannelsConfiguration;
  serialized: string | null;
};
export type ImageChannelCredential = EncryptedApiKey & { id: string };
export type ImageChannelsReadStore = {
  read: () => Promise<StoredImageChannels>;
  resolveSecret: (credentialId: string) => Promise<string>;
};
export type ImageChannelsAdminStore = ImageChannelsReadStore & {
  commit: (
    previous: string | null,
    next: ImageChannelsConfiguration,
    credential?: ImageChannelCredential
  ) => Promise<void>;
};

export function createImageChannelsReader(store: ImageChannelsReadStore) {
  const get = async () => (await store.read()).configuration;
  const getSnapshot = async () => createImageModelRoutingSnapshot(await get());
  return {
    get,
    getSnapshot,
    getCatalog: async () => imageModelCatalogFromConfiguration(await get()),
    resolveSecret: (credentialId: string) => store.resolveSecret(credentialId),
  };
}

function assertRevision(
  configuration: ImageChannelsConfiguration,
  revision: number
) {
  if (configuration.revision !== revision)
    throw new ConflictError(
      'Image channel settings changed. Reload before saving.'
    );
}

function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((previous) => previous.id === row.id)
    ? rows.map((previous) => (previous.id === row.id ? row : previous))
    : [...rows, row];
}

function assertCredentialDestination(
  input: SaveImageChannelInput,
  previous?: ImageChannel
) {
  if (previous?.hasKey && previous.baseUrl !== input.baseUrl && !input.apiKey)
    throw new ValidationError(
      'Provide a new API key when changing a channel base URL.'
    );
}

async function prepareChannel(
  input: SaveImageChannelInput,
  previous?: ImageChannel
): Promise<{ channel: ImageChannel; credential?: ImageChannelCredential }> {
  const { revision: _revision, apiKey, ...metadata } = input;
  assertCredentialDestination(input, previous);
  if (apiKey) {
    const credential = { id: generateId(), ...(await encryptApiKey(apiKey)) };
    return {
      channel: {
        ...metadata,
        credentialId: credential.id,
        keyHint: getKeyHint(apiKey),
        hasKey: true,
      },
      credential,
    };
  }
  const channel = previous
    ? { ...previous, ...metadata }
    : { ...metadata, credentialId: null, keyHint: null, hasKey: false };
  if (channel.enabled && !channel.hasKey)
    throw new ValidationError(
      'Save an API key before enabling an image channel.'
    );
  return { channel };
}

function assertWorkflowSnapshotCapacity(
  configuration: ImageChannelsConfiguration
) {
  const routing = createImageModelRoutingSnapshot(configuration);
  if (
    workflowImageRoutingSnapshotBytes(routing) >
    WORKFLOW_IMAGE_ROUTING_MAX_BYTES
  )
    throw new ValidationError(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR);
}

async function saveChannel(
  store: ImageChannelsAdminStore,
  value: SaveImageChannelInput
) {
  const input = saveImageChannelSchema.parse(value);
  const saved = await store.read();
  assertRevision(saved.configuration, input.revision);
  const previous = saved.configuration.channels.find(
    (channel) => channel.id === input.id
  );
  const { channel, credential } = await prepareChannel(input, previous);
  const next = imageChannelsConfigurationSchema.parse({
    ...saved.configuration,
    revision: input.revision + 1,
    channels: upsertById(saved.configuration.channels, channel),
  });
  assertWorkflowSnapshotCapacity(next);
  await store.commit(saved.serialized, next, credential);
  return next;
}

function assertModelIdentity(
  previous: ChannelImageModel | undefined,
  model: ChannelImageModel
) {
  if (!previous || !isConfiguredImageModelId(model.id)) return;
  const changed = IMAGE_OPERATIONS.some((operation) => {
    const upstream = previous.operations[operation]?.upstreamModel;
    return (
      upstream !== undefined &&
      model.operations[operation]?.upstreamModel !== upstream
    );
  });
  if (changed)
    throw new ValidationError(
      'Create a new image model identifier when changing an upstream model.'
    );
}

async function saveModel(
  store: ImageChannelsAdminStore,
  value: SaveChannelImageModelInput
) {
  const { revision, ...model } = saveChannelImageModelSchema.parse(value);
  const saved = await store.read();
  assertRevision(saved.configuration, revision);
  if (
    !saved.configuration.channels.some(
      (channel) => channel.id === model.channelId
    )
  )
    throw new ValidationError('Select an existing image channel.');
  assertModelIdentity(
    saved.configuration.models.find((entry) => entry.id === model.id),
    model
  );
  const next = imageChannelsConfigurationSchema.parse({
    ...saved.configuration,
    revision: revision + 1,
    models: upsertById<ChannelImageModel>(saved.configuration.models, model),
  });
  assertWorkflowSnapshotCapacity(next);
  await store.commit(saved.serialized, next);
  return next;
}

export function createImageChannelsAdminService(
  store: ImageChannelsAdminStore
) {
  return {
    ...createImageChannelsReader(store),
    saveChannel: (input: SaveImageChannelInput) => saveChannel(store, input),
    saveModel: (input: SaveChannelImageModelInput) => saveModel(store, input),
    syncModels: (input: SyncImageChannelModelsInput) =>
      syncModels(store, input),
  };
}
const metadataListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((values) =>
    (typeof values === 'string' ? values.split(',') : values)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
const providerModelSchema = z.object({
  id: imageChannelUpstreamModelSchema,
  name: z
    .string()
    .trim()
    .min(IMAGE_CHANNEL_LIMITS.requiredLength)
    .max(IMAGE_CHANNEL_LIMITS.name)
    .optional(),
  description: z.string().max(IMAGE_CHANNEL_LIMITS.description).optional(),
  owned_by: z.string().trim().max(IMAGE_CHANNEL_LIMITS.name).optional(),
  type: z.string().optional(),
  task: z.string().optional(),
  output_modalities: metadataListSchema.optional(),
  modalities: metadataListSchema.optional(),
  architecture: z
    .object({ output_modalities: metadataListSchema.optional() })
    .optional(),
});
const providerModelsSchema = z.object({
  data: z.array(providerModelSchema).max(IMAGE_CHANNEL_SYNC_MAX_MODELS),
});
type ProviderModel = z.infer<typeof providerModelSchema>;

function isImageCandidate(model: ProviderModel): boolean {
  const modalities =
    model.output_modalities ??
    model.architecture?.output_modalities ??
    model.modalities;
  if (modalities) return modalities.includes('image');
  const task = model.type ?? model.task;
  if (task) return IMAGE_MODEL_TASKS.has(task.toLowerCase());
  return IMAGE_MODEL_ID.test(model.id);
}

function projectCandidate(model: ProviderModel): ImageChannelModelCandidate {
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
  if (length > IMAGE_CHANNEL_SYNC_MAX_BYTES || !response.body)
    throw new Error('Invalid models response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = EMPTY_BYTE_COUNT;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_CHANNEL_SYNC_MAX_BYTES)
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

async function fetchCandidates(
  channel: ImageChannel,
  apiKey: string
): Promise<ImageChannelModelCandidate[]> {
  try {
    const response = await fetch(channel.baseUrl + '/models', {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_CHANNEL_SYNC_TIMEOUT_MS),
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
    });
    if (
      response.status < HTTP_OK ||
      response.status > HTTP_OK_MAX ||
      response.redirected
    )
      throw new Error('Models request failed.');
    const parsed = providerModelsSchema.parse(await readLimitedJson(response));
    const metadata = parsed.data.map(projectCandidate);
    if (
      metadata.some((candidate) =>
        Object.values(candidate).some((value) => value.includes(apiKey))
      )
    )
      throw new Error('Invalid model metadata.');
    const unique = new Map<string, ImageChannelModelCandidate>();
    for (const model of parsed.data.filter(isImageCandidate))
      unique.set(model.id, projectCandidate(model));
    return [...unique.values()];
  } catch {
    throw new ValidationError(
      'Could not sync image models. Check the channel URL and API key.'
    );
  }
}

async function syncModels(
  store: ImageChannelsReadStore,
  value: SyncImageChannelModelsInput
): Promise<ImageChannelModelsSyncResult> {
  const { channelId } = syncImageChannelModelsSchema.parse(value);
  const { configuration } = await store.read();
  const channel = configuration.channels.find(
    (entry) => entry.id === channelId
  );
  if (!channel) throw new NotFoundError('Image channel not found.');
  if (!channel.credentialId)
    throw new ValidationError('Save a channel API key before syncing models.');
  const apiKey = await store.resolveSecret(channel.credentialId);
  return { channelId, candidates: await fetchCandidates(channel, apiKey) };
}
