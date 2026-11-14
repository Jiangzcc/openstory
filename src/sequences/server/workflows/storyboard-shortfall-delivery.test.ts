import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import { WorkflowLoggedError } from '@/platform/server/workflow/errors';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  organization,
  sequences,
  storyboardNotifications,
  styles,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { creditsShortStatusError } from '@/billing/credits-short';
import { usdToMicros, ZERO_MICROS } from '@/billing/money';
import { asStub } from '@/test/as-stub';
import { createSequencesMethods } from '../db/sequences';

const [template] = DEFAULT_STYLE_TEMPLATES;
if (!template) throw new Error('Synthetic test requires a style');
const STYLE_CONFIG = template.config;
const SHORT = {
  sceneCount: 3,
  neededMicros: usdToMicros(2),
  remainingMicros: ZERO_MICROS,
};
const DELIVERY_FAILURE = new Error('Synthetic terminal delivery exhausted');
const ENGINE_ABORT = new Error('Aborting engine: Grace period complete');
const SQL_FAULT = 'synthetic_shortfall_notification_fault';
const STATUS = { processing: 'processing', failed: 'failed' } as const;
let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedOwner>>;

// Engine and child substitutes: invoke the real parent without dispatch or generation.
vi.doMock('@/platform/server/workflow/base-workflow', () => ({
  OpenStoryWorkflowEntrypoint: class {
    constructor(
      _context: unknown,
      readonly env: unknown
    ) {}
  },
}));
const spawn = vi.fn(async () => ({}));
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild: spawn,
}));
// External delivery is substituted; the terminal batch, receipts and cron use real D1.
const emit = vi.fn(
  async (_event: string, _data: unknown, _options?: unknown) => undefined
);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
}));
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { StoryboardWorkflow } = await import('./storyboard-workflow');
const { reconcileStoryboardNotifications } =
  await import('../reconcile-storyboard-notifications');
const { reconcileAllStuckJobs, PASS_ERRORED } =
  await import('@/platform/server/cron/reconcile-all');

class ShortfallProbe extends StoryboardWorkflow {
  invoke(
    event: Readonly<WorkflowEvent<StoryboardWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

const network = vi.fn(() => {
  throw new Error('Unexpected network in synthetic notification regression');
});
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  vi.clearAllMocks();
  emit.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', network);
  await db.delete(storyboardNotifications);
  fixture = await seedOwner();
});
afterEach(async () => {
  await db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_shortfall_notification_fault')
  );
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

async function seedOwner() {
  const organizationId = generateId();
  const userId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic organization',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic writer',
    email: userId + '@example.invalid',
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Synthetic style', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Expected a style');
  const methods = createSequencesMethods(db, organizationId, userId);
  const sequence = await methods.create({
    title: 'Synthetic storyboard',
    styleId: style.id,
    generationStopAt: 'motion',
  });
  const owner = {
    id: sequence.id,
    workflowRunId: 'synthetic-run-' + generateId(),
  };
  await db
    .update(sequences)
    .set({ status: STATUS.processing, workflowRunId: owner.workflowRunId })
    .where(eq(sequences.id, sequence.id));
  return { organizationId, userId, methods, sequence, owner };
}

function shortfallStep() {
  // Cached-plan substitute: deterministic shortfall, with no billing or model calls.
  return asStub<WorkflowStep>({
    do: async (name: string, ...args: unknown[]) => {
      if (name === 'freeze-generation-plan')
        return { plan: null, short: SHORT };
      const callback = args.at(-1);
      if (typeof callback !== 'function')
        throw new Error('Missing synthetic step callback');
      return callback();
    },
  });
}

function run() {
  const step = shortfallStep();
  const payload = asStub<StoryboardWorkflowInput>({
    sequenceId: fixture.sequence.id,
    organizationId: fixture.organizationId,
    userId: fixture.userId,
    promptLocale: 'en',
    title: 'Synthetic storyboard',
    script: 'Synthetic script',
    resume: true,
    styleConfig: STYLE_CONFIG,
    stopAt: 'motion',
    elementIds: [],
    cast: [],
  });
  const event: Readonly<WorkflowEvent<StoryboardWorkflowInput>> = {
    instanceId: fixture.owner.workflowRunId,
    workflowName: 'synthetic-storyboard',
    timestamp: new Date(0),
    payload,
  };
  const scopedDb = asStub<WorkflowScopedDb>({
    organizationId: fixture.organizationId,
    userId: fixture.userId,
    models: DEFAULT_MODEL_CONFIGURATION,
    sequences: fixture.methods,
    liveRead: {
      sequences: {
        getForUser: () =>
          fixture.methods.getForUser({ sequenceId: fixture.sequence.id }),
      },
    },
  });
  type Args = ConstructorParameters<typeof ShortfallProbe>;
  return new ShortfallProbe(
    asStub<Args[0]>(undefined),
    asStub<Args[1]>({})
  ).invoke(event, step, scopedDb);
}

async function stored() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  return row;
}
async function receipt() {
  const [row] = await db
    .select()
    .from(storyboardNotifications)
    .where(eq(storyboardNotifications.sequenceId, fixture.sequence.id));
  return row;
}
function sweep() {
  return reconcileAllStuckJobs({
    dispatchSequenceNotifications: reconcileStoryboardNotifications,
  });
}

describe('Shortfall delivery and scheduled recovery with real D1', () => {
  it('keeps the original shortfall error when sending fails and recovers through the cron entry', async () => {
    emit.mockRejectedValueOnce(DELIVERY_FAILURE);
    await expect(run()).rejects.toMatchObject({
      name: WorkflowLoggedError.name,
      message: creditsShortStatusError(SHORT),
      activity: { kind: 'run.failed', summary: creditsShortStatusError(SHORT) },
    });
    expect(await stored()).toMatchObject({
      status: STATUS.failed,
      statusError: creditsShortStatusError(SHORT),
    });
    expect(await receipt()).toMatchObject({
      deliveredAt: null,
      notification: { event: 'generation.reservation:short' },
    });
    expect(emit).toHaveBeenCalledWith(
      'generation.reservation:short',
      {
        workflowOwner: { workflowRunId: fixture.owner.workflowRunId },
        neededUsd: 2,
        remainingUsd: 0,
        sceneCount: SHORT.sceneCount,
      },
      { requireAcknowledgement: true }
    );
    expect((await sweep())['sequences.notifications']).toBe(1);
    expect((await receipt())?.deliveredAt).toBeInstanceOf(Date);
    expect((await sweep())['sequences.notifications']).toBe(0);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('preserves an engine interruption and leaves its notification for recovery', async () => {
    emit.mockRejectedValueOnce(ENGINE_ABORT);
    await expect(run()).rejects.toBe(ENGINE_ABORT);
    expect(await receipt()).toMatchObject({ deliveredAt: null });
    expect((await sweep())['sequences.notifications']).toBe(1);
  });

  it('surfaces a transactional shortfall write failure without sending an uncommitted terminal event', async () => {
    await db.run(
      sql.raw(
        `CREATE TRIGGER ${SQL_FAULT} BEFORE INSERT ON storyboard_notifications BEGIN SELECT RAISE(ABORT, 'Synthetic shortfall SQL failure'); END`
      )
    );
    await expect(run()).rejects.toThrow('Synthetic shortfall SQL failure');
    expect(await stored()).toMatchObject({ status: STATUS.processing });
    expect(await receipt()).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    expect((await sweep())['sequences.notifications']).toBe(0);
  });

  it('isolates a failed delivery pass and retries on the next cron sweep', async () => {
    emit
      .mockRejectedValueOnce(DELIVERY_FAILURE)
      .mockRejectedValueOnce(DELIVERY_FAILURE);
    await expect(run()).rejects.toBeInstanceOf(WorkflowLoggedError);
    const counts = await sweep();
    expect(counts['sequences.notifications']).toBe(PASS_ERRORED);
    expect(counts['generated_assets.orphaned']).toBe(0);
    expect((await receipt())?.deliveredAt).toBeNull();
    expect((await sweep())['sequences.notifications']).toBe(1);
  });
});
