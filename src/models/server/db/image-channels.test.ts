import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import { appMetadata } from '@/platform/server/db/schema';
import * as ids from '@/platform/id';
import { IMAGE_CHANNEL_PROTOCOL } from '@/models/image-channels';
import type { SaveChannelImageModelInput } from '@/models/image-channels';

vi.doMock('#env', () => ({
  getEnv: () => ({ API_KEY_ENCRYPTION_KEY: 'mock-encryption-secret-only' }),
}));
const {
  createImageChannelsAdminMethods,
  createImageChannelsReadMethods,
  IMAGE_CHANNELS_KEY,
  IMAGE_CHANNEL_CREDENTIAL_PREFIX,
} = await import('./image-channels');
let db: Database;
let closeDb: () => Promise<void>;
const channelInput = {
  revision: 0,
  id: 'mock-channel',
  name: 'Mock channel',
  baseUrl: 'https://10.0.0.4/v1',
  protocol: IMAGE_CHANNEL_PROTOCOL,
  enabled: true,
  apiKey: 'mock-provider-secret-for-tests',
};
const modelInput: SaveChannelImageModelInput = {
  revision: 1,
  id: 'custom-image:mock',
  name: 'Mock image',
  channelId: 'mock-channel',
  enabled: true,
  operations: {
    generate: {
      upstreamModel: 'mock/Image',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
  },
  parameters: [],
  priceCards: [
    { id: 'base', operation: 'generate', match: {}, unitPriceUsd: 0.04 },
  ],
};
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  await db.delete(appMetadata);
});
afterEach(() => vi.restoreAllMocks());
function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Missing mock test value.');
  return value;
}

it('exposes a read-only scope with no default writes', async () => {
  const reader = createImageChannelsReadMethods(db);
  expect(await reader.get()).toEqual({ revision: 0, channels: [], models: [] });
  expect(await reader.getCatalog()).toEqual([]);
  expect(await reader.getSnapshot()).toEqual([]);
  for (const method of ['saveChannel', 'saveModel', 'syncModels'])
    expect(reader).not.toHaveProperty(method);
  expect(await db.select().from(appMetadata)).toEqual([]);
});

it('uses a separate registry with AES encrypted ULID credentials and preserves other metadata', async () => {
  await db
    .insert(appMetadata)
    .values({ key: 'system-seed', value: 'untouched' });
  const writer = createImageChannelsAdminMethods(db);
  const saved = await writer.saveChannel(channelInput);
  const channel = requireValue(saved.channels[0]);
  expect(z.ulid().safeParse(channel.credentialId).success).toBe(true);
  expect(channel).toMatchObject({ hasKey: true, keyHint: '****ests' });
  expect(JSON.stringify(saved)).not.toContain(channelInput.apiKey);
  expect(await writer.resolveSecret(requireValue(channel.credentialId))).toBe(
    channelInput.apiKey
  );
  const rows = await db.select().from(appMetadata);
  expect(rows).toHaveLength(3);
  expect(JSON.stringify(rows)).not.toContain(channelInput.apiKey);
  expect(rows.find((row) => row.key === 'system-seed')?.value).toBe(
    'untouched'
  );
  expect(
    rows.find((row) => row.key.startsWith(IMAGE_CHANNEL_CREDENTIAL_PREFIX))
      ?.value
  ).toContain('encryptedKey');
});

it('persists exact routing and produces a safe catalog across independent scopes', async () => {
  const writer = createImageChannelsAdminMethods(db);
  await writer.saveChannel(channelInput);
  await writer.saveModel(modelInput);
  const reader = createImageChannelsReadMethods(db);
  expect((await reader.getSnapshot())[0]).toMatchObject({
    modelId: modelInput.id,
    baseUrl: channelInput.baseUrl,
    operations: modelInput.operations,
    priceCards: modelInput.priceCards,
  });
  const entry = requireValue((await reader.getCatalog())[0]);
  expect(entry).toMatchObject({ id: modelInput.id, available: true });
  for (const field of ['baseUrl', 'channelId', 'credentialId', 'upstreamModel'])
    expect(JSON.stringify(entry)).not.toContain(field);
});

it('retains immutable references for blank edits and previous runs after rotation', async () => {
  const writer = createImageChannelsAdminMethods(db);
  const first = await writer.saveChannel(channelInput);
  const originalId = requireValue(first.channels[0]?.credentialId);
  const second = await writer.saveChannel({
    ...channelInput,
    revision: 1,
    apiKey: ' ',
  });
  expect(second.channels[0]?.credentialId).toBe(originalId);
  const third = await writer.saveChannel({
    ...channelInput,
    revision: 2,
    apiKey: 'mock-rotated-secret',
  });
  const newId = requireValue(third.channels[0]?.credentialId);
  expect(newId).not.toBe(originalId);
  expect(await writer.resolveSecret(originalId)).toBe(channelInput.apiKey);
  expect(await writer.resolveSecret(newId)).toBe('mock-rotated-secret');
  expect(await db.select().from(appMetadata)).toHaveLength(3);
});

it('keeps disabled model names in catalog but removes them from new execution snapshots', async () => {
  const writer = createImageChannelsAdminMethods(db);
  await writer.saveChannel(channelInput);
  await writer.saveModel(modelInput);
  await writer.saveModel({ ...modelInput, revision: 2, enabled: false });
  expect(await writer.getSnapshot()).toEqual([]);
  expect((await writer.getCatalog())[0]).toMatchObject({
    name: modelInput.name,
    available: false,
  });
});

it('permits exactly one concurrent first save and creates no orphaned secret', async () => {
  const outcomes = await Promise.allSettled([
    createImageChannelsAdminMethods(db).saveChannel(channelInput),
    createImageChannelsAdminMethods(db).saveChannel({
      ...channelInput,
      id: 'other',
    }),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === 'fulfilled')
  ).toHaveLength(1);
  expect(
    outcomes.find((outcome) => outcome.status === 'rejected')
  ).toMatchObject({ reason: { code: 'CONFLICT' } });
  expect((await createImageChannelsReadMethods(db).get()).revision).toBe(1);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('guards concurrent model edits with CAS across separate admin scopes', async () => {
  await createImageChannelsAdminMethods(db).saveChannel(channelInput);
  const outcomes = await Promise.allSettled([
    createImageChannelsAdminMethods(db).saveModel(modelInput),
    createImageChannelsAdminMethods(db).saveModel({
      ...modelInput,
      id: 'custom-image:other',
    }),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === 'fulfilled')
  ).toHaveLength(1);
  expect(
    outcomes.find((outcome) => outcome.status === 'rejected')
  ).toMatchObject({ reason: { code: 'CONFLICT' } });
  expect((await createImageChannelsReadMethods(db).get()).models).toHaveLength(
    1
  );
});

it('rejects stale revisions before encrypting or writing', async () => {
  const writer = createImageChannelsAdminMethods(db);
  const first = await writer.saveChannel(channelInput);
  await expect(
    writer.saveChannel({ ...channelInput, apiKey: 'mock-stale-new-secret' })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await writer.get()).toEqual(first);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('atomically rolls back config when immutable credential insertion fails', async () => {
  const writer = createImageChannelsAdminMethods(db);
  const first = await writer.saveChannel(channelInput);
  const credentialId = requireValue(first.channels[0]?.credentialId);
  vi.spyOn(ids, 'generateId').mockReturnValue(credentialId);
  await expect(
    writer.saveChannel({
      ...channelInput,
      revision: 1,
      apiKey: 'mock-collision-secret',
    })
  ).rejects.toThrow();
  expect(await writer.get()).toEqual(first);
  expect(await writer.resolveSecret(credentialId)).toBe(channelInput.apiKey);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('requires a fresh credential for endpoint changes', async () => {
  const writer = createImageChannelsAdminMethods(db);
  await writer.saveChannel(channelInput);
  await expect(
    writer.saveChannel({
      ...channelInput,
      revision: 1,
      baseUrl: 'https://other.example/v1',
      apiKey: '',
    })
  ).rejects.toThrow('Provide a new API key');
  const updated = await writer.saveChannel({
    ...channelInput,
    revision: 1,
    baseUrl: 'https://other.example/v1',
    apiKey: 'mock-new-destination-secret',
  });
  expect(updated.channels[0]?.baseUrl).toBe('https://other.example/v1');
});

it('allows keyless drafts while refusing active keyless channels', async () => {
  const writer = createImageChannelsAdminMethods(db);
  await expect(
    writer.saveChannel({ ...channelInput, apiKey: '' })
  ).rejects.toThrow('Save an API key');
  const saved = await writer.saveChannel({
    ...channelInput,
    enabled: false,
    apiKey: '',
  });
  expect(saved.channels[0]).toMatchObject({
    hasKey: false,
    credentialId: null,
  });
});

it('preserves logical model identity across label and price edits', async () => {
  const writer = createImageChannelsAdminMethods(db);
  await writer.saveChannel(channelInput);
  await writer.saveModel(modelInput);
  await expect(
    writer.saveModel({
      ...modelInput,
      revision: 2,
      operations: {
        generate: {
          ...requireValue(modelInput.operations.generate),
          upstreamModel: 'different/Image',
        },
      },
    })
  ).rejects.toThrow('Create a new image model identifier');
  const saved = await writer.saveModel({
    ...modelInput,
    revision: 2,
    name: 'New display name',
    priceCards: [
      { ...requireValue(modelInput.priceCards[0]), unitPriceUsd: 0.08 },
    ],
  });
  expect(saved.models[0]).toMatchObject({
    id: modelInput.id,
    name: 'New display name',
  });
});

it('rejects missing/corrupt credentials and invalid registry data without leaking raw values', async () => {
  const reader = createImageChannelsReadMethods(db);
  await expect(reader.resolveSecret('not-a-ulid')).rejects.toThrow(
    'credential is unavailable'
  );
  await expect(reader.resolveSecret(ids.generateId())).rejects.toThrow(
    'credential is unavailable'
  );
  await db
    .insert(appMetadata)
    .values({ key: IMAGE_CHANNELS_KEY, value: 'mock-invalid-json' });
  await expect(reader.get()).rejects.toThrow(
    'Stored image channel settings are invalid.'
  );
  const id = ids.generateId();
  await db.insert(appMetadata).values({
    key: IMAGE_CHANNEL_CREDENTIAL_PREFIX + id,
    value: JSON.stringify({ encryptedKey: 'mock-corrupt' }),
  });
  await expect(reader.resolveSecret(id)).rejects.toThrow(
    'credential is unavailable'
  );
});

it('refuses mismatched metadata references rather than silently dropping configured models', async () => {
  const writer = createImageChannelsAdminMethods(db);
  await writer.saveChannel(channelInput);
  await expect(
    writer.saveModel({ ...modelInput, channelId: 'missing' })
  ).rejects.toThrow('Select an existing image channel');
  await db
    .update(appMetadata)
    .set({ value: '{"revision":1,"channels":[],"models":[{}]}' })
    .where(eq(appMetadata.key, IMAGE_CHANNELS_KEY));
  await expect(writer.get()).rejects.toThrow(
    'Stored image channel settings are invalid.'
  );
});
