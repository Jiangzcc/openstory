import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
// oxlint-disable-next-line boundaries/no-raw-db -- isolated migrated D1 for the real workflow base
import { getDb } from '#db-client';
import { generateId } from '@/platform/id';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createModelConfigurationAdminMethods } from '@/models/server/db/model-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
} from '@/models/model-runtime-configuration';
import type { TextModelRoute } from '@/models/text-channels';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { asStub } from '@/test/as-stub';
import { OpenStoryWorkflowEntrypoint } from './base-workflow';
import { buildChildInstanceId, spawnAndAwaitChild } from './await-child';
import type { ParentNotifyHint } from './await-child';
import type { CloudflareEnv, UserWorkflowContext } from './types';

const network = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('Unexpected network in synthetic child composition');
  })
);
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({ getEnv: () => ({ E2E_TEST: 'false' }) }));
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

// Synthetic workflows and a deterministic step/event double; base, ScopedDb, codecs, spawn and notify are real.
type Payload = UserWorkflowContext & {
  depth: number;
  original: string;
  failAt?: number;
  abortAt?: number;
  _parent?: ParentNotifyHint;
};
type Observation = {
  instanceId: string;
  depth: number;
  userId: string;
  organizationId: string;
  promptLocale: Payload['promptLocale'];
  models: ModelRuntimeConfiguration;
  reservationId?: string;
  ownsReservation?: boolean;
};
type Job = {
  id: string;
  params: Payload;
  status: string;
  output?: unknown;
  error?: { name: string; message: string };
};
type Notification = { type: string; payload: unknown };
type HarnessOptions = {
  retrySpawn?: boolean;
  notification?: 'drop' | 'finite';
  cacheSteps?: boolean;
};
let database: Awaited<ReturnType<typeof createTestDb>>;
const queries: Array<{ sql: string; params: unknown[] }> = [];

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic child fixture');
  return value;
}

function jsonWire<T>(value: T): T {
  if (value === undefined) return value;
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return asStub<T>(parsed);
}

function configuration(tag: string): ModelRuntimeConfiguration {
  const text: TextModelRoute = {
    modelId: 'custom:g03',
    name: 'Synthetic ' + tag,
    upstreamModel: 'upstream-' + tag,
    channelId: 'channel-' + tag,
    protocol: tag === 'a' ? 'openai-responses' : 'openai-chat-completions',
    baseUrl: 'https://' + tag + '.invalid/v1',
    credentialId: generateId(),
    vision: true,
    structuredOutput: true,
    tools: false,
    contextWindow: 32000,
    maxOutputTokens: 4000,
    inputPricePerMillion: tag === 'a' ? 0 : 0.25,
    outputPricePerMillion: 0.75,
  };
  const image = required(
    createImageModelRoutingSnapshot(imageConfigurationFixture())[0]
  );
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultAnalysis: text.modelId,
    sceneSplit: text.modelId,
    defaultImage: image.modelId,
    textModelRouting: [text],
    imageModelRouting: [
      {
        ...image,
        baseUrl: 'https://image-' + tag + '.invalid/v1',
        credentialId: generateId(),
      },
    ],
  };
}

function payload(
  snapshot: ModelRuntimeConfiguration,
  promptLocale: Payload['promptLocale'] = 'zh-CN',
  depth = 2
): Payload {
  return {
    userId: generateId(),
    organizationId: generateId(),
    promptLocale,
    modelConfiguration: packModelRuntimeConfiguration(snapshot),
    depth,
    original: '原文 unchanged dialogue',
    reservationId: generateId(),
    ownsReservation: false,
  };
}

function harness(options: HarnessOptions = {}) {
  const jobs = new Map<string, Job>();
  const notifications = new Map<string, Notification>();
  const sent: Array<{ parentId: string; event: Notification }> = [];
  const observed: Observation[] = [];
  const failures: Observation[] = [];
  const stepNames: Array<{ instanceId: string; name: string }> = [];
  const waits: Array<{
    instanceId: string;
    name: string;
    type: string;
    timeout: unknown;
  }> = [];
  const caches = new Map<string, Map<string, unknown>>();
  const aborted = new Set<string>();
  let interrupted = false;
  const spawnInterruption = new Error(
    'Synthetic create landed before step checkpoint'
  );
  const create = vi.fn(async (input: { id?: string; params: Payload }) => {
    const id = required(input.id);
    if (jobs.has(id))
      throw new Error('(instance.already_exists) Instance already exists');
    jobs.set(id, { id, params: jsonWire(input.params), status: 'queued' });
    if (options.retrySpawn && !interrupted) {
      interrupted = true;
      throw spawnInterruption;
    }
    return undefined;
  });
  const getChild = vi.fn(async (id: string) => ({
    status: async () => {
      const job = required(jobs.get(id));
      return { status: job.status, output: job.output, error: job.error };
    },
  }));
  const binding = asStub<Workflow<Payload>>({ create, get: getChild });
  const getParent = vi.fn(async (parentId: string) => ({
    sendEvent: async (event: Notification) => {
      sent.push({ parentId, event: jsonWire(event) });
      if (options.notification === 'finite')
        throw new Error(
          '(instance.in_finite_state) Instance reached a finite state'
        );
      if (options.notification !== 'drop')
        notifications.set(parentId + ':' + event.type, jsonWire(event));
    },
  }));
  const env = asStub<CloudflareEnv>({
    STORYBOARD_WORKFLOW: { create, get: getParent },
  });

  function observe(
    event: Readonly<WorkflowEvent<Payload>>,
    db: WorkflowScopedDb
  ): Observation {
    return {
      instanceId: event.instanceId,
      depth: event.payload.depth,
      userId: db.userId,
      organizationId: db.organizationId,
      promptLocale: event.payload.promptLocale,
      models: db.models,
      reservationId: event.payload.reservationId,
      ownsReservation: event.payload.ownsReservation,
    };
  }

  class SyntheticChildTreeWorkflow extends OpenStoryWorkflowEntrypoint<Payload> {
    protected override readonly failureLabel = 'Synthetic child tree';
    protected override async runImpl(
      event: Readonly<WorkflowEvent<Payload>>,
      step: WorkflowStep,
      db: WorkflowScopedDb
    ): Promise<unknown> {
      const input = event.payload;
      observed.push(observe(event, db));
      if (input.abortAt === input.depth && !aborted.has(event.instanceId)) {
        aborted.add(event.instanceId);
        throw new Error('Aborting engine: Grace period complete');
      }
      if (input.failAt === input.depth)
        throw new Error('Synthetic leaf failed');
      if (input.depth === 0)
        return { ...observe(event, db), original: input.original };
      return spawnAndAwaitChild(step, {
        binding,
        parentBindingName: 'STORYBOARD_WORKFLOW',
        parentInstanceId: event.instanceId,
        childId: 'synthetic:child:' + (input.depth - 1),
        modelConfiguration: db.models,
        childPayload: {
          userId: input.userId,
          organizationId: input.organizationId,
          promptLocale: input.promptLocale,
          depth: input.depth - 1,
          original: input.original,
          failAt: input.failAt,
          abortAt: input.abortAt,
          reservationId: input.reservationId,
          ownsReservation: false,
          modelConfiguration: packModelRuntimeConfiguration(
            configuration('forged')
          ),
          _parent: {
            bindingName: 'IMAGE_WORKFLOW',
            parentInstanceId: 'forged-parent',
            eventType: 'forged-event',
          },
        },
        spawnStepName: 'spawn-child-' + input.depth,
        awaitStepName: 'await-child-' + input.depth,
        timeout: '12 minutes',
      });
    }
    protected override onFailure(failure: {
      event: Readonly<WorkflowEvent<Payload>>;
      scopedDb: WorkflowScopedDb;
    }) {
      failures.push(observe(failure.event, failure.scopedDb));
    }
  }

  function makeStep(instanceId: string): WorkflowStep {
    const cache = caches.get(instanceId) ?? new Map<string, unknown>();
    caches.set(instanceId, cache);
    return asStub<WorkflowStep>({
      do: async (name: string, callback: () => Promise<unknown>) => {
        stepNames.push({ instanceId, name });
        if (options.cacheSteps && cache.has(name))
          return jsonWire(cache.get(name));
        let result: unknown;
        try {
          result = await callback();
        } catch (error) {
          if (error !== spawnInterruption) throw error;
          result = await callback();
        }
        if (options.cacheSteps) cache.set(name, jsonWire(result));
        return jsonWire(result);
      },
      waitForEvent: async (
        name: string,
        args: { type: string; timeout: unknown }
      ) => {
        waits.push({ instanceId, name, ...args });
        const pending = [...jobs.values()].find(
          (job) =>
            job.params._parent?.parentInstanceId === instanceId &&
            job.params._parent.eventType === args.type
        );
        const job = required(pending);
        if (job.status === 'queued') await execute(job);
        const event = notifications.get(instanceId + ':' + args.type);
        if (!event) throw new Error('Synthetic notification deadline elapsed');
        return jsonWire(event);
      },
    });
  }

  async function run(input: Payload, instanceId = 'synthetic-parent') {
    type Ctor = ConstructorParameters<typeof SyntheticChildTreeWorkflow>;
    const workflow = new SyntheticChildTreeWorkflow(
      asStub<Ctor[0]>(undefined),
      env
    );
    return workflow.run(
      asStub<WorkflowEvent<Payload>>({
        instanceId,
        timestamp: new Date(),
        payload: jsonWire(input),
      }),
      makeStep(instanceId)
    );
  }

  async function execute(job: Job) {
    job.status = 'running';
    try {
      try {
        job.output = await run(job.params, job.id);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes('Aborting engine:')
        )
          throw error;
        job.output = await run(job.params, job.id);
      }
      job.status = 'complete';
    } catch (error) {
      job.status = 'errored';
      job.error = {
        name: 'Error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    run,
    create,
    getChild,
    getParent,
    jobs,
    sent,
    observed,
    failures,
    stepNames,
    waits,
  };
}

function assertNoLiveConfigurationReads() {
  expect(
    queries.filter(
      (q) => /^select/i.test(q.sql) && q.sql.includes('app_metadata')
    )
  ).toEqual([]);
  expect(network).not.toHaveBeenCalled();
}

beforeAll(async () => {
  database = await createTestDb({
    logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
  });
  vi.mocked(getDb).mockReturnValue(database.db);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await database.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', network);
  await createModelConfigurationAdminMethods(database.db).save(
    DEFAULT_MODEL_CONFIGURATION
  );
  queries.length = 0;
});

describe('parent to child snapshot composition', () => {
  it('keeps concurrent parents and grandchildren isolated after administrator settings change', async () => {
    const snapshots = [configuration('a'), configuration('b')];
    const inputs = [
      payload(required(snapshots[0]), 'zh-CN'),
      payload(required(snapshots[1]), 'en'),
    ];
    await createModelConfigurationAdminMethods(database.db).save({
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultAnalysis: DEFAULT_MODEL_CONFIGURATION.turboAnalysis,
    });
    queries.length = 0;
    const tree = harness();
    await Promise.all(
      inputs.map((input, index) => tree.run(input, 'parent-' + index))
    );
    expect(tree.create).toHaveBeenCalledTimes(4);
    for (const input of inputs) {
      const records = tree.observed.filter(
        (row) => row.userId === input.userId
      );
      expect(records).toHaveLength(3);
      for (const record of records) {
        expect(record).toMatchObject({
          organizationId: input.organizationId,
          promptLocale: input.promptLocale,
          reservationId: input.reservationId,
          ownsReservation: false,
        });
        expect(record.models).toEqual(
          unpackModelRuntimeConfiguration(required(input.modelConfiguration))
        );
      }
    }
    expect(new Set(tree.jobs.keys()).size).toBe(4);
    assertNoLiveConfigurationReads();
  });

  it('overwrites forged child settings and parent hints before the real child base consumes them', async () => {
    const input = payload(configuration('a'), 'en', 1);
    const tree = harness();
    const result = await tree.run(input);
    const job = required([...tree.jobs.values()][0]);
    expect(job.params.modelConfiguration).toEqual(input.modelConfiguration);
    expect(job.params._parent).toMatchObject({
      bindingName: 'STORYBOARD_WORKFLOW',
      parentInstanceId: 'synthetic-parent',
    });
    expect(job.params._parent?.eventType).not.toContain('forged');
    expect(result).toMatchObject({
      userId: input.userId,
      organizationId: input.organizationId,
      promptLocale: 'en',
      original: input.original,
    });
    expect(tree.sent).toHaveLength(1);
    expect(tree.sent[0]?.parentId).toBe('synthetic-parent');
    expect(tree.waits[0]).toMatchObject({
      name: 'await-child-1',
      timeout: '12 minutes',
    });
    expect(job.id).toBe(
      buildChildInstanceId('synthetic:child:0', 'synthetic-parent')
    );
    assertNoLiveConfigurationReads();
  });

  it.each(['empty', 'legacy'] as const)(
    'preserves %s routing through two child levels without loading the registry',
    async (kind) => {
      const snapshot =
        kind === 'empty'
          ? {
              ...DEFAULT_MODEL_CONFIGURATION,
              textModelRouting: [],
              imageModelRouting: [],
            }
          : { ...DEFAULT_MODEL_CONFIGURATION };
      const tree = harness();
      await tree.run(payload(snapshot));
      expect(tree.observed).toHaveLength(3);
      expect(tree.observed.map((row) => row.models)).toEqual([
        snapshot,
        snapshot,
        snapshot,
      ]);
      assertNoLiveConfigurationReads();
    }
  );

  it('reuses cached spawn and notification steps without replacing an existing queued child', async () => {
    const input = payload(configuration('a'), 'zh-CN', 1);
    const tree = harness({ cacheSteps: true });
    const first = await tree.run(input);
    const wireBefore = jsonWire([...tree.jobs.values()]);
    const second = await tree.run(input);
    expect(second).toEqual(first);
    expect(tree.create).toHaveBeenCalledTimes(1);
    expect(tree.sent).toHaveLength(1);
    expect([...tree.jobs.values()]).toEqual(wireBefore);
    assertNoLiveConfigurationReads();
  });

  it('recovers an already-created child when the spawn callback retries before its checkpoint', async () => {
    const input = payload(configuration('a'), 'en', 1);
    const tree = harness({ retrySpawn: true });
    await expect(tree.run(input)).resolves.toMatchObject({
      promptLocale: 'en',
    });
    expect(tree.create).toHaveBeenCalledTimes(2);
    expect(tree.jobs.size).toBe(1);
    expect(tree.observed).toHaveLength(2);
    expect(
      required([...tree.jobs.values()][0]).params.modelConfiguration
    ).toEqual(input.modelConfiguration);
    assertNoLiveConfigurationReads();
  });

  it.each(['drop', 'finite'] as const)(
    'recovers completed child output with the frozen configuration when notify is %s',
    async (notification) => {
      const input = payload(configuration('b'), 'zh-CN', 1);
      const tree = harness({ notification });
      await expect(tree.run(input)).resolves.toMatchObject({
        models: unpackModelRuntimeConfiguration(
          required(input.modelConfiguration)
        ),
        promptLocale: 'zh-CN',
      });
      expect(tree.getChild).toHaveBeenCalledTimes(1);
      expect(tree.failures).toEqual([]);
      expect(tree.stepNames).toContainEqual({
        instanceId: 'synthetic-parent',
        name: 'await-child-1-status-fallback',
      });
      assertNoLiveConfigurationReads();
    }
  );

  it('propagates real child failure and keeps the same snapshot in child and parent failure handlers', async () => {
    const input = { ...payload(configuration('b'), 'en', 1), failAt: 0 };
    const tree = harness();
    await expect(tree.run(input)).rejects.toThrow('Synthetic leaf failed');
    expect(tree.failures).toHaveLength(2);
    for (const failure of tree.failures) {
      expect(failure.models).toEqual(
        unpackModelRuntimeConfiguration(required(input.modelConfiguration))
      );
      expect(failure).toMatchObject({
        userId: input.userId,
        organizationId: input.organizationId,
        promptLocale: 'en',
        reservationId: input.reservationId,
        ownsReservation: false,
      });
    }
    expect(tree.sent[0]?.event.payload).toMatchObject({
      status: 'failed',
      error: 'Synthetic leaf failed',
    });
    assertNoLiveConfigurationReads();
  });

  it('resumes an interrupted child from its queued input without sending a terminal failure', async () => {
    const input = { ...payload(configuration('a'), 'zh-CN', 1), abortAt: 0 };
    const tree = harness({ cacheSteps: true });
    await expect(tree.run(input)).resolves.toMatchObject({
      promptLocale: 'zh-CN',
    });
    expect(tree.observed).toHaveLength(3);
    expect(tree.failures).toEqual([]);
    expect(tree.sent.map((row) => row.event.payload)).toEqual([
      expect.objectContaining({ status: 'ok' }),
    ]);
    for (const row of tree.observed)
      expect(row.models).toEqual(
        unpackModelRuntimeConfiguration(required(input.modelConfiguration))
      );
    assertNoLiveConfigurationReads();
  });
});
