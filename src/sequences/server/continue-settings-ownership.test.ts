import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { StyleConfig } from '@/look/style-config';
import { generateId } from '@/platform/id';
import { ValidationError } from '@/platform/errors';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import {
  organization,
  sequences,
  sequenceEvents,
  storyboardLaunches,
  styles,
  user,
} from '@/platform/server/db/schema';
import type { Sequence } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { WorkflowLaunchPendingError } from '@/platform/server/workflow/launch-pending';
import type {
  PrepareWorkflowRunOptions,
  PreparedWorkflowRun,
} from '@/platform/server/workflow/prepared-trigger';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { ContinueSettings } from '@/sequences/continue-settings';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from './db/sequences';
import {
  createSequenceEventsMethods,
  SETTINGS_CHANGED_EVENT,
} from './db/sequence-events';

type PreparedStoryboard = PreparedWorkflowRun<StoryboardWorkflowInput>;

type LaunchResult = { workflowRunId: string };
type LaunchOutcome = PromiseSettledResult<LaunchResult>;
type SnapshotHooks = {
  beforeRead?: () => Promise<void>;
  beforePayload?: () => Promise<void>;
  afterClaim?: () => Promise<void>;
};
const S0: ContinueSettings = {
  generationStopAt: 'images',
  generateStartFrames: true,
  generateVoices: false,
  draftMotion: false,
};
const S1: ContinueSettings = {
  generationStopAt: 'references',
  generateStartFrames: false,
  generateVoices: true,
  draftMotion: true,
};
const S2: ContinueSettings = {
  generationStopAt: 'music',
  generateStartFrames: true,
  generateVoices: false,
  draftMotion: false,
};
const START_EVENT = 'storyboard.started';
const INSERT_FAILURE = 'Synthetic Continue insert failure';
const FAILURE_TRIGGER = 'synthetic_continue_insert_failure';
const PRIOR_RUN = 'synthetic-previous-instance';
const PRIOR_ERROR = 'Synthetic previous failure';
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

// Synthetic engine and voice availability; settings, claims, journal and events use migrated D1.
async function prepareSyntheticRun(
  triggerPath: string,
  body: StoryboardWorkflowInput,
  options?: PrepareWorkflowRunOptions
): Promise<PreparedStoryboard> {
  return {
    workflowRunId: 'synthetic-continue-' + generateId(),
    triggerPath,
    body: structuredClone({
      ...body,
      modelConfiguration: packModelRuntimeConfiguration(
        options?.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION
      ),
    }),
  };
}
const prepare = vi.fn(prepareSyntheticRun);
const create = vi.fn(
  async (prepared: PreparedStoryboard) => prepared.workflowRunId
);
vi.doMock('@/platform/server/workflow/prepared-trigger', () => ({
  prepareWorkflowRun: prepare,
  triggerPreparedWorkflow: create,
  WorkflowLaunchPendingError,
}));
vi.doMock('@/platform/server/workflow/run-outcome', () => ({
  readInstanceIfExists: vi.fn(async () => ({
    kind: 'read',
    status: 'running',
    output: undefined,
    error: null,
  })),
}));
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: vi.fn(async () => 'failed'),
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn(() => undefined),
}));
const elevenLabs = await vi.importActual<
  typeof import('@/models/server/elevenlabs-config')
>('@/models/server/elevenlabs-config');
vi.doMock('@/models/server/elevenlabs-config', () => ({
  ...elevenLabs,
  isElevenLabsConfigured: () => true,
}));
const { triggerContinue } = await import('./launchers');

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedSequence>>;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
beforeEach(async () => {
  prepare.mockReset().mockImplementation(prepareSyntheticRun);
  create
    .mockReset()
    .mockImplementation(async (prepared) => prepared.workflowRunId);
  fixture = await seedSequence();
});
afterEach(async () => {
  await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER}`));
});

async function seedSequence() {
  const organizationId = generateId();
  const actorId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic Continue owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic Continue writer',
    email: actorId + '@example.invalid',
  });
  const [style] = await db
    .insert(styles)
    .values({
      organizationId,
      name: 'Synthetic Continue style',
      config: STYLE_CONFIG,
    })
    .returning();
  if (!style) throw new Error('Missing synthetic style');
  const methods = createSequencesMethods(db, organizationId, actorId);
  const created = await methods.create({
    title: 'Synthetic Continue settings',
    styleId: style.id,
    generationStopAt: S0.generationStopAt,
  });
  await db
    .update(sequences)
    .set({
      ...S0,
      script: 'INT. SYNTHETIC CONTINUE TEST - DAY',
      status: 'failed',
      statusError: PRIOR_ERROR,
      workflowRunId: PRIOR_RUN,
    })
    .where(eq(sequences.id, created.id));
  const sequence = await methods.getForUser({ sequenceId: created.id });
  return { organizationId, actorId, sequence, methods };
}

function makeScopedDb(hooks: SnapshotHooks = {}) {
  // Empty content domains are explicit substitutes; all touched database methods remain real.
  return asStub<ScopedDb>({
    sequences: {
      ...fixture.methods,
      claimWorkflowSlot: async (
        params: Parameters<typeof fixture.methods.claimWorkflowSlot>[0]
      ) => {
        const claimed = await fixture.methods.claimWorkflowSlot(params);
        if (claimed) await hooks.afterClaim?.();
        return claimed;
      },
      getForUser: async (
        params: Parameters<typeof fixture.methods.getForUser>[0]
      ) => {
        await hooks.beforeRead?.();
        return fixture.methods.getForUser(params);
      },
    },
    sequence: (id: string) => createSequenceMethods(db, id),
    sequenceEvents: createSequenceEventsMethods(db),
    sequenceElements: {
      list: async () => {
        await hooks.beforePayload?.();
        return [];
      },
    },
    characters: { list: async () => [] },
    locations: { list: async () => [], getCurrentByIds: async () => [] },
    organizationManagement: {
      getMemberEmail: async () => 'writer@example.invalid',
    },
  });
}

function launch(
  sequence: Sequence,
  settings: ContinueSettings,
  hooks: SnapshotHooks = {}
) {
  const scopedDb = makeScopedDb(hooks);
  return triggerContinue(scopedDb, {
    promptLocale: 'en',
    userId: fixture.actorId,
    organizationId: fixture.organizationId,
    sequence,
    settings,
    // The synthetic engine carries this plan without executing workflow units.
    plan: asStub<UpdateStalePlan>({}),
    modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
  });
}

function deferred() {
  let resolve = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function gate() {
  const entered = deferred();
  const released = deferred();
  return {
    entered: entered.promise,
    release: released.resolve,
    block: async () => {
      entered.resolve();
      await released.promise;
    },
  };
}

function observe(promise: Promise<LaunchResult>): Promise<LaunchOutcome> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason })
  );
}

async function waitAtGate(
  pause: ReturnType<typeof gate>,
  outcome: Promise<LaunchOutcome>
) {
  await Promise.race([
    pause.entered,
    outcome.then(() => {
      throw new Error('Launch settled before reaching its gate');
    }),
  ]);
}

async function stored() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  if (!row) throw new Error('Missing synthetic sequence');
  return row;
}

async function events() {
  return db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.sequenceId, fixture.sequence.id))
    .orderBy(sequenceEvents.id);
}

async function launches() {
  return db
    .select()
    .from(storyboardLaunches)
    .where(eq(storyboardLaunches.sequenceId, fixture.sequence.id));
}

function payloadSettings(settings: ContinueSettings) {
  return {
    stopAt: settings.generationStopAt,
    referenceOnly: !settings.generateStartFrames,
    generateVoices: settings.generateVoices,
    draftMotion: settings.draftMotion,
  };
}

it('keeps S1 when earlier B loses after A starts from the same S0-to-S1 request', async () => {
  const snapshot = fixture.sequence;
  const pauseB = gate();
  const b = observe(launch(snapshot, S1, { beforePayload: pauseB.block }));
  try {
    await waitAtGate(pauseB, b);
    const a = await launch(snapshot, S1);
    const activityByA = await events();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].body).toMatchObject(payloadSettings(S1));
    pauseB.release();
    expect(await b).toMatchObject({
      status: 'rejected',
      reason: { name: 'GenerationInProgressError' },
    });
    expect
      .soft(
        await stored(),
        'ABA loser must preserve all four settings owned by A'
      )
      .toMatchObject({
        ...S1,
        workflowRunId: a.workflowRunId,
        status: 'processing',
      });
    expect.soft(await launches()).toEqual([
      expect.objectContaining({
        workflowRunId: a.workflowRunId,
        prepared: expect.objectContaining({
          body: expect.objectContaining(payloadSettings(S1)),
        }),
      }),
    ]);
    expect.soft(await events()).toEqual(activityByA);
    expectPreparedSettings([S1, S1]);
    expect(activityByA.map((event) => event.kind)).toEqual([
      SETTINGS_CHANGED_EVENT,
      START_EVENT,
    ]);
  } finally {
    pauseB.release();
    await b;
  }
});

function expectPreparedSettings(settings: ContinueSettings[]) {
  expect(prepare.mock.calls.map((call) => call[1])).toMatchObject(
    settings.map(payloadSettings)
  );
}

function requireLaunched(outcome: LaunchOutcome) {
  expect(outcome.status).toBe('fulfilled');
  if (outcome.status === 'rejected') throw outcome.reason;
  return outcome.value;
}

async function settingsEvents() {
  return (await events()).filter(
    (event) => event.kind === SETTINGS_CHANGED_EVENT
  );
}

async function expectUnclaimed() {
  expect.soft(await stored()).toMatchObject({
    ...S0,
    workflowRunId: PRIOR_RUN,
    status: 'failed',
    statusError: PRIOR_ERROR,
  });
  expect.soft(await events()).toEqual([]);
  expect.soft(await launches()).toEqual([]);
  expect.soft(create).not.toHaveBeenCalled();
}

async function expectCommittedLaunch(settings: ContinueSettings) {
  const rows = await launches();
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error('Missing committed Continue launch');
  expect(await stored()).toMatchObject({
    ...settings,
    workflowRunId: row.workflowRunId,
    status: 'processing',
    statusError: null,
  });
  expect(row).toMatchObject({
    submittedAt: null,
    prepared: {
      workflowRunId: row.workflowRunId,
      triggerPath: '/storyboard',
      body: {
        ...payloadSettings(settings),
        promptLocale: 'en',
        userId: fixture.actorId,
        organizationId: fixture.organizationId,
        workflowClaimId: row.workflowRunId,
      },
    },
  });
  return row;
}

function blockPreparation(pause: ReturnType<typeof gate>) {
  prepare.mockImplementationOnce(async (...args) => {
    const prepared = await prepareSyntheticRun(...args);
    await pause.block();
    return prepared;
  });
}

it.each([
  { label: 'S1', winner: S1, loser: S2 },
  { label: 'S2', winner: S2, loser: S1 },
])(
  'keeps $label payload isolated before either settings claim commits',
  async ({ winner, loser }) => {
    const readA = gate();
    const payloadB = gate();
    const a = observe(
      launch(fixture.sequence, winner, { beforeRead: readA.block })
    );
    let b: Promise<LaunchOutcome> | undefined;
    try {
      await waitAtGate(readA, a);
      b = observe(
        launch(fixture.sequence, loser, { beforePayload: payloadB.block })
      );
      await waitAtGate(payloadB, b);
      await expectUnclaimed();
      readA.release();
      const launched = requireLaunched(await a);
      const activityByA = await events();
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]?.[0].body).toMatchObject(
        payloadSettings(winner)
      );
      payloadB.release();
      expect(await b).toMatchObject({
        status: 'rejected',
        reason: { name: 'GenerationInProgressError' },
      });
      expect(await stored()).toMatchObject({
        ...winner,
        workflowRunId: launched.workflowRunId,
      });
      expect(await launches()).toEqual([
        expect.objectContaining({
          workflowRunId: launched.workflowRunId,
          prepared: expect.objectContaining({
            body: expect.objectContaining(payloadSettings(winner)),
          }),
        }),
      ]);
      expect(await events()).toEqual(activityByA);
      expectPreparedSettings([winner, loser]);
    } finally {
      readA.release();
      payloadB.release();
      await a;
      await b;
    }
  }
);

it('leaves no settings or settings activity during or after deterministic prepare refusal', async () => {
  const pause = gate();
  const refusal = new ValidationError(
    'Synthetic deterministic preparation refusal'
  );
  prepare.mockImplementationOnce(async () => {
    await pause.block();
    throw refusal;
  });
  const pending = observe(launch(fixture.sequence, S1));
  try {
    await waitAtGate(pause, pending);
    await expectUnclaimed();
    pause.release();
    expect(await pending).toEqual({ status: 'rejected', reason: refusal });
    await expectUnclaimed();
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    pause.release();
    await pending;
  }
});

const FAILING_INSERTS = [
  { label: 'launch journal', table: 'storyboard_launches', condition: '' },
  {
    label: 'start activity',
    table: 'sequence_events',
    condition: `WHEN NEW.kind = '${START_EVENT}'`,
  },
  {
    label: 'settings activity',
    table: 'sequence_events',
    condition: `WHEN NEW.kind = '${SETTINGS_CHANGED_EVENT}'`,
  },
];

it.each(FAILING_INSERTS)(
  'rolls back all four settings when the $label insert fails',
  async ({ table, condition }) => {
    await db.run(
      sql.raw(
        `CREATE TRIGGER ${FAILURE_TRIGGER} BEFORE INSERT ON ${table} ${condition} BEGIN SELECT RAISE(ABORT, '${INSERT_FAILURE}'); END`
      )
    );

    const outcome = await observe(launch(fixture.sequence, S1));

    expect.soft(outcome).toMatchObject({
      status: 'rejected',
      reason: {
        name: 'WorkflowLaunchPendingError',
        cause: { message: expect.stringContaining(INSERT_FAILURE) },
      },
    });
    await expectUnclaimed();
    expect(prepare).toHaveBeenCalledTimes(1);
  }
);

it('keeps committed settings and the exact prepared payload when create is unconfirmed', async () => {
  const pause = gate();
  const lostReply = new Error('Synthetic lost create reply');
  create.mockImplementationOnce(async () => {
    await pause.block();
    throw lostReply;
  });
  const pending = observe(launch(fixture.sequence, S1));
  try {
    await waitAtGate(pause, pending);
    const committed = await expectCommittedLaunch(S1);
    expect(committed.prepared).toEqual(create.mock.calls[0]?.[0]);
    const activity = await events();
    expect(activity.map((event) => event.kind)).toEqual([
      SETTINGS_CHANGED_EVENT,
      START_EVENT,
    ]);
    pause.release();
    expect(await pending).toMatchObject({
      status: 'rejected',
      reason: {
        name: 'WorkflowLaunchPendingError',
        workflowRunId: committed.workflowRunId,
        cause: lostReply,
      },
    });
    expect(await stored()).toMatchObject(S1);
    expect(await launches()).toEqual([committed]);
    expect(await events()).toEqual(activity);
  } finally {
    pause.release();
    await pending;
  }
});

it('keeps committed settings and the prepared payload when acknowledgment cannot commit', async () => {
  await db.run(
    sql.raw(
      `CREATE TRIGGER ${FAILURE_TRIGGER} BEFORE UPDATE OF submitted_at ON storyboard_launches WHEN NEW.submitted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, '${INSERT_FAILURE}'); END`
    )
  );

  const outcome = await observe(launch(fixture.sequence, S1));

  expect(outcome).toMatchObject({
    status: 'rejected',
    reason: {
      name: 'WorkflowLaunchPendingError',
      cause: { message: expect.stringContaining(INSERT_FAILURE) },
    },
  });
  const committed = await expectCommittedLaunch(S1);
  expect(committed.prepared).toEqual(create.mock.calls[0]?.[0]);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await events()).map((event) => event.kind)).toEqual([
    SETTINGS_CHANGED_EVENT,
    START_EVENT,
  ]);
});

it.each([null, S2.generationStopAt])(
  'records one stop change from committed %s before the start activity',
  async (previousStopAt) => {
    const pause = gate();
    blockPreparation(pause);
    const pending = observe(launch(fixture.sequence, S1));
    try {
      await waitAtGate(pause, pending);
      await db
        .update(sequences)
        .set({ generationStopAt: previousStopAt })
        .where(eq(sequences.id, fixture.sequence.id));
      expect(await events()).toEqual([]);
      pause.release();
      const launched = requireLaunched(await pending);
      const activity = await events();
      expect(activity.map((event) => event.kind)).toEqual([
        SETTINGS_CHANGED_EVENT,
        START_EVENT,
      ]);
      expect(await settingsEvents()).toEqual([
        expect.objectContaining({
          actorId: fixture.actorId,
          targetId: fixture.sequence.id,
          data: {
            fields: ['generationStopAt'],
            changes: [
              {
                field: 'generationStopAt',
                from: previousStopAt,
                to: S1.generationStopAt,
              },
            ],
          },
        }),
      ]);
      expect(await stored()).toMatchObject(S1);
      expect(
        await fixture.methods.startWorkflowIfCurrent({
          id: fixture.sequence.id,
          workflowRunId: launched.workflowRunId,
          workflowClaimId: launched.workflowRunId,
          stopAt: S1.generationStopAt,
          resume: true,
        })
      ).toBe(true);
      expect(await events()).toEqual(activity);
    } finally {
      pause.release();
      await pending;
    }
  }
);

it.each(['generateStartFrames', 'generateVoices', 'draftMotion'] as const)(
  'saves %s without adding settings history when stopAt is unchanged',
  async (field) => {
    const settings = { ...S0, [field]: !S0[field] };
    await launch(fixture.sequence, settings);
    expect(await stored()).toMatchObject(settings);
    expect(create.mock.calls[0]?.[0].body).toMatchObject(
      payloadSettings(settings)
    );
    expect(await settingsEvents()).toEqual([]);
    expect((await events()).map((event) => event.kind)).toEqual([START_EVENT]);
  }
);

it('keeps settings, both activities and prepared request when a committed claim reply is lost', async () => {
  const lostReply = new Error('Synthetic committed claim reply was lost');
  const outcome = await observe(
    launch(fixture.sequence, S1, {
      afterClaim: async () => {
        throw lostReply;
      },
    })
  );
  const committed = await expectCommittedLaunch(S1);

  expect(outcome).toMatchObject({
    status: 'rejected',
    reason: {
      name: 'WorkflowLaunchPendingError',
      workflowRunId: committed.workflowRunId,
      cause: lostReply,
    },
  });
  expect((await events()).map((event) => event.kind)).toEqual([
    SETTINGS_CHANGED_EVENT,
    START_EVENT,
  ]);
  expect(await settingsEvents()).toEqual([
    expect.objectContaining({
      data: {
        fields: ['generationStopAt'],
        changes: [
          {
            field: 'generationStopAt',
            from: S0.generationStopAt,
            to: S1.generationStopAt,
          },
        ],
      },
    }),
  ]);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
});
