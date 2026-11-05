import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  appMetadata,
  organizationApiKeys,
  organization,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { createTestDb } from '@/platform/server/db/test-d1';

vi.mock('#env', () => ({
  getEnv: () => ({
    API_KEY_ENCRYPTION_KEY: 'mock-encryption-secret-for-tests',
    OPENROUTER_KEY: 'mock-openrouter-platform-key',
  }),
}));
const { createApiKeysMethods, createApiKeysReadMethods } =
  await import('./api-keys');
const {
  createTextChannelsAdminMethods,
  createTextChannelsReadMethods,
  TEXT_CHANNELS_KEY,
} = await import('./text-channels');
let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(appMetadata);
  await db.delete(organizationApiKeys);
  await db.delete(organization);
  await db.delete(user);
});

const channel = {
  revision: 0,
  id: 'mock-channel',
  name: 'Mock channel',
  baseUrl: 'https://mock.invalid/v1',
  protocol: 'openai-chat-completions' as const,
  enabled: true,
  apiKey: 'mock-original-credential',
};
const model = {
  revision: 1,
  id: 'custom:mock-model' as const,
  name: 'Mock model',
  channelId: channel.id,
  upstreamModel: 'mock-upstream',
  enabled: true,
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 1_000,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
};

it('routes an explicitly bound model through a platform-owned credential', async () => {
  const admin = createTextChannelsAdminMethods(db);
  await admin.saveChannel(channel);
  await admin.saveModel(model);
  const resolved = await createApiKeysReadMethods(
    db,
    'mock-team'
  ).resolveLlmKey(model.id);
  expect(resolved).toMatchObject({
    source: 'platform',
    via: 'compatible',
    key: channel.apiKey,
    route: { modelId: model.id, upstreamModel: model.upstreamModel },
  });
});

it('retains a run route and credential after administrator rotation and disabling', async () => {
  const admin = createTextChannelsAdminMethods(db);
  await admin.saveChannel(channel);
  await admin.saveModel(model);
  const snapshot = await createTextChannelsReadMethods(db).getSnapshot();
  await admin.saveChannel({
    ...channel,
    revision: 2,
    enabled: false,
    baseUrl: 'https://replacement.invalid/v1',
    apiKey: 'mock-rotated-credential',
  });
  const keys = createApiKeysReadMethods(db, 'mock-team');
  const resolved = await keys.resolveLlmKey(model.id, snapshot);
  expect(resolved).toMatchObject({
    via: 'compatible',
    key: channel.apiKey,
    route: { baseUrl: channel.baseUrl },
  });
  await expect(keys.resolveLlmKey(model.id)).rejects.toThrow('unavailable');
});

it('does not send unknown custom identifiers to the platform fallback', async () => {
  const keys = createApiKeysReadMethods(db, 'mock-team');
  await expect(keys.resolveLlmKey('custom:unknown', [])).rejects.toThrow(
    'unavailable'
  );
  expect((await keys.resolveLlmKey('openai/gpt-5.4-mini', [])).via).toBe(
    'openrouter'
  );
});

it('does not put plaintext credentials in the configuration row', async () => {
  await createTextChannelsAdminMethods(db).saveChannel(channel);
  const rows = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, TEXT_CHANNELS_KEY));
  expect(JSON.stringify(rows)).not.toContain(channel.apiKey);
});

async function teamKeys() {
  const organizationId = generateId();
  const userId = generateId();
  await db
    .insert(organization)
    .values({
      id: organizationId,
      name: 'Mock team',
      slug: 'mock-' + organizationId,
    });
  await db
    .insert(user)
    .values({ id: userId, name: 'Mock user', email: userId + '@example.test' });
  return createApiKeysMethods(db, organizationId, userId);
}

it.each(['fal', 'openrouter'] as const)(
  'resolves an encrypted team %s key before a builtin channel binding',
  async (provider) => {
    const admin = createTextChannelsAdminMethods(db);
    await admin.saveChannel(channel);
    const builtin = { ...model, id: 'openai/gpt-5.4-mini' as const };
    await admin.saveModel(builtin);
    const keys = await teamKeys();
    await keys.saveKey({ provider, apiKey: 'mock-team-key' });
    expect(await keys.resolveLlmKey(builtin.id)).toMatchObject({
      key: 'mock-team-key',
      source: 'organization',
      via: provider,
    });
  }
);

it('uses the builtin platform binding after a team key is invalidated', async () => {
  const admin = createTextChannelsAdminMethods(db);
  await admin.saveChannel(channel);
  const builtin = { ...model, id: 'openai/gpt-5.4-mini' as const };
  await admin.saveModel(builtin);
  const keys = await teamKeys();
  await keys.saveKey({
    provider: 'openrouter',
    apiKey: 'mock-revoked-team-key',
  });
  await keys.markKeyInvalid('openrouter', 'Mock provider rejected this key');
  expect(await keys.resolveLlmKey(builtin.id)).toMatchObject({
    key: channel.apiKey,
    source: 'platform',
    via: 'compatible',
    route: { modelId: builtin.id },
  });
});
