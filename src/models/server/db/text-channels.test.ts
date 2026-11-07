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
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import { appMetadata } from '@/platform/server/db/schema';
import { asStub } from '@/test/as-stub';
import {
  DEFAULT_TEXT_CHANNEL_USER_AGENT,
  TEXT_CHANNEL_PROTOCOL,
} from '@/models/text-channels';

vi.doMock('#env', () => ({
  getEnv: () => ({
    API_KEY_ENCRYPTION_KEY: 'mock-test-encryption-secret-only',
  }),
}));
const {
  createTextChannelsAdminMethods,
  createTextChannelsReadMethods,
  TEXT_CHANNELS_KEY,
  TEXT_CHANNEL_CREDENTIAL_PREFIX,
} = await import('./text-channels');

let db: Database;
let closeDb: () => Promise<void>;
const channelInput = {
  revision: 0,
  id: 'mock-channel',
  name: 'Mock channel',
  baseUrl: 'https://10.0.0.4:8443/v1',
  protocol: TEXT_CHANNEL_PROTOCOL,
  enabled: true,
  apiKey: 'mock-provider-secret-for-tests',
};
const modelInput = {
  revision: 1,
  id: 'custom:mock-model' as const,
  name: 'Mock text model',
  channelId: channelInput.id,
  upstreamModel: 'mock-upstream/model',
  enabled: true,
  vision: true,
  structuredOutput: true,
  tools: false,
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 0.25,
  outputPricePerMillion: 0.75,
};

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  await db.delete(appMetadata);
});
afterEach(() => vi.restoreAllMocks());

async function saveMockChannel() {
  return createTextChannelsAdminMethods(db).saveChannel(channelInput);
}

it('has no write surface in request read scopes and creates no default record', async () => {
  const reader = createTextChannelsReadMethods(db);
  expect(await reader.get()).toEqual({ revision: 0, channels: [], models: [] });
  expect(await reader.getSnapshot()).toEqual([]);
  expect(await reader.getCatalog()).toEqual([]);
  expect(reader).not.toHaveProperty('saveChannel');
  expect(reader).not.toHaveProperty('saveModel');
  expect(reader).not.toHaveProperty('syncModels');
  expect(await db.select().from(appMetadata)).toEqual([]);
});

it('encrypts credentials and persists only safe metadata in the registry', async () => {
  await db
    .insert(appMetadata)
    .values({ key: 'system-seed', value: 'unchanged' });
  const saved = await saveMockChannel();
  const channel = requireValue(saved.channels[0]);
  expect(channel).toMatchObject({
    id: channelInput.id,
    hasKey: true,
    keyHint: '****ests',
  });
  expect(channel.credentialId).toBeTruthy();
  const reader = createTextChannelsReadMethods(db);
  expect(await reader.get()).toEqual(saved);
  expect(await reader.resolveSecret(requireValue(channel.credentialId))).toBe(
    channelInput.apiKey
  );
  const rows = await db.select().from(appMetadata);
  expect(rows).toHaveLength(3);
  expect(JSON.stringify(rows)).not.toContain(channelInput.apiKey);
  expect(rows.find((row) => row.key === 'system-seed')?.value).toBe(
    'unchanged'
  );
  expect(
    rows.find((row) => row.key.startsWith(TEXT_CHANNEL_CREDENTIAL_PREFIX))
      ?.value
  ).toContain('encryptedKey');
});

it('persists model bindings and projects a safe incremental catalog across scopes', async () => {
  await saveMockChannel();
  const saved = await createTextChannelsAdminMethods(db).saveModel(modelInput);
  expect(saved.revision).toBe(2);
  const reader = createTextChannelsReadMethods(db);
  const [route] = await reader.getSnapshot();
  expect(route).toMatchObject({
    modelId: modelInput.id,
    baseUrl: channelInput.baseUrl,
    upstreamModel: modelInput.upstreamModel,
    inputPricePerMillion: 0.25,
  });
  const [entry] = await reader.getCatalog();
  expect(entry?.id).toBe(modelInput.id);
  for (const field of [
    'baseUrl',
    'channelId',
    'upstreamModel',
    'credentialId',
    'userAgent',
  ]) {
    expect(entry).not.toHaveProperty(field);
  }
});

it('retains the saved immutable credential when the key input is omitted or blank', async () => {
  const first = await saveMockChannel();
  const writer = createTextChannelsAdminMethods(db);
  const second = await writer.saveChannel({
    ...channelInput,
    revision: first.revision,
    name: 'Renamed mock channel',
    apiKey: '   ',
  });
  expect(second.channels[0]?.credentialId).toBe(
    first.channels[0]?.credentialId
  );
  const { apiKey: _apiKey, ...withoutKey } = channelInput;
  const third = await writer.saveChannel({
    ...withoutKey,
    revision: second.revision,
  });
  expect(third.channels[0]?.credentialId).toBe(first.channels[0]?.credentialId);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('keeps old credentials resolvable after rotation for existing workflow snapshots', async () => {
  await saveMockChannel();
  const writer = createTextChannelsAdminMethods(db);
  await writer.saveModel(modelInput);
  const [oldRoute] = await writer.getSnapshot();
  const rotated = await writer.saveChannel({
    ...channelInput,
    revision: 2,
    apiKey: 'rotated-mock-provider-secret',
  });
  const credentialId = requireValue(rotated.channels[0]?.credentialId);
  expect(credentialId).not.toBe(requireValue(oldRoute).credentialId);
  expect(await writer.resolveSecret(requireValue(oldRoute).credentialId)).toBe(
    channelInput.apiKey
  );
  expect(await writer.resolveSecret(credentialId)).toBe(
    'rotated-mock-provider-secret'
  );
  expect((await writer.getSnapshot())[0]?.credentialId).toBe(credentialId);
  expect(JSON.stringify(await db.select().from(appMetadata))).not.toContain(
    'rotated-mock-provider-secret'
  );
});

it('removes disabled bindings and channels from fresh snapshots without deleting credentials', async () => {
  await saveMockChannel();
  const writer = createTextChannelsAdminMethods(db);
  await writer.saveModel(modelInput);
  const [snapshot] = await writer.getSnapshot();
  await writer.saveModel({ ...modelInput, revision: 2, enabled: false });
  expect(await writer.getCatalog()).toEqual([]);
  await writer.saveModel({ ...modelInput, revision: 3 });
  await writer.saveChannel({
    ...channelInput,
    revision: 4,
    enabled: false,
    apiKey: '',
  });
  expect(await writer.getSnapshot()).toEqual([]);
  expect(await writer.resolveSecret(requireValue(snapshot).credentialId)).toBe(
    channelInput.apiKey
  );
});

it('allows exactly one concurrent first save and creates no orphan credentials', async () => {
  const outcomes = await Promise.allSettled([
    createTextChannelsAdminMethods(db).saveChannel(channelInput),
    createTextChannelsAdminMethods(db).saveChannel({
      ...channelInput,
      id: 'other-channel',
    }),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === 'fulfilled')
  ).toHaveLength(1);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  expect(failure).toMatchObject({ reason: { code: 'CONFLICT' } });
  const saved = await createTextChannelsReadMethods(db).get();
  expect(saved.revision).toBe(1);
  expect(saved.channels).toHaveLength(1);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('guards concurrent edits across separate scopes at the same revision', async () => {
  await saveMockChannel();
  const outcomes = await Promise.allSettled([
    createTextChannelsAdminMethods(db).saveModel(modelInput),
    createTextChannelsAdminMethods(db).saveModel({
      ...modelInput,
      id: 'custom:other-model',
    }),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === 'fulfilled')
  ).toHaveLength(1);
  const saved = await createTextChannelsReadMethods(db).get();
  expect(saved.revision).toBe(2);
  expect(saved.models).toHaveLength(1);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('rejects stale saves before adding credentials or changing existing metadata', async () => {
  const first = await saveMockChannel();
  await expect(
    createTextChannelsAdminMethods(db).saveChannel({
      ...channelInput,
      name: 'Stale edit',
      apiKey: 'mock-unused-secret',
    })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await createTextChannelsReadMethods(db).get()).toEqual(first);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('atomically rolls back the registry if immutable credential insertion fails', async () => {
  const first = await saveMockChannel();
  const credentialId = requireValue(first.channels[0]?.credentialId);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(
    asStub<ReturnType<typeof crypto.randomUUID>>(credentialId)
  );
  await expect(
    createTextChannelsAdminMethods(db).saveChannel({
      ...channelInput,
      revision: 1,
      apiKey: 'mock-rotation-conflict',
    })
  ).rejects.toThrow();
  expect(await createTextChannelsReadMethods(db).get()).toEqual(first);
  expect(
    await createTextChannelsReadMethods(db).resolveSecret(credentialId)
  ).toBe(channelInput.apiKey);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('requires a new key when moving a credential-bearing channel to another URL', async () => {
  const first = await saveMockChannel();
  const writer = createTextChannelsAdminMethods(db);
  await expect(
    writer.saveChannel({
      ...channelInput,
      revision: 1,
      baseUrl: 'https://other.example/v1',
      apiKey: '',
    })
  ).rejects.toThrow('Provide a new API key');
  expect(await writer.get()).toEqual(first);
  const second = await writer.saveChannel({
    ...channelInput,
    revision: 1,
    baseUrl: 'https://other.example/v1',
    apiKey: 'mock-replacement-secret',
  });
  expect(second.channels[0]?.baseUrl).toBe('https://other.example/v1');
  expect(second.channels[0]?.credentialId).not.toBe(
    first.channels[0]?.credentialId
  );
});

it('allows keyless drafts but prevents enabling them until credentials are saved', async () => {
  const writer = createTextChannelsAdminMethods(db);
  await expect(
    writer.saveChannel({ ...channelInput, apiKey: '' })
  ).rejects.toThrow('Save an API key');
  expect(await db.select().from(appMetadata)).toEqual([]);
  const draft = await writer.saveChannel({
    ...channelInput,
    enabled: false,
    apiKey: '',
  });
  expect(draft.channels[0]).toMatchObject({
    hasKey: false,
    credentialId: null,
    keyHint: null,
  });
  expect(await writer.getSnapshot()).toEqual([]);
});

it('rejects model bindings to missing channels without writing a registry row', async () => {
  await expect(
    createTextChannelsAdminMethods(db).saveModel({ ...modelInput, revision: 0 })
  ).rejects.toThrow('Select an existing text channel.');
  expect(await db.select().from(appMetadata)).toEqual([]);
});

it('fails closed on corrupt persisted settings instead of silently restoring defaults', async () => {
  await db
    .insert(appMetadata)
    .values({ key: TEXT_CHANNELS_KEY, value: '{mock-corrupt-registry' });
  await expect(createTextChannelsReadMethods(db).get()).rejects.toThrow(
    'Stored text channel settings are invalid.'
  );
  await expect(
    createTextChannelsAdminMethods(db).saveChannel(channelInput)
  ).rejects.toThrow();
});

it('returns generic errors for absent or corrupted immutable credentials', async () => {
  const saved = await saveMockChannel();
  const credentialId = requireValue(saved.channels[0]?.credentialId);
  await db
    .update(appMetadata)
    .set({ value: '{mock-secret-corrupted' })
    .where(eq(appMetadata.key, TEXT_CHANNEL_CREDENTIAL_PREFIX + credentialId));
  const reader = createTextChannelsReadMethods(db);
  await expect(reader.resolveSecret(credentialId)).rejects.toThrow(
    'Text channel credential is unavailable.'
  );
  await expect(reader.resolveSecret('not-a-credential-id')).rejects.toThrow(
    'Text channel credential is unavailable.'
  );
});

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Missing mock test value.');
  return value;
}

it('persists Responses selection and keeps older run snapshots on their original protocol', async () => {
  const admin = createTextChannelsAdminMethods(db);
  const reader = createTextChannelsReadMethods(db);
  await saveMockChannel();
  await admin.saveModel(modelInput);
  const previousSnapshot = await reader.getSnapshot();
  const originalCredential = requireValue(previousSnapshot[0]).credentialId;
  await admin.saveChannel({
    ...channelInput,
    revision: 2,
    protocol: 'openai-responses',
    apiKey: '',
  });
  expect(requireValue((await reader.get()).channels[0]).protocol).toBe(
    'openai-responses'
  );
  expect(requireValue((await reader.getSnapshot())[0])).toMatchObject({
    protocol: 'openai-responses',
    credentialId: originalCredential,
  });
  expect(requireValue(previousSnapshot[0])).toMatchObject({
    protocol: 'openai-chat-completions',
    credentialId: originalCredential,
  });
  expect(await reader.resolveSecret(originalCredential)).toBe(
    channelInput.apiKey
  );
});

it('saves and clears a User-Agent without rotating credentials or changing prior snapshots', async () => {
  const admin = createTextChannelsAdminMethods(db);
  const reader = createTextChannelsReadMethods(db);
  await saveMockChannel();
  await admin.saveModel(modelInput);
  const legacySnapshot = await reader.getSnapshot();
  const credentialId = requireValue(legacySnapshot[0]).credentialId;
  expect(legacySnapshot[0]?.userAgent).toBe(DEFAULT_TEXT_CHANNEL_USER_AGENT);
  await admin.saveChannel({
    ...channelInput,
    revision: 2,
    apiKey: '',
    userAgent: '  OpenStory-Deployment/2.0  ',
  });
  const customizedSnapshot = await reader.getSnapshot();
  expect((await reader.get()).channels[0]?.userAgent).toBe(
    'OpenStory-Deployment/2.0'
  );
  expect(customizedSnapshot[0]).toMatchObject({
    userAgent: 'OpenStory-Deployment/2.0',
    credentialId,
  });
  await admin.saveChannel({
    ...channelInput,
    revision: 3,
    apiKey: '',
    userAgent: '',
  });
  expect((await reader.get()).channels[0]?.userAgent).toBe('');
  expect((await reader.getSnapshot())[0]).toMatchObject({
    userAgent: DEFAULT_TEXT_CHANNEL_USER_AGENT,
    credentialId,
  });
  expect(customizedSnapshot[0]?.userAgent).toBe('OpenStory-Deployment/2.0');
  expect(legacySnapshot[0]?.userAgent).toBe(DEFAULT_TEXT_CHANNEL_USER_AGENT);
  expect(await reader.resolveSecret(credentialId)).toBe(channelInput.apiKey);
  expect(await db.select().from(appMetadata)).toHaveLength(2);
});

it('preserves an omitted User-Agent during key rotation and supports explicitly clearing it', async () => {
  const admin = createTextChannelsAdminMethods(db);
  const reader = createTextChannelsReadMethods(db);
  await admin.saveChannel({
    ...channelInput,
    userAgent: 'OpenStory-Deployment/2.0',
  });
  await admin.saveModel(modelInput);
  const originalSnapshot = await reader.getSnapshot();
  const originalCredential = requireValue(originalSnapshot[0]).credentialId;
  await admin.saveChannel({
    ...channelInput,
    revision: 2,
    apiKey: 'rotated-mock-provider-secret',
  });
  const rotatedSnapshot = await reader.getSnapshot();
  const rotatedCredential = requireValue(rotatedSnapshot[0]).credentialId;
  expect((await reader.get()).channels[0]?.userAgent).toBe(
    'OpenStory-Deployment/2.0'
  );
  expect(rotatedSnapshot[0]?.userAgent).toBe('OpenStory-Deployment/2.0');
  expect(rotatedCredential).not.toBe(originalCredential);

  await admin.saveChannel({
    ...channelInput,
    revision: 3,
    apiKey: 'cleared-rotated-mock-provider-secret',
    userAgent: '',
  });
  const clearedSnapshot = await reader.getSnapshot();
  const clearedCredential = requireValue(clearedSnapshot[0]).credentialId;
  expect((await reader.get()).channels[0]?.userAgent).toBe('');
  expect(clearedSnapshot[0]?.userAgent).toBe(DEFAULT_TEXT_CHANNEL_USER_AGENT);
  expect(clearedCredential).not.toBe(rotatedCredential);
  expect(originalSnapshot[0]).toMatchObject({
    userAgent: 'OpenStory-Deployment/2.0',
    credentialId: originalCredential,
  });
  expect(rotatedSnapshot[0]).toMatchObject({
    userAgent: 'OpenStory-Deployment/2.0',
    credentialId: rotatedCredential,
  });
  expect(await reader.resolveSecret(originalCredential)).toBe(
    channelInput.apiKey
  );
  expect(await reader.resolveSecret(rotatedCredential)).toBe(
    'rotated-mock-provider-secret'
  );
  expect(await reader.resolveSecret(clearedCredential)).toBe(
    'cleared-rotated-mock-provider-secret'
  );
  expect(await db.select().from(appMetadata)).toHaveLength(4);
});
