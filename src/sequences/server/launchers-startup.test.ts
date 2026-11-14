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
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { releaseReservationOnThrow } from '@/billing/server/preflight';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { TextModelRoute } from '@/models/text-channels';
import { generateId } from '@/platform/id';
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
import type { StyleConfig } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import type {
  PrepareWorkflowRunOptions,
  PreparedWorkflowRun,
} from '@/platform/server/workflow/prepared-trigger';
import type { InstanceRead } from '@/platform/server/workflow/run-outcome';
import type {
  StoryboardTriggerInput,
  StoryboardWorkflowInput,
} from '@/platform/server/workflow/types';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from './db/sequences';
import { createSequenceEventsMethods } from './db/sequence-events';

type PreparedStoryboard = PreparedWorkflowRun<StoryboardWorkflowInput>;
const LEGACY_RUN = 'synthetic-legacy-instance';
const LIVE: InstanceRead = {
  kind: 'read',
  status: 'running',
  output: undefined,
  error: null,
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
const ROUTE: TextModelRoute = {
  modelId: 'custom:synthetic-startup',
  name: 'Synthetic startup',
  channelId: 'synthetic-channel',
  upstreamModel: 'synthetic-model',
  credentialId: 'synthetic-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://synthetic.example.invalid/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};

// Only preparation, engine creation and engine status are mocked; sequence/outbox/activity use migrated test D1.
async function prepareSyntheticRun(
  triggerPath: string,
  body: StoryboardWorkflowInput,
  options?: PrepareWorkflowRunOptions
): Promise<PreparedStoryboard> {
  return {
    workflowRunId: 'synthetic-storyboard-' + generateId(),
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
const instances = new Map<string, InstanceRead>();
const create = vi.fn(async (prepared: PreparedStoryboard) => {
  instances.set(prepared.workflowRunId, LIVE);
  return prepared.workflowRunId;
});
const readInstance = vi.fn<
  typeof import('@/platform/server/workflow/run-outcome').readInstanceIfExists
>(async (id) => instances.get(id) ?? { kind: 'missing' });
const resolveLegacy = vi.fn(async () => 'failed' as const);
const { WorkflowLaunchPendingError } = await vi.importActual<
  typeof import('@/platform/server/workflow/prepared-trigger')
>('@/platform/server/workflow/prepared-trigger');
vi.doMock('@/platform/server/workflow/prepared-trigger', () => ({
  prepareWorkflowRun: prepare,
  triggerPreparedWorkflow: create,
  WorkflowLaunchPendingError,
}));
vi.doMock('@/platform/server/workflow/run-outcome', () => ({
  readInstanceIfExists: readInstance,
}));
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: resolveLegacy,
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn(() => undefined),
}));
const {
  triggerStoryboard,
  triggerContinue,
  GenerationInProgressError,
  GenerationStatusUnknownError,
} = await import('./launchers');
const { withContinueSwitches } = await import('./continue-plan');

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedSequence>>;
let configuration: ModelRuntimeConfiguration;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  instances.clear();
  prepare.mockReset().mockImplementation(prepareSyntheticRun);
  create.mockReset().mockImplementation(async (prepared) => {
    instances.set(prepared.workflowRunId, LIVE);
    return prepared.workflowRunId;
  });
  resolveLegacy.mockClear();
  configuration = {
    ...DEFAULT_MODEL_CONFIGURATION,
    textModelRouting: [{ ...ROUTE }],
    imageModelRouting: [],
  };
  fixture = await seedSequence();
});
afterEach(async () => {
  await db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_startup_launch_failure')
  );
  await db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_startup_activity_failure')
  );
  readInstance
    .mockReset()
    .mockImplementation(async (id) => instances.get(id) ?? { kind: 'missing' });
  await db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_startup_publish_failure')
  );
  instances.clear();
  vi.restoreAllMocks();
});

async function seedOwner() {
  const organizationId = generateId();
  const actorId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic startup owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic startup writer',
    email: actorId + '@example.invalid',
  });
  return { organizationId, actorId };
}

async function seedSequence() {
  const owner = await seedOwner();
  const [style] = await db
    .insert(styles)
    .values({
      organizationId: owner.organizationId,
      name: 'Synthetic startup',
      config: STYLE_CONFIG,
    })
    .returning();
  if (!style) throw new Error('Missing synthetic style');
  const methods = createSequencesMethods(
    db,
    owner.organizationId,
    owner.actorId
  );
  const sequence = await methods.create({
    title: 'Original synthetic title',
    styleId: style.id,
    generationStopAt: 'images',
  });
  await db
    .update(sequences)
    .set({
      script: 'INT. ORIGINAL SYNTHETIC ROOM — DAY',
      status: 'failed',
      statusError: 'Synthetic prior failure',
      workflowRunId: LEGACY_RUN,
    })
    .where(eq(sequences.id, sequence.id));
  return { ...owner, methods, sequence, reservationId: generateId() };
}

function scoped(owner = fixture): ScopedDb {
  // Empty request-side domains are explicit substitutes, not engine or SQL implementations.
  return asStub<ScopedDb>({
    sequences: owner.methods,
    sequence: (id: string) => createSequenceMethods(db, id),
    sequenceEvents: createSequenceEventsMethods(db),
    sequenceElements: { list: async () => [] },
    characters: { list: async () => [] },
    locations: { list: async () => [], getCurrentByIds: async () => [] },
    organizationManagement: {
      getMemberEmail: async () => 'writer@example.invalid',
    },
  });
}

function input(): StoryboardTriggerInput {
  return {
    promptLocale: 'en',
    userId: fixture.actorId,
    organizationId: fixture.organizationId,
    sequenceId: fixture.sequence.id,
    reservationId: fixture.reservationId,
    options: {
      shotsPerScene: 3,
      generateThumbnails: true,
      generateDescriptions: true,
      aiProvider: 'openrouter',
      regenerateAll: true,
    },
  };
}

function launch(request = input(), owner = fixture, snapshot = configuration) {
  return triggerStoryboard(scoped(owner), request, snapshot);
}

async function stored() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  if (!row) throw new Error('Missing synthetic sequence');
  return row;
}

function launches(sequenceId = fixture.sequence.id) {
  return db
    .select()
    .from(storyboardLaunches)
    .where(eq(storyboardLaunches.sequenceId, sequenceId));
}

function events() {
  return db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.sequenceId, fixture.sequence.id))
    .orderBy(sequenceEvents.id);
}

async function onlyLaunch() {
  const rows = await launches();
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error('Missing synthetic launch');
  return row;
}

async function leavePending() {
  const lostReply = new Error('Synthetic create response was lost');
  create.mockRejectedValueOnce(lostReply);
  const failCurrent = vi.spyOn(fixture.methods, 'failWorkflowIfCurrent');
  const pending = launch();
  await expect(pending).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
  const row = await onlyLaunch();
  await expect(pending).rejects.toMatchObject({
    workflowRunId: row.workflowRunId,
    reservationId: fixture.reservationId,
    cause: lostReply,
  });
  expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(row.submittedAt).toBeNull();
  expect(failCurrent).not.toHaveBeenCalled();
  expect((await events()).map((event) => event.kind)).toEqual([
    'storyboard.started',
  ]);
  return row;
}

function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error('Deferred promise has not been initialized');
  };
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Storyboard durable startup recovery with real D1', () => {
  it('retries a missing instance with the same claim while its first create response is deferred', async () => {
    const entered = deferred<void>();
    const response = deferred<string>();
    const claim = vi.spyOn(fixture.methods, 'claimWorkflowSlot');
    create.mockImplementationOnce(async () => {
      entered.resolve();
      return response.promise;
    });
    const first = launch();
    await entered.promise;
    const original = await onlyLaunch();
    try {
      await expect(launch()).rejects.toBeInstanceOf(GenerationInProgressError);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(claim).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[1]?.[0]).toStrictEqual(original.prepared);
      expect((await stored()).workflowRunId).toBe(original.workflowRunId);
      expect(await launches()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
    } finally {
      response.resolve(original.workflowRunId);
      await first;
    }
  });

  it('replays the original JSON snapshot after a lost response despite later request and configuration edits', async () => {
    const claim = vi.spyOn(fixture.methods, 'claimWorkflowSlot');
    const original = await leavePending();
    const frozen = structuredClone(original.prepared);
    await db
      .update(sequences)
      .set({
        title: 'Edited title',
        script: 'EXT. EDITED SYNTHETIC LOCATION — NIGHT',
      })
      .where(eq(sequences.id, fixture.sequence.id));
    configuration.textModelRouting = [{ ...ROUTE, inputPricePerMillion: 99 }];
    const retryInput = {
      ...input(),
      promptLocale: 'zh-CN',
      reservationId: generateId(),
      stopAt: 'references',
    } as const;

    await expect(launch(retryInput)).rejects.toBeInstanceOf(
      GenerationInProgressError
    );

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toStrictEqual(frozen);
    expect(frozen.body).toMatchObject({
      script: 'INT. ORIGINAL SYNTHETIC ROOM — DAY',
      title: 'Original synthetic title',
      promptLocale: 'en',
      reservationId: fixture.reservationId,
      workflowClaimId: original.workflowRunId,
    });
    expect(frozen.body.modelConfiguration).toEqual(
      packModelRuntimeConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: [ROUTE],
        imageModelRouting: [],
      })
    );
    expect((await onlyLaunch()).submittedAt).toEqual(expect.any(Date));
    expect(await events()).toHaveLength(1);
    expect(readInstance).toHaveBeenCalledExactlyOnceWith(
      original.workflowRunId
    );
    expect(resolveLegacy).toHaveBeenCalledExactlyOnceWith(LEGACY_RUN);
  });

  it('verifies an accepted create whose response was lost without creating it again', async () => {
    const lostReply = new Error('Synthetic accepted create reply was lost');
    create.mockImplementationOnce(async (prepared) => {
      instances.set(prepared.workflowRunId, LIVE);
      throw lostReply;
    });
    await expect(launch()).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
    const original = await onlyLaunch();

    await expect(launch()).rejects.toBeInstanceOf(GenerationInProgressError);

    expect(readInstance).toHaveBeenCalledExactlyOnceWith(
      original.workflowRunId
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect((await onlyLaunch()).submittedAt).toEqual(expect.any(Date));
    expect(await stored()).toMatchObject({
      workflowRunId: original.workflowRunId,
      status: 'processing',
      statusError: null,
    });
    expect(await events()).toHaveLength(1);
  });

  it.each(['no_binding', 'unreadable'] as const)(
    'fails closed on a pending %s lookup',
    async (kind) => {
      const original = await leavePending();
      readInstance.mockResolvedValueOnce({ kind });

      await expect(launch()).rejects.toBeInstanceOf(
        GenerationStatusUnknownError
      );

      expect(await onlyLaunch()).toEqual(original);
      expect(create).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect((await stored()).workflowRunId).toBe(original.workflowRunId);
      expect(await events()).toHaveLength(1);
    }
  );

  it('records an existing instance before failing closed on its unknown engine status', async () => {
    const original = await leavePending();
    readInstance.mockResolvedValueOnce({
      kind: 'read',
      status: 'unknown',
      output: undefined,
      error: null,
    });
    await expect(launch()).rejects.toBeInstanceOf(GenerationStatusUnknownError);
    expect((await onlyLaunch()).submittedAt).toEqual(expect.any(Date));
    expect((await stored()).workflowRunId).toBe(original.workflowRunId);
    expect(create).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it.each(['complete', 'errored', 'terminated'])(
    'allows a new identity after confirming a pending %s instance',
    async (status) => {
      const original = await leavePending();
      instances.set(original.workflowRunId, {
        kind: 'read',
        status,
        output: undefined,
        error: null,
      });

      const next = await launch();

      expect(next.workflowRunId).not.toBe(original.workflowRunId);
      expect((await stored()).workflowRunId).toBe(next.workflowRunId);
      expect(await launches()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflowRunId: original.workflowRunId,
            submittedAt: expect.any(Date),
          }),
          expect.objectContaining({
            workflowRunId: next.workflowRunId,
            submittedAt: expect.any(Date),
          }),
        ])
      );
      expect(await launches()).toHaveLength(2);
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[0]?.[0].workflowRunId).not.toBe(
        create.mock.calls[1]?.[0].workflowRunId
      );
      expect(await events()).toHaveLength(2);
      expect(
        await fixture.methods.getWorkflowLaunch({
          id: fixture.sequence.id,
          workflowRunId: original.workflowRunId,
        })
      ).toBeUndefined();
      expect(
        await fixture.methods.getWorkflowLaunch({
          id: fixture.sequence.id,
          workflowRunId: next.workflowRunId,
        })
      ).toMatchObject({ workflowRunId: next.workflowRunId });
    }
  );

  it('allows a new identity when a previously submitted instance has expired', async () => {
    const first = await launch();
    instances.delete(first.workflowRunId);
    const next = await launch();
    expect(next.workflowRunId).not.toBe(first.workflowRunId);
    expect(create).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(await launches()).toHaveLength(2);
    expect(await events()).toHaveLength(2);
  });

  it('propagates recovery dispatch failure without wrapping it in the new request reservation', async () => {
    const original = await leavePending();
    const recoveryError = new Error('Synthetic recovery dispatch failed');
    create.mockRejectedValueOnce(recoveryError);
    const request = { ...input(), reservationId: generateId() };
    await expect(launch(request)).rejects.toBe(recoveryError);
    expect(await onlyLaunch()).toEqual(original);
    expect(create.mock.calls[1]?.[0]).toStrictEqual(original.prepared);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await events()).toHaveLength(1);
  });
  it('propagates recovery publication SQL failure without wrapping a new reservation', async () => {
    const original = await leavePending();
    instances.set(original.workflowRunId, LIVE);
    await db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_startup_publish_failure BEFORE UPDATE OF submitted_at ON storyboard_launches WHEN NEW.submitted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Synthetic recovery publish failure'); END"
      )
    );
    const publisher = vi.spyOn(fixture.methods, 'publishWorkflowInstance');
    const recovery = launch({ ...input(), reservationId: generateId() });
    await expect(recovery).rejects.not.toBeInstanceOf(
      WorkflowLaunchPendingError
    );
    const sqlError = await publisher.mock.results[0]?.value.catch(
      (error: unknown) => error
    );
    await expect(recovery).rejects.toBe(sqlError);
    expect(sqlError).toBeInstanceOf(Error);
    expect(sqlError).toMatchObject({
      message: expect.stringContaining('Synthetic recovery publish failure'),
    });
    expect(await onlyLaunch()).toEqual(original);
    expect(create).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await events()).toHaveLength(1);
  });
});

describe('Storyboard preparation and atomic acquisition boundaries', () => {
  it('keeps the reservation when a committed claim loses its response', async () => {
    const original = new Error('Synthetic committed claim response was lost');
    const actual = fixture.methods.claimWorkflowSlot;
    vi.spyOn(fixture.methods, 'claimWorkflowSlot').mockImplementation(
      async (params) => {
        await actual(params);
        throw original;
      }
    );
    const zeroReservation = vi.fn(async () => undefined);
    const pending = releaseReservationOnThrow(
      { billing: { zeroReservation } },
      fixture.reservationId,
      () => launch()
    );
    const error = await pending.catch((error: unknown) => error);
    const record = await onlyLaunch();
    expect(await stored()).toMatchObject({
      workflowRunId: record.workflowRunId,
      status: 'processing',
      statusError: null,
    });
    expect(record.submittedAt).toBeNull();
    expect(error).toBeInstanceOf(WorkflowLaunchPendingError);
    expect(error).toMatchObject({
      cause: original,
      reservationId: fixture.reservationId,
      workflowRunId: record.workflowRunId,
    });
    expect(zeroReservation).not.toHaveBeenCalled();
  });

  it.each(['enforcement', 'configuration'])(
    'leaves no claim, launch or activity when preparation rejects %s',
    async (stage) => {
      const before = await stored();
      const failure = new Error(
        'Synthetic preparation ' + stage + ' rejection'
      );
      const claim = vi.spyOn(fixture.methods, 'claimWorkflowSlot');
      const failCurrent = vi.spyOn(fixture.methods, 'failWorkflowIfCurrent');
      prepare.mockRejectedValueOnce(failure);
      await expect(launch()).rejects.toBe(failure);
      expect(await stored()).toEqual(before);
      expect(await launches()).toEqual([]);
      expect(await events()).toEqual([]);
      expect(claim).not.toHaveBeenCalled();
      expect(failCurrent).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'launch',
      "CREATE TRIGGER synthetic_startup_launch_failure BEFORE INSERT ON storyboard_launches BEGIN SELECT RAISE(ABORT, 'Synthetic launch insert failure'); END",
    ],
    [
      'activity',
      "CREATE TRIGGER synthetic_startup_activity_failure BEFORE INSERT ON sequence_events WHEN NEW.kind = 'storyboard.started' BEGIN SELECT RAISE(ABORT, 'Synthetic activity insert failure'); END",
    ],
  ])(
    'rolls back the owner, processing, outbox and activity on a failed %s insert',
    async (_stage, ddl) => {
      await db.run(sql.raw(ddl));
      const before = await stored();
      await expect(launch()).rejects.toThrow();
      expect(await stored()).toEqual(before);
      expect(await launches()).toEqual([]);
      expect(await events()).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('does not leave an extra launch or activity when a delayed preparation loses the CAS', async () => {
    const prepared = deferred<PreparedStoryboard>();
    const response = deferred<PreparedStoryboard>();
    prepare.mockImplementationOnce(async (...args) => {
      const run = await prepareSyntheticRun(...args);
      prepared.resolve(run);
      return response.promise;
    });
    const losing = launch();
    const candidate = await prepared.promise;
    try {
      const winner = await launch();
      response.resolve(candidate);
      await expect(losing).rejects.toBeInstanceOf(GenerationInProgressError);
      expect(winner.workflowRunId).not.toBe(candidate.workflowRunId);
      expect(await launches()).toEqual([
        expect.objectContaining({ workflowRunId: winner.workflowRunId }),
      ]);
      expect(await events()).toHaveLength(1);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      response.resolve(candidate);
      await losing.catch((error: unknown) =>
        expect(error).toBeInstanceOf(GenerationInProgressError)
      );
    }
  });

  it('keeps Continue switches when its own claimed launch becomes pending', async () => {
    const scopedDb = scoped();
    const sequence = await fixture.methods.getForUser({
      sequenceId: fixture.sequence.id,
    });
    const settings = {
      generationStopAt: 'references',
      generateStartFrames: false,
      generateVoices: false,
      draftMotion: true,
    } as const;
    const lostReply = new Error('Synthetic Continue response was lost');
    create.mockRejectedValueOnce(lostReply);
    const pending = withContinueSwitches(scopedDb, sequence, settings, () =>
      triggerContinue(scopedDb, {
        promptLocale: 'en',
        userId: fixture.actorId,
        organizationId: fixture.organizationId,
        sequence,
        stopAt: settings.generationStopAt,
        // The substituted engine never executes this plan.
        plan: asStub<UpdateStalePlan>({}),
        modelConfiguration: configuration,
      })
    );
    await expect(pending).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
    const original = await onlyLaunch();
    await expect(pending).rejects.toMatchObject({
      workflowRunId: original.workflowRunId,
      cause: lostReply,
    });
    expect(await stored()).toMatchObject({
      ...settings,
      workflowRunId: original.workflowRunId,
      status: 'processing',
      statusError: null,
    });
    expect(original.prepared.body).toMatchObject({
      stopAt: settings.generationStopAt,
      referenceOnly: true,
      generateVoices: false,
      draftMotion: true,
    });
    expect(original.submittedAt).toBeNull();
    expect((await events()).map((event) => event.kind)).toEqual([
      'sequence.settings-changed',
      'storyboard.started',
    ]);
  });
});

describe('Storyboard durable launch ownership and cleanup', () => {
  it('refuses a foreign organization read, publication and recovery of the same pending instance', async () => {
    const original = await leavePending();
    const other = await seedSequence();
    const params = {
      id: fixture.sequence.id,
      workflowRunId: original.workflowRunId,
    };
    expect(await other.methods.getWorkflowLaunch(params)).toBeUndefined();
    expect(
      await other.methods.publishWorkflowInstance({
        ...params,
        claimId: original.workflowRunId,
      })
    ).toBe(false);
    await expect(
      launch(
        {
          ...input(),
          userId: other.actorId,
          organizationId: other.organizationId,
        },
        other
      )
    ).rejects.toThrow();
    expect(await onlyLaunch()).toEqual(original);
    expect((await stored()).workflowRunId).toBe(original.workflowRunId);
    expect(await launches(other.sequence.id)).toEqual([]);
    expect(readInstance).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await events()).toHaveLength(1);
  });

  it('ignores an old launch after a different final instance takes ownership', async () => {
    const original = await leavePending();
    const newerId = 'synthetic-storyboard-' + generateId();
    await db
      .update(sequences)
      .set({ workflowRunId: newerId })
      .where(eq(sequences.id, fixture.sequence.id));
    expect(
      await fixture.methods.getWorkflowLaunch({
        id: fixture.sequence.id,
        workflowRunId: original.workflowRunId,
      })
    ).toBeUndefined();
    expect(
      await fixture.methods.publishWorkflowInstance({
        id: fixture.sequence.id,
        claimId: original.workflowRunId,
        workflowRunId: original.workflowRunId,
      })
    ).toBe(false);
    expect(await onlyLaunch()).toEqual(original);
    expect((await stored()).workflowRunId).toBe(newerId);
  });

  it('deletes launch records with their sequence while preserving another organization records', async () => {
    await launch();
    const other = await seedSequence();
    await triggerStoryboard(
      scoped(other),
      {
        ...input(),
        sequenceId: other.sequence.id,
        organizationId: other.organizationId,
        userId: other.actorId,
      },
      configuration
    );
    const otherLaunches = await launches(other.sequence.id);
    expect(otherLaunches).toHaveLength(1);
    await other.methods.delete(fixture.sequence.id, { releasedVoiceIds: [] });
    expect(await launches()).toHaveLength(1);
    await fixture.methods.delete(fixture.sequence.id, { releasedVoiceIds: [] });
    expect(
      await db
        .select({ id: sequences.id })
        .from(sequences)
        .where(eq(sequences.id, fixture.sequence.id))
    ).toEqual([]);
    expect(await launches()).toEqual([]);
    expect(await launches(other.sequence.id)).toEqual(otherLaunches);
  });
});
