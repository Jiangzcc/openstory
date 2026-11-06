import type { ImageChannelModelId } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import {
  IMAGE_CHANNELS_KEY,
  createImageChannelsAdminMethods,
  createImageChannelsReadMethods,
} from './image-channels';
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

describe('configured image defaults persistence', () => {
  it('stores configured image and helper slot identities across fresh readers', async () => {
    const channels = imageConfigurationFixture();
    await db
      .insert(appMetadata)
      .values({ key: IMAGE_CHANNELS_KEY, value: JSON.stringify(channels) });
    const model = channels.models[0];
    if (!model) throw new Error('Missing mock model.');
    const configuration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultImage: model.id,
      poster: model.id,
      shotPreview: model.id,
    };
    await createModelConfigurationAdminMethods(db).save(configuration);
    expect(await createModelConfigurationReadMethods(db).get()).toEqual(
      configuration
    );
  });

  it('preserves a saved configured id after disabling its channel while rejecting new unavailable defaults', async () => {
    const channels = imageConfigurationFixture();
    const model = channels.models[0];
    if (!model) throw new Error('Missing mock model.');
    await db
      .insert(appMetadata)
      .values({ key: IMAGE_CHANNELS_KEY, value: JSON.stringify(channels) });
    const configuration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultImage: model.id,
    };
    const admin = createModelConfigurationAdminMethods(db);
    await admin.save(configuration);
    await db
      .update(appMetadata)
      .set({
        value: JSON.stringify({
          ...channels,
          channels: channels.channels.map((channel) => ({
            ...channel,
            enabled: false,
          })),
        }),
      })
      .where(eq(appMetadata.key, IMAGE_CHANNELS_KEY));
    expect(
      (await createModelConfigurationReadMethods(db).get()).defaultImage
    ).toBe(model.id);
    await expect(admin.save(configuration)).rejects.toThrow();
  });
});

describe('built-in image binding availability after saving defaults', () => {
  it('preserves defaults and unrelated model settings when a new binding is unverified', async () => {
    const admin = createModelConfigurationAdminMethods(db);
    const saved = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultImage: 'flux_2_dev' as const,
    };
    await admin.save(saved);
    const channels = imageConfigurationFixture();
    const model = channels.models[0];
    const generate = model?.operations.generate;
    if (!model || !generate) throw new Error('Missing mock image binding.');
    model.id = 'flux_2_dev';
    model.operations = { generate: { ...generate, status: 'unverified' } };
    model.parameters = model.parameters.map((parameter) => ({
      ...parameter,
      operations: ['generate'],
    }));
    model.priceCards = [];
    await db.insert(appMetadata).values({
      key: IMAGE_CHANNELS_KEY,
      value: JSON.stringify(channels),
    });
    expect(await createModelConfigurationReadMethods(db).get()).toEqual(saved);
    const routing = await createImageChannelsReadMethods(db).getSnapshot();
    expect(routing).toHaveLength(1);
    expect(routing[0]).toMatchObject({
      modelId: 'flux_2_dev',
      operations: { generate: { status: 'unverified' } },
    });
    await expect(admin.save(saved)).rejects.toThrow();
    expect(await createModelConfigurationReadMethods(db).get()).toEqual(saved);
  });
});

function unverifiedImageDefaultFixture(id: ImageChannelModelId) {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  const generate = model?.operations.generate;
  if (!model || !generate) throw new Error('Missing mock image binding.');
  model.id = id;
  model.operations = { generate: { ...generate, status: 'unverified' } };
  model.parameters = [];
  model.priceCards = [];
  return configuration;
}

describe('code-default image availability in database saves', () => {
  it('rejects changing a valid default to an unavailable code default without writing', async () => {
    const admin = createModelConfigurationAdminMethods(db);
    const saved = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultImage: 'flux_2_dev' as const,
      qualityImage: 'flux_2_dev' as const,
    };
    await admin.save(saved);
    await db.insert(appMetadata).values({
      key: IMAGE_CHANNELS_KEY,
      value: JSON.stringify(
        unverifiedImageDefaultFixture(DEFAULT_MODEL_CONFIGURATION.defaultImage)
      ),
    });
    const records = await db.select().from(appMetadata);
    await expect(
      admin.save({
        ...saved,
        defaultImage: DEFAULT_MODEL_CONFIGURATION.defaultImage,
      })
    ).rejects.toThrow();
    expect(await db.select().from(appMetadata)).toEqual(records);
    expect(await createModelConfigurationReadMethods(db).get()).toEqual(saved);
  });

  it('keeps an unavailable saved code default readable and rejects resaving it', async () => {
    const admin = createModelConfigurationAdminMethods(db);
    await admin.save({ ...DEFAULT_MODEL_CONFIGURATION });
    await db.insert(appMetadata).values({
      key: IMAGE_CHANNELS_KEY,
      value: JSON.stringify(
        unverifiedImageDefaultFixture(DEFAULT_MODEL_CONFIGURATION.defaultImage)
      ),
    });
    const records = await db.select().from(appMetadata);
    expect(await createModelConfigurationReadMethods(db).get()).toEqual(
      DEFAULT_MODEL_CONFIGURATION
    );
    await expect(
      admin.save({ ...DEFAULT_MODEL_CONFIGURATION })
    ).rejects.toThrow();
    expect(await db.select().from(appMetadata)).toEqual(records);
  });
});

describe('hidden built-in image default recovery', () => {
  it('restores the hidden built-in poster fallback when its unavailable channel is disabled', async () => {
    const admin = createModelConfigurationAdminMethods(db);
    await admin.save({ ...DEFAULT_MODEL_CONFIGURATION });
    const configuration = unverifiedImageDefaultFixture(
      DEFAULT_MODEL_CONFIGURATION.poster
    );
    await db.insert(appMetadata).values({
      key: IMAGE_CHANNELS_KEY,
      value: JSON.stringify(configuration),
    });
    expect(await admin.get()).toEqual(DEFAULT_MODEL_CONFIGURATION);
    await expect(
      admin.save({ ...DEFAULT_MODEL_CONFIGURATION })
    ).rejects.toThrow();
    const channel = configuration.channels[0];
    if (!channel) throw new Error('Missing mock image channel.');
    await createImageChannelsAdminMethods(db).saveChannel({
      revision: configuration.revision,
      id: channel.id,
      name: channel.name,
      baseUrl: channel.baseUrl,
      protocol: channel.protocol,
      enabled: false,
    });
    expect(await admin.save({ ...DEFAULT_MODEL_CONFIGURATION })).toEqual(
      DEFAULT_MODEL_CONFIGURATION
    );
    expect(await createModelConfigurationReadMethods(db).get()).toEqual(
      DEFAULT_MODEL_CONFIGURATION
    );
  });
});
