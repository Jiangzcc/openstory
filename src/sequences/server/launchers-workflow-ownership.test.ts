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
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { StyleConfig } from '@/look/style-config';
import type { StoryboardTriggerInput } from '@/platform/server/workflow/types';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type {
  PrepareWorkflowRunOptions,
  PreparedWorkflowRun,
} from '@/platform/server/workflow/prepared-trigger';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import { generateId } from '@/platform/id';
import {
  organization,
  sequences,
  sequenceEvents,
  storyboardLaunches,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from './db/sequences';
import { createSequenceEventsMethods } from './db/sequence-events';

const PRIOR_ERROR = 'Synthetic previous failure';
const NEW_ERROR = 'Synthetic newer result';
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
// The engine is substituted; all launch, sequence and activity writes use migrated test D1.
const preparedRuns: PreparedWorkflowRun<StoryboardWorkflowInput>[] = [];
async function prepareSyntheticRun(
  triggerPath: string,
  body: StoryboardWorkflowInput,
  options?: PrepareWorkflowRunOptions
): Promise<PreparedWorkflowRun<StoryboardWorkflowInput>> {
  const prepared = {
    workflowRunId: 'synthetic-prepared-' + generateId(),
    triggerPath,
    body: structuredClone({
      ...body,
      modelConfiguration: packModelRuntimeConfiguration(
        options?.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION
      ),
    }),
  };
  preparedRuns.push(prepared);
  return prepared;
}
function createdRunId() {
  const [prepared] = preparedRuns;
  if (!prepared) throw new Error('Missing synthetic prepared run');
  return prepared.workflowRunId;
}
const prepare = vi.fn(prepareSyntheticRun);
const trigger = vi.fn(
  async (prepared: PreparedWorkflowRun<StoryboardWorkflowInput>) =>
    prepared.workflowRunId
);
const { WorkflowLaunchPendingError } = await vi.importActual<
  typeof import('@/platform/server/workflow/prepared-trigger')
>('@/platform/server/workflow/prepared-trigger');
vi.doMock('@/platform/server/workflow/prepared-trigger', () => ({
  prepareWorkflowRun: prepare,
  triggerPreparedWorkflow: trigger,
  WorkflowLaunchPendingError,
}));
const liveRead = {
  kind: 'read',
  status: 'running',
  output: undefined,
  error: null,
} as const;
const readInstance = vi.fn<
  typeof import('@/platform/server/workflow/run-outcome').readInstanceIfExists
>(async () => liveRead);
vi.doMock('@/platform/server/workflow/run-outcome', () => ({
  readInstanceIfExists: readInstance,
}));
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: vi.fn(async () => 'failed'),
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn(() => undefined),
}));
const { triggerStoryboard, triggerContinue } = await import('./launchers');

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedSequence>>;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
beforeEach(async () => {
  preparedRuns.length = 0;
  prepare.mockReset().mockImplementation(prepareSyntheticRun);
  trigger
    .mockReset()
    .mockImplementation(async (prepared) => prepared.workflowRunId);
  fixture = await seedSequence();
});
afterEach(async () => {
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_processing_failure'));
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_start_event_failure'));
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_publish_failure'));
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_launch_failure'));
  readInstance.mockReset().mockResolvedValue(liveRead);
});

async function seedSequence() {
  const organizationId = generateId();
  const actorId = generateId();
  const runs = {
    previous: 'synthetic-old-' + generateId(),
    claim: 'synthetic-claim-' + generateId(),
    newer: 'synthetic-new-' + generateId(),
  };
  await db.insert(organization).values({
    id: organizationId,
    name: 'Launcher owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Launcher writer',
    email: actorId + '@example.invalid',
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Launcher test', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Missing test style');
  const methods = createSequencesMethods(db, organizationId, actorId);
  const sequence = await methods.create({
    title: 'Launcher test',
    styleId: style.id,
    generationStopAt: 'images',
  });
  await db
    .update(sequences)
    .set({
      script: 'INT. SYNTHETIC TEST — DAY',
      status: 'failed',
      statusError: PRIOR_ERROR,
      workflowRunId: runs.previous,
    })
    .where(eq(sequences.id, sequence.id));
  return { organizationId, actorId, sequence, methods, runs };
}

function makeScopedDb(methods = fixture.methods) {
  // Only sequence DB and activity methods are real; empty request-side domains are explicit substitutes.
  return asStub<ScopedDb>({
    sequences: methods,
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
    options: {
      shotsPerScene: 3,
      generateThumbnails: true,
      generateDescriptions: true,
      aiProvider: 'openrouter',
      regenerateAll: true,
    },
  };
}

async function stored() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  if (!row) throw new Error('Missing test sequence');
  return row;
}

async function events() {
  return db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.sequenceId, fixture.sequence.id));
}

// Direct SQL fixtures stub unused storyboard content; scoped identity and packed configuration are explicit.
function preparedFixture(
  owner = fixture,
  workflowRunId = owner.runs.claim,
  sequenceId = owner.sequence.id
): PreparedWorkflowRun<StoryboardWorkflowInput> {
  return {
    workflowRunId,
    triggerPath: '/storyboard',
    body: asStub<PreparedWorkflowRun<StoryboardWorkflowInput>['body']>({
      promptLocale: 'en',
      userId: owner.actorId,
      organizationId: owner.organizationId,
      sequenceId,
      workflowClaimId: workflowRunId,
      modelConfiguration: packModelRuntimeConfiguration(
        DEFAULT_MODEL_CONFIGURATION
      ),
    }),
  };
}

function claim(
  activity: { summary: string } | null = { summary: 'Synthetic start' }
) {
  return fixture.methods.claimWorkflowSlot({
    id: fixture.sequence.id,
    expectedRunId: fixture.runs.previous,
    claimId: fixture.runs.claim,
    launch: preparedFixture(),
    activity,
  });
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

async function launches() {
  return db
    .select()
    .from(storyboardLaunches)
    .where(eq(storyboardLaunches.sequenceId, fixture.sequence.id));
}

function launch(scopedDb = makeScopedDb()) {
  return triggerStoryboard(scopedDb, input(), DEFAULT_MODEL_CONFIGURATION);
}

describe('Storyboard launcher ownership with real sequence DB methods', () => {
  it.each(['failed', 'completed'] as const)(
    'claims and clears a prior %s status in the same write',
    async (status) => {
      await db
        .update(sequences)
        .set({ status })
        .where(eq(sequences.id, fixture.sequence.id));

      expect(await claim()).toBe(true);

      expect(await stored()).toMatchObject({
        workflowRunId: fixture.runs.claim,
        status: 'processing',
        statusError: null,
      });
      expect(await events()).toEqual([
        expect.objectContaining({
          kind: 'storyboard.started',
          summary: 'Synthetic start',
        }),
      ]);
    }
  );

  it('keeps processing part of acquisition when no activity is requested', async () => {
    expect(await claim(null)).toBe(true);
    expect(await stored()).toMatchObject({
      workflowRunId: fixture.runs.claim,
      status: 'processing',
      statusError: null,
    });
    expect(await events()).toEqual([]);
  });

  it('rolls back claim, processing and activity when processing cannot be written', async () => {
    await db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_processing_failure BEFORE UPDATE OF status ON sequences WHEN NEW.status = 'processing' BEGIN SELECT RAISE(ABORT, 'Synthetic processing failure'); END"
      )
    );
    const before = await stored();

    await expect(launch()).rejects.toThrow();

    expect(await stored()).toEqual(before);
    expect(await events()).toEqual([]);
    expect(await launches()).toEqual([]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('rolls back all acquisition fields when the start activity insert fails', async () => {
    await db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_start_event_failure BEFORE INSERT ON sequence_events WHEN NEW.kind = 'storyboard.started' BEGIN SELECT RAISE(ABORT, 'Synthetic start event failure'); END"
      )
    );
    const before = await stored();

    await expect(launch()).rejects.toThrow();

    expect(await stored()).toEqual(before);
    expect(await events()).toEqual([]);
    expect(await launches()).toEqual([]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('dispatches only after the processing claim is committed and publishes its instance', async () => {
    trigger.mockImplementationOnce(async () => {
      const row = await stored();
      expect(row.workflowRunId).toBe(createdRunId());
      expect(await launches()).toEqual([
        expect.objectContaining({
          workflowRunId: createdRunId(),
          submittedAt: null,
          prepared: expect.objectContaining({
            workflowRunId: createdRunId(),
            body: expect.objectContaining({ workflowClaimId: createdRunId() }),
          }),
        }),
      ]);
      expect(row).toMatchObject({ status: 'processing', statusError: null });
      expect(await events()).toHaveLength(1);
      return createdRunId();
    });

    const launched = await launch();
    expect(launched).toEqual({ workflowRunId: createdRunId() });

    expect(await stored()).toMatchObject({
      workflowRunId: createdRunId(),
      status: 'processing',
      statusError: null,
    });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(await launches()).toEqual([
      expect.objectContaining({
        workflowRunId: createdRunId(),
        submittedAt: expect.any(Date),
      }),
    ]);
    expect(await events()).toHaveLength(1);
  });

  it.each(['processing', 'failed', 'completed'] as const)(
    'preserves a newer %s run when the old create response arrives',
    async (status) => {
      let newer = await stored();
      trigger.mockImplementationOnce(async () => {
        await db
          .update(sequences)
          .set({
            workflowRunId: fixture.runs.newer,
            status,
            statusError: NEW_ERROR,
          })
          .where(eq(sequences.id, fixture.sequence.id));
        newer = await stored();
        return createdRunId();
      });

      const launched = await launch();
      expect(launched).toEqual({
        workflowRunId: createdRunId(),
      });

      expect(await stored()).toEqual(newer);
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(await events()).toHaveLength(1);
    }
  );

  it.each(['failed', 'completed'] as const)(
    'publishes the instance without changing its already %s result',
    async (status) => {
      trigger.mockImplementationOnce(async () => {
        await db
          .update(sequences)
          .set({ status, statusError: NEW_ERROR })
          .where(eq(sequences.id, fixture.sequence.id));
        return createdRunId();
      });

      const launched = await launch();
      expect(launched).toEqual({
        workflowRunId: createdRunId(),
      });

      expect(await stored()).toMatchObject({
        workflowRunId: createdRunId(),
        status,
        statusError: NEW_ERROR,
      });
      expect(await events()).toHaveLength(1);
    }
  );

  it('does not reassert processing after another run takes over the acquired claim', async () => {
    const methods = {
      ...fixture.methods,
      claimWorkflowSlot: async (
        params: Parameters<typeof fixture.methods.claimWorkflowSlot>[0]
      ) => {
        const claimed = await fixture.methods.claimWorkflowSlot(params);
        await db
          .update(sequences)
          .set({
            workflowRunId: fixture.runs.newer,
            status: 'completed',
            statusError: NEW_ERROR,
          })
          .where(eq(sequences.id, fixture.sequence.id));
        return claimed;
      },
    };

    const launched = await launch(makeScopedDb(methods));
    expect(launched).toEqual({
      workflowRunId: createdRunId(),
    });

    expect(await stored()).toMatchObject({
      workflowRunId: fixture.runs.newer,
      status: 'completed',
      statusError: NEW_ERROR,
    });
  });

  it('a losing acquisition preserves status, error, owner and activity', async () => {
    await db
      .update(sequences)
      .set({
        workflowRunId: fixture.runs.newer,
        status: 'completed',
        statusError: NEW_ERROR,
      })
      .where(eq(sequences.id, fixture.sequence.id));
    const before = await stored();

    expect(await claim()).toBe(false);

    expect(await stored()).toEqual(before);
    expect(await events()).toEqual([]);
  });
});

describe('Storyboard acquisition and publication database boundaries', () => {
  it('acquires an unowned slot and processing state together', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: null })
      .where(eq(sequences.id, fixture.sequence.id));

    expect(
      await fixture.methods.claimWorkflowSlot({
        id: fixture.sequence.id,
        expectedRunId: null,
        claimId: fixture.runs.claim,
        launch: preparedFixture(),
        activity: null,
      })
    ).toBe(true);

    expect(await stored()).toMatchObject({
      workflowRunId: fixture.runs.claim,
      status: 'processing',
      statusError: null,
    });
    expect(await events()).toEqual([]);
  });

  it('does not write a foreign organization start activity even if the supplied claim matches its owner', async () => {
    const other = await seedSequence();
    const before = await stored();

    expect(
      await other.methods.claimWorkflowSlot({
        id: fixture.sequence.id,
        expectedRunId: fixture.runs.previous,
        claimId: fixture.runs.previous,
        launch: preparedFixture(
          other,
          fixture.runs.previous,
          fixture.sequence.id
        ),
        activity: { summary: 'Synthetic foreign attempt' },
      })
    ).toBe(false);

    expect(await stored()).toEqual(before);
    expect(await events()).toEqual([]);
  });

  it('refuses publication into another organization with a matching final instance id', async () => {
    await claim(null);
    const other = await seedSequence();
    const before = await stored();

    expect(
      await other.methods.publishWorkflowInstance({
        id: fixture.sequence.id,
        claimId: fixture.runs.claim,
        workflowRunId: fixture.runs.claim,
      })
    ).toBe(false);

    expect(await stored()).toEqual(before);
  });

  it.each(['missing', 'unowned'] as const)(
    'refuses publication for a %s sequence slot',
    async (kind) => {
      await db
        .update(sequences)
        .set({ workflowRunId: null })
        .where(eq(sequences.id, fixture.sequence.id));
      const before = await stored();

      expect(
        await fixture.methods.publishWorkflowInstance({
          id: kind === 'missing' ? generateId() : fixture.sequence.id,
          claimId: fixture.runs.claim,
          workflowRunId: fixture.runs.claim,
        })
      ).toBe(false);

      expect(await stored()).toEqual(before);
    }
  );

  it('records submission once when the final instance id already owns the slot', async () => {
    await claim(null);
    const params = {
      id: fixture.sequence.id,
      claimId: fixture.runs.claim,
      workflowRunId: fixture.runs.claim,
    };

    expect(await fixture.methods.publishWorkflowInstance(params)).toBe(true);
    const published = await stored();
    const submitted = await launches();
    expect(submitted).toEqual([
      expect.objectContaining({
        workflowRunId: fixture.runs.claim,
        submittedAt: expect.any(Date),
      }),
    ]);
    await fixture.methods.publishWorkflowInstance(params);

    expect(await launches()).toEqual(submitted);
    expect(published).toMatchObject({
      workflowRunId: fixture.runs.claim,
      status: 'processing',
      statusError: null,
    });
    expect(await events()).toEqual([]);
  });

  it.each([
    ['workflowRunId', 'synthetic-invalid-' + generateId()],
    ['triggerPath', '/image'],
    ['organizationId', 'synthetic-foreign-organization'],
    ['userId', 'synthetic-foreign-user'],
    ['sequenceId', 'synthetic-foreign-sequence'],
    ['workflowClaimId', 'synthetic-invalid-' + generateId()],
  ] as const)(
    'refuses mismatched prepared %s before any acquisition write',
    async (field, value) => {
      const launch = preparedFixture();
      const invalid =
        field === 'workflowRunId' || field === 'triggerPath'
          ? { ...launch, [field]: value }
          : { ...launch, body: { ...launch.body, [field]: value } };
      const before = await stored();
      await expect(
        fixture.methods.claimWorkflowSlot({
          id: fixture.sequence.id,
          expectedRunId: fixture.runs.previous,
          claimId: fixture.runs.claim,
          launch: invalid,
          activity: { summary: 'Synthetic invalid claim' },
        })
      ).rejects.toThrow('Storyboard launch does not match its scoped owner');
      expect(await stored()).toEqual(before);
      expect(await launches()).toEqual([]);
      expect(await events()).toEqual([]);
    }
  );

  it('preserves a publication SQL cause and verifies the created instance on retry', async () => {
    await db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_publish_failure BEFORE UPDATE OF submitted_at ON storyboard_launches WHEN NEW.submitted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Synthetic publish failure'); END"
      )
    );
    const publisher = vi.spyOn(fixture.methods, 'publishWorkflowInstance');
    const pending = launch();
    await expect(pending).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
    const sqlError = await publisher.mock.results[0]?.value.catch(
      (error: unknown) => error
    );
    await expect(pending).rejects.toMatchObject({
      workflowRunId: createdRunId(),
      cause: sqlError,
    });
    expect(sqlError).toBeInstanceOf(Error);
    expect(sqlError).toMatchObject({
      message: expect.stringContaining('Synthetic publish failure'),
    });
    expect(await stored()).toMatchObject({
      workflowRunId: createdRunId(),
      status: 'processing',
      statusError: null,
    });
    expect(await launches()).toEqual([
      expect.objectContaining({
        workflowRunId: createdRunId(),
        submittedAt: null,
      }),
    ]);
    await db.run(sql.raw('DROP TRIGGER synthetic_publish_failure'));

    await expect(launch()).rejects.toMatchObject({
      name: 'GenerationInProgressError',
    });

    expect(readInstance).toHaveBeenCalledExactlyOnceWith(createdRunId());
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await launches()).toEqual([
      expect.objectContaining({ submittedAt: expect.any(Date) }),
    ]);
    expect(await events()).toEqual([
      expect.objectContaining({ kind: 'storyboard.started' }),
    ]);
  });
});

it('keeps Continue switches and its created instance id when publication loses ownership', async () => {
  const scopedDb = makeScopedDb();
  const sequence = await fixture.methods.getForUser({
    sequenceId: fixture.sequence.id,
  });
  const settings = {
    generationStopAt: 'references',
    generateStartFrames: false,
    generateVoices: false,
    draftMotion: true,
  } as const;
  trigger.mockImplementationOnce(async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: fixture.runs.newer })
      .where(eq(sequences.id, fixture.sequence.id));
    return createdRunId();
  });

  const result = await triggerContinue(scopedDb, {
    promptLocale: 'en',
    userId: fixture.actorId,
    organizationId: fixture.organizationId,
    sequence,
    settings,
    // This plan is only carried through the launcher; the mocked workflow engine never executes it.
    plan: asStub<UpdateStalePlan>({}),
    modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
  });

  expect(result).toEqual({ workflowRunId: createdRunId() });
  expect(await stored()).toMatchObject({
    ...settings,
    workflowRunId: fixture.runs.newer,
    status: 'processing',
    statusError: null,
  });
  expect(trigger).toHaveBeenCalledTimes(1);
});

describe('Storyboard startup exclusion regressions', () => {
  it('retains the same slot while the first create response is in flight', async () => {
    const created = deferred<string>();
    const entered = deferred<void>();
    trigger.mockImplementationOnce(async () => {
      entered.resolve();
      return created.promise;
    });
    const first = launch();
    await Promise.race([entered.promise, first]);
    const acquired = await stored();
    try {
      await expect(launch()).rejects.toMatchObject({
        name: 'GenerationInProgressError',
      });
      expect(acquired.workflowRunId).toBe(createdRunId());
      expect((await stored()).workflowRunId).toBe(acquired.workflowRunId);
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(await launches()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
    } finally {
      created.resolve(createdRunId());
      await first;
    }
  });

  it('keeps an uncertain create result pending instead of recording a definitive failure', async () => {
    const lostReply = new Error('Synthetic create reply was lost');
    trigger.mockRejectedValueOnce(lostReply);
    const pending = launch();
    await expect(pending).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
    await expect(pending).rejects.toMatchObject({
      workflowRunId: createdRunId(),
      cause: lostReply,
    });
    expect(await launches()).toEqual([
      expect.objectContaining({
        workflowRunId: createdRunId(),
        submittedAt: null,
      }),
    ]);
    expect(await stored()).toMatchObject({
      status: 'processing',
      statusError: null,
    });
    expect((await events()).map((event) => event.kind)).toEqual([
      'storyboard.started',
    ]);
  });
});
