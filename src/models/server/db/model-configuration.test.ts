import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/platform/server/db/test-d1';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  MODEL_CONFIGURATION_KEY,
  createModelConfigurationAdminMethods,
  createModelConfigurationReadMethods,
} from './model-configuration';

let db: Database;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  await db.delete(appMetadata);
});

describe('global model settings persistence (1)', () => {
  it('reads existing code defaults without creating a settings record', async () => {
    const reader = createModelConfigurationReadMethods(db);
    expect(await reader.get()).toEqual(DEFAULT_MODEL_CONFIGURATION);
    expect(await db.select().from(appMetadata)).toEqual([]);
    expect(reader).not.toHaveProperty('save');
  });

  it('persists an admin change across fresh scopes and preserves unrelated metadata', async () => {
    await db
      .insert(appMetadata)
      .values({ key: 'system-seed', value: 'unchanged' });
    const writer = createModelConfigurationAdminMethods(db);
    await writer.save({
      ...DEFAULT_MODEL_CONFIGURATION,
      sceneSplit: 'google/gemini-3.8-flash',
    });
    const freshReader = createModelConfigurationReadMethods(db);
    expect((await freshReader.get()).sceneSplit).toBe(
      'google/gemini-3.8-flash'
    );
    const [other] = await db
      .select()
      .from(appMetadata)
      .where(eq(appMetadata.key, 'system-seed'));
    expect(other?.value).toBe('unchanged');
  });
});

describe('global model settings persistence (2)', () => {
  it('keeps the last complete configuration when a save is rejected', async () => {
    const writer = createModelConfigurationAdminMethods(db);
    await writer.save({
      ...DEFAULT_MODEL_CONFIGURATION,
      poster: 'flux_2_turbo',
    });
    await expect(
      writer.save({
        ...DEFAULT_MODEL_CONFIGURATION,
        watchClip: 'anthropic/claude-sonnet-5.5',
      })
    ).rejects.toThrow();
    expect((await writer.get()).poster).toBe('flux_2_turbo');
    expect(await db.select().from(appMetadata)).toHaveLength(1);
  });

  it('merges newly introduced slots into a previously saved partial configuration', async () => {
    await db.insert(appMetadata).values({
      key: MODEL_CONFIGURATION_KEY,
      value: JSON.stringify({ sceneSplit: 'google/gemini-3.8-flash' }),
    });
    const config = await createModelConfigurationReadMethods(db).get();
    expect(config.sceneSplit).toBe('google/gemini-3.8-flash');
    expect(config.poster).toBe(DEFAULT_MODEL_CONFIGURATION.poster);
  });
});
