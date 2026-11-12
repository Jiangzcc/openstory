import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { eq } from 'drizzle-orm';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
// oxlint-disable-next-line boundaries/no-raw-db -- replace only the DB handle with the isolated migrated D1
import { getDb } from '#db-client';
import { generateId } from '@/platform/id';
import { createTestDb } from '@/platform/server/db/test-d1';
import { appMetadata } from '@/platform/server/db/schema';
import { createApiKeysReadMethods } from '@/models/server/db/api-keys';
import { loadModelRuntimeConfiguration } from '@/platform/server/db/scoped';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { SaveChannelImageModelInput } from '@/models/image-channels';
import {
  createModelConfigurationAdminMethods,
  MODEL_CONFIGURATION_KEY,
} from '@/models/server/db/model-configuration';
import {
  createTextChannelsAdminMethods,
  TEXT_CHANNELS_KEY,
  TEXT_CHANNEL_CREDENTIAL_PREFIX,
} from '@/models/server/db/text-channels';
import {
  createImageChannelsAdminMethods,
  IMAGE_CHANNELS_KEY,
  IMAGE_CHANNEL_CREDENTIAL_PREFIX,
} from '@/models/server/db/image-channels';
import { OpenStoryWorkflowEntrypoint } from './base-workflow';
import { triggerWorkflowRun } from './client';
import type { UserWorkflowContext } from './types';
import { asStub } from '@/test/as-stub';

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  network: vi.fn(async () => {
    throw new Error('Unexpected network in synthetic snapshot composition');
  }),
  env: {
    API_KEY_ENCRYPTION_KEY: 'synthetic-local-snapshot-encryption-secret',
    OPENROUTER_KEY: 'synthetic-fallback-key',
    FAL_KEY: 'synthetic-fal-key',
    E2E_TEST: 'false',
  },
}));
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({
  getEnv: () => ({
    ...runtime.env,
    STORYBOARD_WORKFLOW: { create: runtime.create, get: runtime.get },
  }),
}));
vi.mock('@/models/server/fal-config', () => ({
  configureFalProxyFromEnv: vi.fn(),
}));
vi.mock('@/billing/server/seed-model-pricing', () => ({
  ensureE2eModelPricing: vi.fn(async () => undefined),
}));
vi.mock('@/platform/server/observability/flush-analytics', () => ({
  flushAnalytics: vi.fn(async () => undefined),
}));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));

// The binding and step runner are no-work doubles; DB, codecs, dispatch, base and credentials stay real.
type Payload = UserWorkflowContext & { script: string };
type Queued = { id: string; params: Payload };
let database: Awaited<ReturnType<typeof createTestDb>>;
const queued = new Map<string, Queued>();
const queries: Array<{ sql: string; params: unknown[] }> = [];
const actor = {
  userId: generateId(),
  organizationId: generateId(),
  promptLocale: 'zh-CN' as const,
};
const textId = 'custom:p3-snapshot' as const;
const imageId = 'custom-image:p3-snapshot' as const;
const textChannel = {
  revision: 0,
  id: 'synthetic-text-channel',
  name: 'Synthetic text channel',
  protocol: 'openai-chat-completions' as const,
  baseUrl: 'https://original-text.example.invalid/v1',
  enabled: true,
  userAgent: 'synthetic-original-agent',
  apiKey: 'synthetic-original-text-key',
};
const textModel = {
  revision: 1,
  id: textId,
  name: 'Synthetic text model',
  channelId: textChannel.id,
  upstreamModel: 'synthetic/original-text',
  enabled: true,
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 32000,
  maxOutputTokens: 4000,
  inputPricePerMillion: 0.25,
  outputPricePerMillion: 0.75,
};
const imageChannel = {
  revision: 0,
  id: 'synthetic-image-channel',
  name: 'Synthetic image channel',
  protocol: 'openai-images' as const,
  baseUrl: 'https://original-image.example.invalid/v1',
  enabled: true,
  apiKey: 'synthetic-original-image-key',
};
const imageModel: SaveChannelImageModelInput = {
  revision: 1,
  id: imageId,
  name: 'Synthetic image model',
  channelId: imageChannel.id,
  enabled: true,
  operations: {
    generate: {
      upstreamModel: 'synthetic/original-image',
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

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Missing synthetic snapshot fixture');
  return value;
}

async function saveOriginal() {
  const texts = createTextChannelsAdminMethods(database.db);
  await texts.saveChannel(textChannel);
  await texts.saveModel(textModel);
  const images = createImageChannelsAdminMethods(database.db);
  await images.saveChannel(imageChannel);
  await images.saveModel(imageModel);
  await createModelConfigurationAdminMethods(database.db).save({
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultAnalysis: textId,
    sceneSplit: textId,
    defaultImage: imageId,
  });
  return loadModelRuntimeConfiguration();
}

async function replaceAdministratorSettings() {
  const texts = createTextChannelsAdminMethods(database.db);
  const changedTextChannel = await texts.saveChannel({
    ...textChannel,
    revision: 2,
    protocol: 'openai-responses',
    baseUrl: 'https://replacement-text.example.invalid/v1',
    apiKey: 'synthetic-replacement-text-key',
    userAgent: 'synthetic-replacement-agent',
  });
  await texts.saveModel({
    ...textModel,
    revision: changedTextChannel.revision,
    upstreamModel: 'synthetic/replacement-text',
    vision: false,
    tools: false,
    contextWindow: 64000,
    maxOutputTokens: 8000,
    inputPricePerMillion: 9,
    outputPricePerMillion: 19,
  });
  const images = createImageChannelsAdminMethods(database.db);
  const changedImageChannel = await images.saveChannel({
    ...imageChannel,
    revision: 2,
    baseUrl: 'https://replacement-image.example.invalid/v1',
    apiKey: 'synthetic-replacement-image-key',
  });
  await images.saveModel({
    ...imageModel,
    revision: changedImageChannel.revision,
    priceCards: [
      { id: 'base', operation: 'generate', match: {}, unitPriceUsd: 0.99 },
    ],
  });
  await createModelConfigurationAdminMethods(database.db).save(
    DEFAULT_MODEL_CONFIGURATION
  );
  return loadModelRuntimeConfiguration();
}

function metadataReads() {
  return queries
    .filter((q) => /^select\b/i.test(q.sql) && q.sql.includes('app_metadata'))
    .flatMap((q) => q.params);
}

function expectNoLiveConfigurationRead() {
  expect(metadataReads()).not.toContain(MODEL_CONFIGURATION_KEY);
  expect(metadataReads()).not.toContain(TEXT_CHANNELS_KEY);
  expect(metadataReads()).not.toContain(IMAGE_CHANNELS_KEY);
  for (const query of queries.filter(
    (q) => /^select\b/i.test(q.sql) && q.sql.includes('app_metadata')
  )) {
    const key = query.params[0];
    expect(
      typeof key === 'string' &&
        (key.startsWith(TEXT_CHANNEL_CREDENTIAL_PREFIX) ||
          key.startsWith(IMAGE_CHANNEL_CREDENTIAL_PREFIX))
    ).toBe(true);
  }
  expect(runtime.network).not.toHaveBeenCalled();
}

function queuedFor(id: string): Payload {
  return structuredClone(required(queued.get(id)).params);
}

async function trigger(
  snapshot?: ModelRuntimeConfiguration,
  extra: Partial<Payload> = {},
  deduplicationId?: string
) {
  return triggerWorkflowRun(
    '/storyboard',
    { ...actor, script: '原文保持 original content', ...extra },
    {
      ...(snapshot === undefined ? {} : { modelConfiguration: snapshot }),
      deduplicationId,
    }
  );
}

async function inspect(scopedDb: WorkflowScopedDb) {
  const text = required(scopedDb.models.textModelRouting?.[0]);
  const image = required(scopedDb.credentials.imageModelRouting?.[0]);
  return {
    userId: scopedDb.userId,
    organizationId: scopedDb.organizationId,
    models: scopedDb.models,
    llm: await scopedDb.credentials.resolveLlmKey(text.modelId),
    imageKey: await required(scopedDb.credentials.resolveImageChannelKey)(
      image.credentialId
    ),
  };
}

function makeRunner(
  impl: (db: WorkflowScopedDb) => Promise<unknown> = inspect
) {
  const onFailure = vi.fn();
  class SnapshotCompositionWorkflow extends OpenStoryWorkflowEntrypoint<Payload> {
    protected override readonly failureLabel = 'Synthetic snapshot composition';
    protected override runImpl(
      _event: Readonly<WorkflowEvent<Payload>>,
      _step: WorkflowStep,
      db: WorkflowScopedDb
    ) {
      return impl(db);
    }
    protected override onFailure(failure: { scopedDb: WorkflowScopedDb }) {
      onFailure(failure.scopedDb);
    }
  }
  type Ctor = ConstructorParameters<typeof SnapshotCompositionWorkflow>;
  const workflow = new SnapshotCompositionWorkflow(
    asStub<Ctor[0]>(undefined),
    asStub<Ctor[1]>({})
  );
  const run = (payload: Payload, instanceId = 'synthetic-run') =>
    workflow.run(
      asStub<WorkflowEvent<Payload>>({
        instanceId,
        timestamp: new Date(),
        payload,
      }),
      asStub<WorkflowStep>({
        do: vi.fn((_name: string, callback: () => Promise<unknown>) =>
          callback()
        ),
      })
    );
  return { run, onFailure };
}

beforeAll(async () => {
  database = await createTestDb({
    logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
  });
  vi.mocked(getDb).mockReturnValue(database.db);
});
afterAll(() => {
  vi.unstubAllGlobals();
  return database.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', runtime.network);
  queued.clear();
  await database.db.delete(appMetadata);
  queries.length = 0;
  runtime.create.mockImplementation(async ({ id, params }: Queued) => {
    if (queued.has(id))
      throw new Error('(instance.already_exists) Instance already exists');
    queued.set(id, { id, params: JSON.parse(JSON.stringify(params)) });
    return { id };
  });
  runtime.get.mockImplementation(async (id: string) => {
    if (!queued.has(id)) throw new Error('Unknown synthetic instance');
    return { status: async () => ({ status: 'complete' }) };
  });
});

describe('real D1 capture through root dispatch, JSON wire and workflow base', () => {
  it('overwrites body configuration with the current server capture and never queues a secret', async () => {
    const original = await saveOriginal();
    queries.length = 0;
    const result = await trigger(undefined, {
      modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
    });
    expect(result.reused).toBe(false);
    const payload = queuedFor(result.workflowRunId);
    expect(payload).toMatchObject({
      ...actor,
      script: '原文保持 original content',
      modelConfiguration: {
        defaultAnalysis: textId,
        sceneSplit: textId,
        defaultImage: imageId,
      },
    });
    expect(payload.modelConfiguration).toHaveProperty(
      'textModelRouting.version',
      1
    );
    expect(payload.modelConfiguration).toHaveProperty(
      'imageModelRouting.version',
      2
    );
    for (const key of [
      MODEL_CONFIGURATION_KEY,
      TEXT_CHANNELS_KEY,
      IMAGE_CHANNELS_KEY,
    ])
      expect(metadataReads()).toContain(key);
    const wire = JSON.stringify(payload);
    for (const secret of [
      runtime.env.API_KEY_ENCRYPTION_KEY,
      textChannel.apiKey,
      imageChannel.apiKey,
    ])
      expect(wire).not.toContain(secret);
    expect(original.textModelRouting?.[0]?.credentialId).toBeTruthy();
    expect(wire).toContain(
      required(original.textModelRouting?.[0]).credentialId
    );
    expect(wire).toContain(
      required(original.imageModelRouting?.[0]).credentialId
    );
    expect(runtime.network).not.toHaveBeenCalled();
  });

  it('dispatches the exact prepared trusted snapshot even after the administrator changes defaults, channels and rates', async () => {
    const prepared = await saveOriginal();
    const replacement = await replaceAdministratorSettings();
    expect(replacement.defaultAnalysis).not.toBe(prepared.defaultAnalysis);
    expect(replacement.textModelRouting?.[0]?.protocol).toBe(
      'openai-responses'
    );
    queries.length = 0;
    const result = await trigger(prepared, { modelConfiguration: replacement });
    expectNoLiveConfigurationRead();
    const output = await makeRunner().run(queuedFor(result.workflowRunId));
    expect(output).toMatchObject({
      userId: actor.userId,
      organizationId: actor.organizationId,
      models: { defaultAnalysis: textId, defaultImage: imageId },
      llm: {
        key: textChannel.apiKey,
        source: 'platform',
        via: 'compatible',
        route: {
          protocol: textChannel.protocol,
          upstreamModel: textModel.upstreamModel,
          baseUrl: textChannel.baseUrl,
          userAgent: textChannel.userAgent,
          contextWindow: textModel.contextWindow,
          maxOutputTokens: textModel.maxOutputTokens,
          inputPricePerMillion: 0.25,
          outputPricePerMillion: 0.75,
        },
      },
      imageKey: imageChannel.apiKey,
    });
    expectNoLiveConfigurationRead();
  });

  it('replays queued endpoint, capability, price and immutable credential references after real DB edits', async () => {
    const original = await saveOriginal();
    const result = await trigger();
    const oldPayload = queuedFor(result.workflowRunId);
    const oldWire = JSON.stringify(oldPayload);
    const replacement = await replaceAdministratorSettings();
    expect(required(replacement.textModelRouting?.[0]).credentialId).not.toBe(
      required(original.textModelRouting?.[0]).credentialId
    );
    expect(required(replacement.imageModelRouting?.[0]).credentialId).not.toBe(
      required(original.imageModelRouting?.[0]).credentialId
    );
    queries.length = 0;
    for (let invocation = 0; invocation < 2; invocation++) {
      const output = await makeRunner().run(oldPayload);
      expect(output).toMatchObject({
        models: {
          defaultAnalysis: textId,
          sceneSplit: textId,
          defaultImage: imageId,
          textModelRouting: [
            {
              vision: true,
              structuredOutput: true,
              tools: true,
              contextWindow: 32000,
              maxOutputTokens: 4000,
              inputPricePerMillion: 0.25,
              outputPricePerMillion: 0.75,
            },
          ],
          imageModelRouting: [
            {
              baseUrl: imageChannel.baseUrl,
              operations: {
                generate: { upstreamModel: 'synthetic/original-image' },
              },
              priceCards: [{ unitPriceUsd: 0.04 }],
            },
          ],
        },
        llm: {
          key: textChannel.apiKey,
          via: 'compatible',
          route: {
            baseUrl: textChannel.baseUrl,
            protocol: textChannel.protocol,
            upstreamModel: textModel.upstreamModel,
          },
        },
        imageKey: imageChannel.apiKey,
      });
      expectNoLiveConfigurationRead();
    }
    expect(JSON.stringify(oldPayload)).toBe(oldWire);
    const fresh = await createApiKeysReadMethods(
      database.db,
      actor.organizationId
    ).resolveLlmKey(textId);
    expect(fresh).toMatchObject({
      key: 'synthetic-replacement-text-key',
      via: 'compatible',
      route: {
        protocol: 'openai-responses',
        baseUrl: 'https://replacement-text.example.invalid/v1',
        inputPricePerMillion: 9,
      },
    });
    expect(metadataReads()).toContain(TEXT_CHANNELS_KEY);
  });

  it('retains the same frozen models in failure handling without loading replacement configuration', async () => {
    await saveOriginal();
    const { workflowRunId } = await trigger();
    await replaceAdministratorSettings();
    queries.length = 0;
    const runner = makeRunner(async () => {
      throw new Error('Synthetic generation failure');
    });
    await expect(runner.run(queuedFor(workflowRunId))).rejects.toThrow(
      'Synthetic generation failure'
    );
    expect(runner.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.objectContaining({
          defaultAnalysis: textId,
          defaultImage: imageId,
        }),
      })
    );
    expectNoLiveConfigurationRead();
  });

  it.each(['text', 'image'] as const)(
    'refuses a missing frozen %s credential despite a usable replacement and platform fallback',
    async (kind) => {
      const original = await saveOriginal();
      const { workflowRunId } = await trigger();
      await replaceAdministratorSettings();
      const credentialId =
        kind === 'text'
          ? required(original.textModelRouting?.[0]).credentialId
          : required(original.imageModelRouting?.[0]).credentialId;
      const prefix =
        kind === 'text'
          ? TEXT_CHANNEL_CREDENTIAL_PREFIX
          : IMAGE_CHANNEL_CREDENTIAL_PREFIX;
      await database.db
        .delete(appMetadata)
        .where(eq(appMetadata.key, prefix + credentialId));
      queries.length = 0;
      const runner = makeRunner(async (db) =>
        kind === 'text'
          ? db.credentials.resolveLlmKey(textId)
          : required(db.credentials.resolveImageChannelKey)(credentialId)
      );
      await expect(runner.run(queuedFor(workflowRunId))).rejects.toThrow(
        'credential is unavailable'
      );
      expect(runner.onFailure).toHaveBeenCalledOnce();
      expectNoLiveConfigurationRead();
    }
  );

  it('preserves explicit empty routes and ignores populated body routes without reading current channels', async () => {
    const original = await saveOriginal();
    const empty = {
      ...DEFAULT_MODEL_CONFIGURATION,
      textModelRouting: [],
      imageModelRouting: [],
    };
    queries.length = 0;
    const { workflowRunId } = await trigger(empty, {
      modelConfiguration: original,
    });
    const output = await makeRunner(async (db) => db.models).run(
      queuedFor(workflowRunId)
    );
    expect(output).toEqual(empty);
    expectNoLiveConfigurationRead();
  });

  it('uses code defaults for a legacy wire without a snapshot while keeping required identity and locale', async () => {
    await saveOriginal();
    queries.length = 0;
    const output = await makeRunner(async (db) => ({
      models: db.models,
      llm: await db.credentials.resolveLlmKey('openai/gpt-5.4-mini'),
    })).run({ ...actor, script: 'legacy model wire only' });
    expect(output).toEqual({
      models: DEFAULT_MODEL_CONFIGURATION,
      llm: expect.objectContaining({
        key: runtime.env.OPENROUTER_KEY,
        source: 'platform',
        via: 'openrouter',
      }),
    });
    expectNoLiveConfigurationRead();
  });

  it('reuses an existing root instance without replacing its queued snapshot after an edit', async () => {
    const original = await saveOriginal();
    const first = await trigger(undefined, {}, 'synthetic-dedup');
    const oldPayload = queuedFor(first.workflowRunId);
    await replaceAdministratorSettings();
    const second = await trigger(undefined, {}, 'synthetic-dedup');
    expect(second).toEqual({
      workflowRunId: first.workflowRunId,
      reused: true,
    });
    expect(queuedFor(first.workflowRunId)).toEqual(oldPayload);
    expect(
      required(queuedFor(first.workflowRunId).modelConfiguration)
        .defaultAnalysis
    ).toBe(original.defaultAnalysis);
    expect(queued.size).toBe(1);
    queries.length = 0;
    expect(
      await makeRunner().run(queuedFor(first.workflowRunId))
    ).toMatchObject({
      llm: { key: textChannel.apiKey },
      imageKey: imageChannel.apiKey,
    });
    expectNoLiveConfigurationRead();
  });

  it('rejects an oversized image routing component before binding.create without truncating the trusted snapshot', async () => {
    const snapshot = await saveOriginal();
    const route = required(snapshot.imageModelRouting?.[0]);
    const oversized = {
      ...snapshot,
      imageModelRouting: [{ ...route, name: '界'.repeat(300000) }],
    };
    const unchangedName = required(oversized.imageModelRouting[0]).name;
    await expect(trigger(oversized)).rejects.toThrow();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(required(oversized.imageModelRouting[0]).name).toBe(unchangedName);
    expect(runtime.network).not.toHaveBeenCalled();
  });

  it('fails closed on invalid persisted configuration before a workflow is dispatched', async () => {
    await saveOriginal();
    await database.db
      .update(appMetadata)
      .set({ value: 'invalid synthetic JSON' })
      .where(eq(appMetadata.key, TEXT_CHANNELS_KEY));
    await expect(trigger()).rejects.toThrow(
      'Stored text channel settings are invalid'
    );
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.network).not.toHaveBeenCalled();
  });
});
