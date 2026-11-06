import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { appMetadata } from '@/platform/server/db/schema';
import { runInReadSession } from '@/platform/server/db/d1-session';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { TEXT_CHANNEL_PROTOCOL } from '@/models/text-channels';
import { ConfigurationSessionMock } from './__tests__/configuration-session.mock';

vi.doMock('#env', () => ({
  getEnv: () => ({
    API_KEY_ENCRYPTION_KEY: 'mock-only-configuration-session-encryption-key',
  }),
}));
const {
  MODEL_CONFIGURATION_KEY,
  createModelConfigurationAdminMethods,
  createModelConfigurationReadMethods,
} = await import('./model-configuration');
const { createTextChannelsAdminMethods, createTextChannelsReadMethods } =
  await import('./text-channels');

const channelInput = {
  revision: 0,
  id: 'mock-channel',
  name: 'Mock channel',
  baseUrl: 'https://mock-provider.example/v1',
  protocol: TEXT_CHANNEL_PROTOCOL,
  enabled: true,
  apiKey: 'mock-only-original-channel-key',
};
const modelInput = {
  revision: 1,
  id: 'custom:mock-session' as const,
  name: 'Mock model',
  channelId: channelInput.id,
  upstreamModel: 'mock/upstream',
  enabled: true,
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 32000,
  maxOutputTokens: 4000,
  inputPricePerMillion: 0.2,
  outputPricePerMillion: 0.6,
};
let fixture: ConfigurationSessionMock;
beforeEach(() => {
  fixture = new ConfigurationSessionMock();
});
afterEach(() => fixture.close());

function browserRequest<T>(action: () => Promise<T>, start = 'mock-0') {
  return runInReadSession(fixture.binding, start, async () => {
    // An ordinary request query advances its bookmark independently of configuration reads.
    await fixture.db.run(sql`SELECT 1`);
    return action();
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function seedRoute() {
  const admin = createTextChannelsAdminMethods(fixture.db);
  await admin.saveChannel(channelInput);
  return admin.saveModel(modelInput);
}
function requireValue<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined)
    throw new Error('Missing mock value.');
  return value;
}

it('reads saved defaults after a late response restores an older bookmark', async () => {
  const admin = createModelConfigurationAdminMethods(fixture.db);
  const original = {
    ...DEFAULT_MODEL_CONFIGURATION,
    poster: 'flux_2_turbo' as const,
  };
  await admin.save(original);
  fixture.replicaVersion = fixture.head;
  const readComplete = deferred();
  const releaseResponse = deferred();
  const oldResponse = browserRequest(async () => {
    const value = await createModelConfigurationReadMethods(fixture.db).get();
    readComplete.resolve();
    await releaseResponse.promise;
    return value;
  });
  await readComplete.promise;
  const saved = await browserRequest(() =>
    admin.save(DEFAULT_MODEL_CONFIGURATION)
  );
  releaseResponse.resolve();
  const late = await oldResponse;
  expect(late.value.poster).toBe(original.poster);
  expect(late.bookmark).not.toBe(saved.bookmark);
  // The browser applies the late response's older cookie after the save response.
  const next = await browserRequest(
    () => admin.get(),
    requireValue(late.bookmark)
  );
  expect(next.bookmark).toBe(late.bookmark);
  expect(next.value).toEqual(DEFAULT_MODEL_CONFIGURATION);
  expect(next.value).toEqual(saved.value);
});

it('reads a disabled channel and removes its current routes despite an older bookmark', async () => {
  const initial = await seedRoute();
  fixture.replicaVersion = fixture.head;
  const late = await browserRequest(() =>
    createTextChannelsReadMethods(fixture.db).getSnapshot()
  );
  await browserRequest(() =>
    createTextChannelsAdminMethods(fixture.db).saveChannel({
      ...channelInput,
      revision: initial.revision,
      enabled: false,
      apiKey: '',
    })
  );
  const next = await browserRequest(async () => {
    const reader = createTextChannelsReadMethods(fixture.db);
    return {
      configuration: await reader.get(),
      routes: await reader.getSnapshot(),
      catalog: await reader.getCatalog(),
    };
  }, requireValue(late.bookmark));
  expect(next.bookmark).toBe(late.bookmark);
  expect(next.value.configuration.channels[0]?.enabled).toBe(false);
  expect(next.value.routes).toEqual([]);
  expect(next.value.catalog).toEqual([]);
});

it('resolves rotated immutable credentials in a lagging session while preserving old snapshots', async () => {
  const initial = await seedRoute();
  fixture.replicaVersion = fixture.head;
  const reader = createTextChannelsReadMethods(fixture.db);
  const old = requireValue((await reader.getSnapshot())[0]);
  const rotated = await createTextChannelsAdminMethods(fixture.db).saveChannel({
    ...channelInput,
    revision: initial.revision,
    apiKey: 'mock-only-rotated-channel-key',
  });
  const credentialId = requireValue(rotated.channels[0]?.credentialId);
  const next = await browserRequest(async () => ({
    current: await reader.resolveSecret(credentialId),
    prior: await reader.resolveSecret(old.credentialId),
    routes: await reader.getSnapshot(),
    catalog: await reader.getCatalog(),
  }));
  expect(next.value.current).toBe('mock-only-rotated-channel-key');
  expect(next.value.prior).toBe(channelInput.apiKey);
  expect(next.value.routes[0]?.credentialId).toBe(credentialId);
  const serialized = JSON.stringify(next.value.catalog);
  for (const hidden of [
    credentialId,
    channelInput.apiKey,
    'credentialId',
    'encryptedKey',
    'baseUrl',
    'upstreamModel',
  ]) {
    expect(serialized).not.toContain(hidden);
  }
});

it('restores ordinary replica routing after each configuration read', async () => {
  const admin = createModelConfigurationAdminMethods(fixture.db);
  const original = {
    ...DEFAULT_MODEL_CONFIGURATION,
    poster: 'flux_2_turbo' as const,
  };
  await admin.save(original);
  fixture.replicaVersion = fixture.head;
  await admin.save(DEFAULT_MODEL_CONFIGURATION);
  const next = await browserRequest(async () => {
    const configuration = await admin.get();
    const [row] = await fixture.db
      .select()
      .from(appMetadata)
      .where(eq(appMetadata.key, MODEL_CONFIGURATION_KEY));
    return {
      configuration,
      ordinaryRead: JSON.parse(requireValue(row).value) as unknown,
    };
  });
  expect(next.value.configuration).toEqual(DEFAULT_MODEL_CONFIGURATION);
  expect(next.value.ordinaryRead).toEqual(original);
});
it('validates default settings against channels created after the request bookmark', async () => {
  await seedRoute();
  const saved = await browserRequest(() =>
    createModelConfigurationAdminMethods(fixture.db).save({
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultAnalysis: modelInput.id,
    })
  );
  expect(saved.value.defaultAnalysis).toBe(modelInput.id);
  const read = await browserRequest(() =>
    createModelConfigurationReadMethods(fixture.db).get()
  );
  expect(read.value.defaultAnalysis).toBe(modelInput.id);
});

it('accepts the current channel revision despite a lagging replica without changing revision guards', async () => {
  const initial = await seedRoute();
  const saved = await browserRequest(() =>
    createTextChannelsAdminMethods(fixture.db).saveChannel({
      ...channelInput,
      revision: initial.revision,
      name: 'Updated mock channel',
      apiKey: '',
    })
  );
  expect(saved.value.revision).toBe(initial.revision + 1);
  const staleSave = browserRequest(() =>
    createTextChannelsAdminMethods(fixture.db).saveChannel({
      ...channelInput,
      revision: initial.revision,
      apiKey: 'mock-only-stale-key',
    })
  );
  await expect(staleSave).rejects.toMatchObject({ code: 'CONFLICT' });
});
