import { and, eq, sql } from 'drizzle-orm';
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
import type { StyleConfig } from '@/look/style-config';
import {
  organization,
  sequenceEvents,
  sequences,
  shots,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { WorkflowLoggedError } from '@/platform/server/workflow/errors';
import { createShotsMethods } from '@/shots/server/db/shots';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from '../db/sequences';

const RUN_A = 'synthetic-storyboard-owner-A';
const RUN_B = 'synthetic-storyboard-owner-B';
const CLAIM_A = 'synthetic-storyboard-claim-A';
const STORED_ERROR = 'Synthetic existing failure detail';
const COMPLETED_KIND = 'storyboard.completed';
const SETTINGS_KIND = 'sequence.settings-changed';
const STORED_STOP: StoryboardWorkflowInput['stopAt'] = 'images';
const REQUESTED_STOP: StoryboardWorkflowInput['stopAt'] = 'motion';
const STATUS = {
  processing: 'processing',
  failed: 'failed',
  completed: 'completed',
} as const;
const STEP = {
  start: 'verify-clear-and-start-processing',
  complete: 'mark-completed',
  short: 'mark-reservation-short',
} as const;
const POSTER_URL = 'https://example.invalid/synthetic-poster.png';
const SHORT_GATE = {
  spawnRenders: false,
  neededMicros: 2_000_000,
  remainingMicros: 0,
};
const STYLE_CONFIG: StyleConfig = {
  version: 2,
  look: {
    mood: 'neutral',
    artStyle: 'cinematic',
    lighting: 'natural',
    colorPalette: ['#000', '#fff'],
    colorGrading: 'neutral',
  },
  motion: { camera: 'static' },
  references: [],
};

// Engine substitute: invoke the real runImpl without a Workerd instance or dispatch.
vi.doMock('@/platform/server/workflow/base-workflow', () => ({
  OpenStoryWorkflowEntrypoint: class {
    constructor(
      _context: unknown,
      readonly env: unknown
    ) {}
  },
}));
// Realtime substitute: observe events without sending them.
const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));
// Child-dispatch substitute: no analysis, rendering, or workflow binding is invoked.
const spawnAndAwaitChild = vi.fn(async () => ({ failures: [] }));
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));
// AI substitute: exercise poster persistence with synthetic media only.
const generateImageWithProvider = vi.fn(async () => ({
  imageUrls: [POSTER_URL],
  metadata: { usedOwnKey: false },
}));
vi.doMock('@/stills/server/image-generation', () => ({
  generateImageWithProvider,
}));
// Storage substitute: no upload or media download.
const uploadPosterToStorage = vi.fn(async () => ({ url: POSTER_URL }));
vi.doMock('@/stills/server/image-storage', () => ({ uploadPosterToStorage }));
// Configured-AI substitutes: pin the poster route and block alternative provider calls.
const generateConfiguredPoster = vi.fn(async () => null);
vi.doMock('../configured-poster', () => ({ generateConfiguredPoster }));
vi.doMock('@/models/image-channels', () => ({
  usesConfiguredImageChannel: vi.fn(() => false),
}));
// Billing substitutes: no provider usage reconciliation or paid deduction.
const deductWorkflowCredits = vi.fn(async () => undefined);
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits,
  extractImageCost: vi.fn(() => 0),
  recordFalUsageStep: vi.fn(async () => ({})),
}));
// Plan substitute: only fields the parent reads; the child executor is substituted.
const plan = () =>
  asStub<NonNullable<StoryboardWorkflowInput['plan']>>({
    targets: [],
    references: null,
    music: null,
  });
const freezeFreshGenerationPlan = vi.fn(async () => ({
  plan: plan(),
  remainingCost: 0,
}));
vi.doMock('@/sequences/server/freeze-fresh-generation-plan', () => ({
  freezeFreshGenerationPlan,
}));
// Reservation-gate substitute: deterministic available/short balances without spending.
const gateStoryboardRenders = vi.fn(async (): Promise<typeof SHORT_GATE> => ({
  spawnRenders: true,
  neededMicros: 0,
  remainingMicros: 0,
}));
vi.doMock('@/billing/server/storyboard-render-gate', () => ({
  gateStoryboardRenders,
}));
// Email substitute: record notification intent without sending mail.
const notifySequenceReady = vi.fn(async () => 'sent');
vi.doMock('@/sequences/server/notify-sequence-ready', () => ({
  notifySequenceReady,
  sequenceScenesUrl: (id: string) =>
    'https://example.invalid/sequences/' + id + '/scenes',
}));
const { StoryboardWorkflow } = await import('./storyboard-workflow');

class LifecycleProbe extends StoryboardWorkflow {
  invoke(
    event: Readonly<WorkflowEvent<StoryboardWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

type BeforeStep = (name: string) => Promise<void>;
let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedFixture>>;
// Reservation substitute: release is observed, never applied to a billing account.
const zeroReservation = vi.fn(async (_reservationId: string) => undefined);
// Network tripwire: any accidental provider, email, or engine request fails the test.
const network = vi.fn(() => {
  throw new Error('Unexpected network in storyboard ownership regression');
});

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', network);
  gateStoryboardRenders.mockResolvedValue({
    spawnRenders: true,
    neededMicros: 0,
    remainingMicros: 0,
  });
  fixture = await seedFixture();
});
afterEach(async () => {
  await db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_storyboard_lifecycle_failure')
  );
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

async function seedIdentity() {
  const organizationId = generateId();
  const actorId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic storyboard organization',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic writer',
    email: actorId + '@example.invalid',
  });
  return { organizationId, actorId };
}

async function seedFixture() {
  const { organizationId, actorId } = await seedIdentity();
  const [style] = await db
    .insert(styles)
    .values({
      organizationId,
      name: 'Synthetic storyboard style',
      config: STYLE_CONFIG,
    })
    .returning();
  if (!style) throw new Error('Missing synthetic style');
  const methods = createSequencesMethods(db, organizationId, actorId);
  const sequence = await methods.create({
    title: 'Synthetic lifecycle sequence',
    styleId: style.id,
    generationStopAt: STORED_STOP,
  });
  await db
    .update(sequences)
    .set({
      status: STATUS.processing,
      workflowRunId: RUN_A,
      statusError: STORED_ERROR,
    })
    .where(eq(sequences.id, sequence.id));
  const shotId = generateId();
  await db.insert(shots).values({ id: shotId, sequenceId: sequence.id });
  const snapshot = await methods.getForUser({ sequenceId: sequence.id });
  return {
    organizationId,
    actorId,
    sequence,
    methods,
    shotId,
    snapshot,
    eventId: generateId(),
  };
}

function scopedDb() {
  // Read substitute: retain the real A snapshot across the deterministic B interleaving.
  const getForUser = vi.fn(async () => fixture.snapshot);
  return asStub<WorkflowScopedDb>({
    organizationId: fixture.organizationId,
    userId: fixture.actorId,
    models: DEFAULT_MODEL_CONFIGURATION,
    sequences: fixture.methods,
    sequence: (id: string) => createSequenceMethods(db, id),
    shots: createShotsMethods(db),
    liveRead: { sequences: { getForUser } },
    billing: { zeroReservation },
    credentials: {},
  });
}

function eventFor(
  extras: Partial<StoryboardWorkflowInput> = {}
): Readonly<WorkflowEvent<StoryboardWorkflowInput>> {
  return {
    instanceId: RUN_A,
    workflowName: 'synthetic-storyboard',
    timestamp: new Date(0),
    payload: {
      sequenceId: fixture.sequence.id,
      organizationId: fixture.organizationId,
      userId: fixture.actorId,
      promptLocale: 'en',
      includeMusic: true,
      workflowClaimId: CLAIM_A,
      title: 'Synthetic storyboard',
      script: 'INT. HALLWAY - NIGHT',
      aspectRatio: '16:9',
      styleConfig: STYLE_CONFIG,
      stopAt: REQUESTED_STOP,
      analysisModelId: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      imageModel: DEFAULT_MODEL_CONFIGURATION.defaultImage,
      videoModel: DEFAULT_MODEL_CONFIGURATION.defaultVideo,
      elementIds: [],
      cast: [],
      referenceOnly: false,
      musicPromptSource: 'ai-generated',
      sequenceUrl:
        'https://example.invalid/sequences/' + fixture.sequence.id + '/scenes',
      ownerEmail: 'synthetic-owner@example.invalid',
      notify: true,
      resume: true,
      plan: plan(),
      ...extras,
    },
  };
}

function makeStep(beforeStep?: BeforeStep) {
  // Engine-step substitute: await explicit interleavings; no timer or automatic retry.
  return asStub<WorkflowStep>({
    do: async (name: string, ...args: unknown[]) => {
      await beforeStep?.(name);
      const callback = args.at(-1);
      if (typeof callback !== 'function')
        throw new Error('Missing step callback: ' + name);
      return callback();
    },
  });
}

function atStep(target: string, action: () => Promise<void>): BeforeStep {
  return async (name) => {
    if (name === target) await action();
  };
}

function run(
  extras: Partial<StoryboardWorkflowInput> = {},
  beforeStep?: BeforeStep
) {
  type Args = ConstructorParameters<typeof LifecycleProbe>;
  // Binding substitute: the child-dispatch mock never calls these inert bindings.
  const workflow = new LifecycleProbe(
    asStub<Args[0]>(undefined),
    asStub<Args[1]>({})
  );
  return workflow.invoke(eventFor(extras), makeStep(beforeStep), scopedDb());
}

async function storedSequence() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  if (!row) throw new Error('Missing synthetic sequence');
  return row;
}

async function patchSequence(values: Partial<typeof sequences.$inferInsert>) {
  await db
    .update(sequences)
    .set(values)
    .where(eq(sequences.id, fixture.sequence.id));
  return storedSequence();
}

async function storedShots() {
  return db
    .select()
    .from(shots)
    .where(eq(shots.sequenceId, fixture.sequence.id));
}

async function completedEvents(kind = COMPLETED_KIND) {
  return db
    .select()
    .from(sequenceEvents)
    .where(
      and(
        eq(sequenceEvents.sequenceId, fixture.sequence.id),
        eq(sequenceEvents.kind, kind)
      )
    );
}

function expectNoGenerationEffects() {
  expect(generateImageWithProvider).not.toHaveBeenCalled();
  expect(generateConfiguredPoster).not.toHaveBeenCalled();
  expect(uploadPosterToStorage).not.toHaveBeenCalled();
  expect(deductWorkflowCredits).not.toHaveBeenCalled();
  expect(spawnAndAwaitChild).not.toHaveBeenCalled();
  expect(freezeFreshGenerationPlan).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(notifySequenceReady).not.toHaveBeenCalled();
}

async function runAllowingShort(beforeStep?: BeforeStep) {
  try {
    await run({ resume: false, plan: undefined }, beforeStep);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowLoggedError);
  }
}

describe('Storyboard runImpl start ownership with real D1 methods', () => {
  it('keeps B shots, stopAt, status and poster after the old A read before start', async () => {
    expect(fixture.snapshot.workflowRunId).toBe(RUN_A);
    const beforeShots = await storedShots();
    let before: Awaited<ReturnType<typeof storedSequence>> | undefined;
    await run(
      { resume: false, plan: undefined },
      atStep(STEP.start, async () => {
        before = await patchSequence({ workflowRunId: RUN_B });
      })
    );
    expect(before).toBeDefined();
    expect(await storedSequence()).toEqual(before);
    expect(await storedShots()).toEqual(beforeShots);
    expect(await completedEvents()).toEqual([]);
    expectNoGenerationEffects();
  });

  it('really deletes existing shots for the current fresh run and records completion', async () => {
    await run({ resume: false, plan: undefined });
    expect(await storedShots()).toEqual([]);
    expect(await storedSequence()).toMatchObject({
      status: STATUS.completed,
      generationStopAt: REQUESTED_STOP,
      statusError: null,
    });
    expect(generateImageWithProvider).toHaveBeenCalledOnce();
    expect(spawnAndAwaitChild).toHaveBeenCalledOnce();
    expect(await completedEvents()).toHaveLength(1);
    expect(notifySequenceReady).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      'generation.complete',
      {
        sequenceId: fixture.sequence.id,
        workflowOwner: { workflowRunId: RUN_A, workflowClaimId: CLAIM_A },
      },
      { requireAcknowledgement: true }
    );
  });

  it('retains real shots on current resume and dispatches only the frozen plan', async () => {
    const beforeShots = await storedShots();
    await run();
    expect(await storedShots()).toEqual(beforeShots);
    expect(generateImageWithProvider).not.toHaveBeenCalled();
    expect(spawnAndAwaitChild).toHaveBeenCalledOnce();
    expect(await storedSequence()).toMatchObject({
      status: STATUS.completed,
      generationStopAt: REQUESTED_STOP,
    });
    expect(await completedEvents()).toHaveLength(1);
  });

  it.each([STATUS.failed, STATUS.completed])(
    'does not resurrect %s before fresh start',
    async (status) => {
      const beforeShots = await storedShots();
      const before = await patchSequence({ status });
      await run({ resume: false, plan: undefined });
      expect(await storedSequence()).toEqual(before);
      expect(await storedShots()).toEqual(beforeShots);
      expect(await completedEvents()).toEqual([]);
      expectNoGenerationEffects();
    }
  );

  it('accepts its exact raw launcher claim before instance persistence', async () => {
    await patchSequence({ workflowRunId: CLAIM_A });
    await run();
    expect(await storedSequence()).toMatchObject({
      workflowRunId: CLAIM_A,
      status: STATUS.completed,
    });
    expect(await completedEvents()).toHaveLength(1);
    expect(notifySequenceReady).toHaveBeenCalledOnce();
  });

  it('does not infer a raw claim when the event has no claim snapshot', async () => {
    const before = await patchSequence({ workflowRunId: CLAIM_A });
    const beforeShots = await storedShots();
    await run({ workflowClaimId: undefined, resume: false, plan: undefined });
    expect(await storedSequence()).toEqual(before);
    expect(await storedShots()).toEqual(beforeShots);
    expectNoGenerationEffects();
  });
});

describe('Storyboard runImpl terminal interleavings with real D1 writes', () => {
  it.each([
    { label: 'new owner', values: { workflowRunId: RUN_B } },
    {
      label: 'failed',
      values: { status: STATUS.failed, statusError: STORED_ERROR },
    },
    {
      label: 'completed without this event',
      values: { status: STATUS.completed },
    },
  ])(
    'does not complete or notify after $label wins before mark-completed',
    async ({ values }) => {
      let before: Awaited<ReturnType<typeof storedSequence>> | undefined;
      await run(
        {},
        atStep(STEP.complete, async () => {
          before = await patchSequence(values);
        })
      );
      expect(before).toBeDefined();
      expect(await storedSequence()).toEqual(before);
      expect(await completedEvents()).toEqual([]);
      expect(emit).not.toHaveBeenCalled();
      expect(notifySequenceReady).not.toHaveBeenCalled();
    }
  );

  it('does not fail B or emit a shortfall when B takes over before the short step', async () => {
    gateStoryboardRenders.mockResolvedValue(SHORT_GATE);
    let before: Awaited<ReturnType<typeof storedSequence>> | undefined;
    await runAllowingShort(
      atStep(STEP.short, async () => {
        before = await patchSequence({
          workflowRunId: RUN_B,
          statusError: STORED_ERROR,
        });
      })
    );
    expect(before).toBeDefined();
    expect(await storedSequence()).toEqual(before);
    expect(emit.mock.calls.map(([name]) => name)).not.toContain(
      'generation.reservation:short'
    );
    expect(await completedEvents()).toEqual([]);
    expect(notifySequenceReady).not.toHaveBeenCalled();
  });

  it('persists a genuine current-owner shortfall and emits only the top-up event', async () => {
    gateStoryboardRenders.mockResolvedValue(SHORT_GATE);
    await expect(
      run({ resume: false, plan: undefined })
    ).rejects.toBeInstanceOf(WorkflowLoggedError);
    expect(await storedSequence()).toMatchObject({
      workflowRunId: RUN_A,
      status: STATUS.failed,
      statusError: expect.stringContaining('Not enough credits'),
    });
    expect(emit).toHaveBeenCalledWith(
      'generation.reservation:short',
      {
        workflowOwner: { workflowRunId: RUN_A, workflowClaimId: CLAIM_A },
        neededUsd: 2,
        remainingUsd: 0,
        sceneCount: 0,
      },
      { requireAcknowledgement: true }
    );
    expect(emit.mock.calls.map(([name]) => name)).not.toContain(
      'generation.complete'
    );
    expect(await completedEvents()).toEqual([]);
    expect(notifySequenceReady).not.toHaveBeenCalled();
  });
});

const SQL_FAILURE = 'Synthetic storyboard lifecycle SQL failure';

function lifecycleOwner() {
  return {
    id: fixture.sequence.id,
    workflowRunId: RUN_A,
    workflowClaimId: CLAIM_A,
  };
}

function startInput(resume = false) {
  return { ...lifecycleOwner(), stopAt: REQUESTED_STOP, resume };
}

function completionInput() {
  return { ...lifecycleOwner(), eventId: fixture.eventId };
}

async function installFailureTrigger(clause: string) {
  // SQL fault injection only: the real D1 batch remains responsible for rollback.
  await db.run(
    sql.raw(
      'CREATE TRIGGER synthetic_storyboard_lifecycle_failure ' +
        clause +
        " BEGIN SELECT RAISE(ABORT, '" +
        SQL_FAILURE +
        "'); END"
    )
  );
}

async function expectWriteFailure(operation: Promise<unknown>) {
  const failure = operation.catch((error: unknown) => {
    throw error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  });
  await expect(failure).rejects.toThrow(SQL_FAILURE);
}

describe('Storyboard lifecycle database ownership boundaries', () => {
  it.each([false, true])(
    'starts and completes the current raw claim, resume=%s',
    async (resume) => {
      await patchSequence({ workflowRunId: CLAIM_A });
      const beforeShots = await storedShots();
      expect(
        await fixture.methods.startWorkflowIfCurrent(startInput(resume))
      ).toBe(true);
      expect(await storedSequence()).toMatchObject({
        workflowRunId: CLAIM_A,
        status: STATUS.processing,
        statusError: null,
        generationStopAt: REQUESTED_STOP,
      });
      expect(await storedShots()).toEqual(resume ? beforeShots : []);
      expect(await completedEvents()).toEqual([]);

      expect(
        await fixture.methods.completeWorkflowIfCurrent(completionInput())
      ).toBe(true);
      expect(await storedSequence()).toMatchObject({
        workflowRunId: CLAIM_A,
        status: STATUS.completed,
      });
      expect(await completedEvents()).toMatchObject([
        {
          id: fixture.eventId,
          sequenceId: fixture.sequence.id,
          actorId: fixture.actorId,
          kind: COMPLETED_KIND,
          targetType: 'sequence',
          targetId: fixture.sequence.id,
          summary: 'Finished the storyboard',
        },
      ]);
    }
  );

  it.each([
    { label: 'foreign run', workflowRunId: RUN_B },
    { label: 'missing owner', workflowRunId: null },
  ])(
    'refuses start and completion for $label without deleting shots or appending activity',
    async ({ workflowRunId }) => {
      const before = await patchSequence({ workflowRunId });
      const beforeShots = await storedShots();
      expect(await fixture.methods.startWorkflowIfCurrent(startInput())).toBe(
        false
      );
      expect(
        await fixture.methods.completeWorkflowIfCurrent(completionInput())
      ).toBe(false);
      expect(await storedSequence()).toEqual(before);
      expect(await storedShots()).toEqual(beforeShots);
      expect(await completedEvents()).toEqual([]);
    }
  );

  it('refuses a foreign organization even when its run and raw claim match', async () => {
    const before = await patchSequence({ workflowRunId: CLAIM_A });
    const beforeShots = await storedShots();
    const foreign = createSequencesMethods(db, generateId(), fixture.actorId);
    expect(await foreign.startWorkflowIfCurrent(startInput())).toBe(false);
    expect(await foreign.completeWorkflowIfCurrent(completionInput())).toBe(
      false
    );
    expect(await storedSequence()).toEqual(before);
    expect(await storedShots()).toEqual(beforeShots);
    expect(await completedEvents()).toEqual([]);
  });

  it.each([STATUS.failed, STATUS.completed])(
    'refuses start and new completion for the same owner in %s',
    async (status) => {
      const before = await patchSequence({ status });
      const beforeShots = await storedShots();
      expect(await fixture.methods.startWorkflowIfCurrent(startInput())).toBe(
        false
      );
      expect(
        await fixture.methods.completeWorkflowIfCurrent(completionInput())
      ).toBe(false);
      expect(await storedSequence()).toEqual(before);
      expect(await storedShots()).toEqual(beforeShots);
      expect(await completedEvents()).toEqual([]);
    }
  );
});

describe('Storyboard lifecycle completion durable replay', () => {
  it('accepts the same owner and eventId twice with exactly one activity', async () => {
    const input = completionInput();
    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(true);
    const completed = await storedSequence();
    const events = await completedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: fixture.eventId,
      actorId: fixture.actorId,
      kind: COMPLETED_KIND,
      summary: 'Finished the storyboard',
      targetType: 'sequence',
      targetId: fixture.sequence.id,
    });

    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(true);
    expect(
      await fixture.methods.completeWorkflowIfCurrent({
        ...input,
        eventId: generateId(),
      })
    ).toBe(false);
    expect(await storedSequence()).toEqual(completed);
    expect(await completedEvents()).toEqual(events);
  });

  it('rejects the old completed event after a new owner acquires the sequence', async () => {
    const input = completionInput();
    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(true);
    const events = await completedEvents();
    expect(events).toHaveLength(1);
    const before = await patchSequence({
      workflowRunId: RUN_B,
      status: STATUS.processing,
      statusError: STORED_ERROR,
    });

    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(false);
    expect(await storedSequence()).toEqual(before);
    expect(await completedEvents()).toEqual(events);
  });
});

describe('Storyboard lifecycle real D1 batch rollback', () => {
  it.each([
    { label: 'shot deletion', clause: 'BEFORE DELETE ON shots' },
    { label: 'settings activity', clause: 'BEFORE INSERT ON sequence_events' },
    { label: 'status write', clause: 'BEFORE UPDATE OF status ON sequences' },
  ])('rolls back fresh start when $label fails', async ({ clause }) => {
    const before = await storedSequence();
    const beforeShots = await storedShots();
    await installFailureTrigger(clause);

    await expectWriteFailure(
      fixture.methods.startWorkflowIfCurrent(startInput())
    );

    expect(await storedSequence()).toEqual(before);
    expect(await storedShots()).toEqual(beforeShots);
    expect(await completedEvents()).toEqual([]);
  });

  it.each([
    { label: 'activity insert', clause: 'BEFORE INSERT ON sequence_events' },
    {
      label: 'status write after activity',
      clause: 'BEFORE UPDATE OF status ON sequences',
    },
  ])('rolls back completion when $label fails', async ({ clause }) => {
    const before = await storedSequence();
    const beforeShots = await storedShots();
    await installFailureTrigger(clause);

    await expectWriteFailure(
      fixture.methods.completeWorkflowIfCurrent(completionInput())
    );

    expect(await storedSequence()).toEqual(before);
    expect(await storedShots()).toEqual(beforeShots);
    expect(await completedEvents()).toEqual([]);
  });
});

describe('Storyboard startup preserves generation-stop history', () => {
  it.each([STORED_STOP, null] as const)(
    'records the actual prior stop %s once across replay',
    async (from) => {
      await patchSequence({ generationStopAt: from });
      const input = { ...startInput(), resume: true };
      expect(await fixture.methods.startWorkflowIfCurrent(input)).toBe(true);
      const events = await completedEvents(SETTINGS_KIND);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: fixture.actorId,
        summary: 'Changed where generation stops to Motion',
        data: {
          fields: ['generationStopAt'],
          changes: [{ field: 'generationStopAt', from, to: REQUESTED_STOP }],
        },
      });
      expect(await fixture.methods.startWorkflowIfCurrent(input)).toBe(true);
      expect(await completedEvents(SETTINGS_KIND)).toEqual(events);
    }
  );

  it.each([
    { label: 'unchanged stop', values: { generationStopAt: REQUESTED_STOP } },
    { label: 'lost owner', values: { workflowRunId: RUN_B } },
  ] as const)(
    'does not append settings history for $label',
    async ({ values }) => {
      await patchSequence(values);
      await fixture.methods.startWorkflowIfCurrent({
        ...startInput(),
        resume: true,
      });
      expect(await completedEvents(SETTINGS_KIND)).toEqual([]);
    }
  );
});
