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
import { generateId } from '@/platform/id';
import {
  organization,
  sequences,
  sequenceEvents,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from './db/sequences';
import { createSequenceEventsMethods } from './db/sequence-events';

const OLD_RUN = 'synthetic-old-instance';
const CREATED_RUN = 'synthetic-created-instance';
const NEW_RUN = 'synthetic-new-instance';
const CLAIM = 'synthetic-acquired-claim';
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
const trigger = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => CREATED_RUN
);
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: trigger,
}));
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: vi.fn(async () => 'failed'),
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn(() => undefined),
}));
const { triggerStoryboard, triggerContinue } = await import('./launchers');
const { withContinueSwitches } = await import('./continue-plan');

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedSequence>>;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
beforeEach(async () => {
  trigger.mockReset().mockResolvedValue(CREATED_RUN);
  fixture = await seedSequence();
});
afterEach(async () => {
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_processing_failure'));
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_start_event_failure'));
  await db.run(sql.raw('DROP TRIGGER IF EXISTS synthetic_publish_failure'));
});

async function seedSequence() {
  const organizationId = generateId();
  const actorId = generateId();
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
      workflowRunId: OLD_RUN,
    })
    .where(eq(sequences.id, sequence.id));
  return { organizationId, actorId, sequence, methods };
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

function claim(
  activity: { summary: string } | null = { summary: 'Synthetic start' }
) {
  return fixture.methods.claimWorkflowSlot({
    id: fixture.sequence.id,
    expectedRunId: OLD_RUN,
    claimId: CLAIM,
    activity,
  });
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
        workflowRunId: CLAIM,
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
      workflowRunId: CLAIM,
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
    expect(trigger).not.toHaveBeenCalled();
  });

  it('dispatches only after the processing claim is committed and publishes its instance', async () => {
    trigger.mockImplementationOnce(async () => {
      const row = await stored();
      expect(row.workflowRunId).toMatch(/^storyboard-/);
      expect(row).toMatchObject({ status: 'processing', statusError: null });
      expect(await events()).toHaveLength(1);
      return CREATED_RUN;
    });

    await expect(launch()).resolves.toEqual({ workflowRunId: CREATED_RUN });

    expect(await stored()).toMatchObject({
      workflowRunId: CREATED_RUN,
      status: 'processing',
      statusError: null,
    });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(await events()).toHaveLength(1);
  });

  it.each(['processing', 'failed', 'completed'] as const)(
    'preserves a newer %s run when the old create response arrives',
    async (status) => {
      let newer = await stored();
      trigger.mockImplementationOnce(async () => {
        await db
          .update(sequences)
          .set({ workflowRunId: NEW_RUN, status, statusError: NEW_ERROR })
          .where(eq(sequences.id, fixture.sequence.id));
        newer = await stored();
        return CREATED_RUN;
      });

      await expect(launch()).resolves.toEqual({ workflowRunId: CREATED_RUN });

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
        return CREATED_RUN;
      });

      await expect(launch()).resolves.toEqual({ workflowRunId: CREATED_RUN });

      expect(await stored()).toMatchObject({
        workflowRunId: CREATED_RUN,
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
            workflowRunId: NEW_RUN,
            status: 'completed',
            statusError: NEW_ERROR,
          })
          .where(eq(sequences.id, fixture.sequence.id));
        return claimed;
      },
    };

    await expect(launch(makeScopedDb(methods))).resolves.toEqual({
      workflowRunId: CREATED_RUN,
    });

    expect(await stored()).toMatchObject({
      workflowRunId: NEW_RUN,
      status: 'completed',
      statusError: NEW_ERROR,
    });
  });

  it('a losing acquisition preserves status, error, owner and activity', async () => {
    await db
      .update(sequences)
      .set({
        workflowRunId: NEW_RUN,
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
        claimId: CLAIM,
        activity: null,
      })
    ).toBe(true);

    expect(await stored()).toMatchObject({
      workflowRunId: CLAIM,
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
        expectedRunId: OLD_RUN,
        claimId: OLD_RUN,
        activity: { summary: 'Synthetic foreign attempt' },
      })
    ).toBe(false);

    expect(await stored()).toEqual(before);
    expect(await events()).toEqual([]);
  });

  it('refuses publication into another organization with a matching raw claim', async () => {
    await claim(null);
    const other = await seedSequence();
    const before = await stored();

    expect(
      await other.methods.publishWorkflowInstance({
        id: fixture.sequence.id,
        claimId: CLAIM,
        workflowRunId: CREATED_RUN,
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
          claimId: CLAIM,
          workflowRunId: CREATED_RUN,
        })
      ).toBe(false);

      expect(await stored()).toEqual(before);
    }
  );

  it('publishes once and leaves an already-published owner unchanged on repetition', async () => {
    await claim(null);
    const params = {
      id: fixture.sequence.id,
      claimId: CLAIM,
      workflowRunId: CREATED_RUN,
    };

    expect(await fixture.methods.publishWorkflowInstance(params)).toBe(true);
    const published = await stored();
    expect(await fixture.methods.publishWorkflowInstance(params)).toBe(false);

    expect(await stored()).toEqual(published);
    expect(published).toMatchObject({
      workflowRunId: CREATED_RUN,
      status: 'processing',
      statusError: null,
    });
    expect(await events()).toEqual([]);
  });

  it('propagates a publication SQL error after creation without retriggering or fabricating a run failure', async () => {
    await db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_publish_failure BEFORE UPDATE OF workflow_run_id ON sequences WHEN NEW.workflow_run_id = 'synthetic-created-instance' BEGIN SELECT RAISE(ABORT, 'Synthetic publish failure'); END"
      )
    );

    await expect(launch()).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('Synthetic publish failure'),
      }),
    });

    const row = await stored();
    expect(row.workflowRunId).toMatch(/^storyboard-/);
    expect(row).toMatchObject({ status: 'processing', statusError: null });
    expect(trigger).toHaveBeenCalledTimes(1);
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
      .set({ workflowRunId: NEW_RUN })
      .where(eq(sequences.id, fixture.sequence.id));
    return CREATED_RUN;
  });

  const result = await withContinueSwitches(scopedDb, sequence, settings, () =>
    triggerContinue(scopedDb, {
      promptLocale: 'en',
      userId: fixture.actorId,
      organizationId: fixture.organizationId,
      sequence,
      stopAt: settings.generationStopAt,
      // This plan is only carried through the launcher; the mocked workflow engine never executes it.
      plan: asStub<UpdateStalePlan>({}),
      modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
    })
  );

  expect(result).toEqual({ workflowRunId: CREATED_RUN });
  expect(await stored()).toMatchObject({
    ...settings,
    workflowRunId: NEW_RUN,
    status: 'processing',
    statusError: null,
  });
  expect(trigger).toHaveBeenCalledTimes(1);
});
