import { eq } from 'drizzle-orm';
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
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  organization,
  sequences,
  storyboardLaunches,
  styles,
  user,
} from '@/platform/server/db/schema';
import type { PreparedWorkflowRun } from '@/platform/server/workflow/prepared-trigger';
import type { InstanceRead } from '@/platform/server/workflow/run-outcome';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import * as launchDb from '@/sequences/server/db/storyboard-launch-reconcile';

// Synthetic snapshots and engine replies; no workflow or supplier is contacted.
const [styleTemplate] = DEFAULT_STYLE_TEMPLATES;
if (!styleTemplate) throw new Error('Synthetic test needs a style template');
const STYLE_CONFIG = styleTemplate.config;
const STALE_AT = new Date(0);
const MAX_LAUNCHES = 100;
let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedOwner>>;
const runState =
  vi.fn<(id: string) => Promise<'failed' | 'completed' | 'unknown' | null>>();
const readInstance =
  vi.fn<(id: string) => Promise<InstanceRead | { kind: 'missing' }>>();
const dispatch =
  vi.fn<
    (prepared: PreparedWorkflowRun<StoryboardWorkflowInput>) => Promise<string>
  >();

vi.doMock('#db-client', () => ({ getDb: () => db }));
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: runState,
  STALE_THRESHOLD_MS: 5 * 60 * 1000,
}));
vi.doMock('@/platform/server/workflow/run-outcome', () => ({
  readInstanceIfExists: readInstance,
}));
vi.doMock('@/platform/server/workflow/prepared-trigger', () => ({
  triggerPreparedWorkflow: dispatch,
}));
const { PASS_ERRORED, reconcileAllStuckJobs } = await import('./reconcile-all');
const { reconcileStoryboardLaunches, resolveStoryboardSequenceState } =
  await import('@/sequences/server/reconcile-storyboard-launches');

function reconcileLaunches(limit?: number) {
  return reconcileAllStuckJobs({
    resolveSequenceState: resolveStoryboardSequenceState,
    dispatchSequences: (database) =>
      reconcileStoryboardLaunches(database, limit),
  });
}

type SyntheticOwner = {
  organizationId: string;
  userId: string;
  sequenceId: string;
  styleId: string;
  workflowRunId: string;
};

function preparedFor(
  owner: SyntheticOwner
): PreparedWorkflowRun<StoryboardWorkflowInput> {
  return {
    workflowRunId: owner.workflowRunId,
    triggerPath: '/storyboard',
    body: {
      organizationId: owner.organizationId,
      userId: owner.userId,
      sequenceId: owner.sequenceId,
      promptLocale: 'en',
      title: 'Synthetic storyboard launch',
      script: 'Synthetic script',
      aspectRatio: '16:9',
      styleConfig: STYLE_CONFIG,
      analysisModelId: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      imageModel: DEFAULT_MODEL_CONFIGURATION.defaultImage,
      videoModel: DEFAULT_MODEL_CONFIGURATION.defaultVideo,
      modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
      stopAt: 'script',
      elementIds: [],
      cast: [],
      musicPromptSource: 'ai-generated',
      referenceOnly: false,
      includeMusic: false,
      sequenceUrl: 'https://example.invalid/sequences/' + owner.sequenceId,
    },
  };
}

async function seedOwner(): Promise<SyntheticOwner> {
  const owner = {
    organizationId: generateId(),
    userId: generateId(),
    sequenceId: generateId(),
    styleId: generateId(),
    workflowRunId: 'synthetic_storyboard_' + generateId(),
  };
  await db.insert(organization).values({
    id: owner.organizationId,
    name: 'Synthetic',
    slug: owner.organizationId,
  });
  await db.insert(user).values({
    id: owner.userId,
    name: 'Synthetic',
    email: owner.userId + '@example.invalid',
  });
  await db.insert(styles).values({
    id: owner.styleId,
    organizationId: owner.organizationId,
    name: 'Synthetic style',
    config: STYLE_CONFIG,
  });
  await db.insert(sequences).values({
    id: owner.sequenceId,
    organizationId: owner.organizationId,
    title: 'Synthetic storyboard launch',
    styleId: owner.styleId,
    workflowRunId: owner.workflowRunId,
    status: 'processing',
    updatedAt: STALE_AT,
  });
  return owner;
}

async function addLaunch(owner = fixture, submittedAt: Date | null = null) {
  const [launch] = await db
    .insert(storyboardLaunches)
    .values({
      organizationId: owner.organizationId,
      sequenceId: owner.sequenceId,
      workflowRunId: owner.workflowRunId,
      prepared: preparedFor(owner),
      submittedAt,
    })
    .returning();
  if (!launch) throw new Error('Synthetic launch insert failed');
  return launch;
}

async function readOwner(owner = fixture) {
  const [sequence] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, owner.sequenceId));
  return sequence;
}

async function readLaunch(id: string) {
  const [launch] = await db
    .select()
    .from(storyboardLaunches)
    .where(eq(storyboardLaunches.id, id));
  return launch;
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
beforeEach(async () => {
  await db.delete(storyboardLaunches);
  await db.delete(sequences);
  await db.delete(styles);
  await db.delete(organization);
  await db.delete(user);
  fixture = await seedOwner();
  runState.mockReset().mockResolvedValue(null);
  readInstance.mockReset().mockResolvedValue({ kind: 'missing' });
  dispatch
    .mockReset()
    .mockImplementation(async (prepared) => prepared.workflowRunId);
});

describe('pending storyboard launch dispatch', () => {
  it('redrives a crash-before-create with the original persisted snapshot', async () => {
    const launch = await addLaunch();
    const counts = await reconcileLaunches();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(launch.prepared);
    expect((await readLaunch(launch.id))?.submittedAt).toBeInstanceOf(Date);
    expect((await readOwner())?.status).toBe('processing');
    expect(counts['sequences.dispatch']).toBe(1);
  });

  it('retries an accepted dispatch with a lost response using the same exact id', async () => {
    const launch = await addLaunch();
    const accepted = new Set<string>();
    let responseLost = true;
    dispatch.mockImplementation(async (prepared) => {
      accepted.add(prepared.workflowRunId);
      if (responseLost) {
        responseLost = false;
        throw new Error('Synthetic response lost after create');
      }
      return prepared.workflowRunId;
    });
    const first = await reconcileLaunches();
    expect(first['sequences.dispatch']).toBe(PASS_ERRORED);
    expect((await readLaunch(launch.id))?.submittedAt).toBeNull();
    expect((await readOwner())?.status).toBe('processing');
    await reconcileLaunches();
    expect(accepted).toEqual(new Set([launch.workflowRunId]));
    expect(dispatch.mock.calls.map(([prepared]) => prepared)).toEqual([
      launch.prepared,
      launch.prepared,
    ]);
    expect((await readLaunch(launch.id))?.submittedAt).toBeInstanceOf(Date);
  });

  it('keeps the immutable pending row when submission confirmation throws', async () => {
    const launch = await addLaunch();
    vi.spyOn(
      launchDb,
      'confirmStoryboardLaunchSubmitted'
    ).mockRejectedValueOnce(new Error('Synthetic D1 failure'));
    const counts = await reconcileLaunches();
    expect(counts['sequences.dispatch']).toBe(PASS_ERRORED);
    expect((await readLaunch(launch.id))?.submittedAt).toBeNull();
    expect((await readLaunch(launch.id))?.prepared).toEqual(launch.prepared);
    expect((await readOwner())?.status).toBe('processing');
  });

  it('confirms a fast terminal run without reasserting processing', async () => {
    const launch = await addLaunch();
    dispatch.mockImplementation(async (prepared) => {
      await db
        .update(sequences)
        .set({ status: 'completed' })
        .where(eq(sequences.id, fixture.sequenceId));
      return prepared.workflowRunId;
    });
    await reconcileLaunches();
    expect((await readLaunch(launch.id))?.submittedAt).toBeInstanceOf(Date);
    expect((await readOwner())?.status).toBe('completed');
  });

  it('does not confirm an obsolete launch after its owner changes during create', async () => {
    const launch = await addLaunch();
    const nextRun = 'synthetic_storyboard_' + generateId();
    dispatch.mockImplementation(async (prepared) => {
      await db
        .update(sequences)
        .set({ workflowRunId: nextRun })
        .where(eq(sequences.id, fixture.sequenceId));
      return prepared.workflowRunId;
    });
    const counts = await reconcileLaunches();
    expect(counts['sequences.dispatch']).toBe(0);
    expect((await readLaunch(launch.id))?.submittedAt).toBeNull();
    expect((await readOwner())?.workflowRunId).toBe(nextRun);
  });

  it.each(['archived', 'completed', 'failed'] as const)(
    'does not redrive a %s owner',
    async (status) => {
      const launch = await addLaunch();
      await db
        .update(sequences)
        .set({ status })
        .where(eq(sequences.id, fixture.sequenceId));
      await reconcileLaunches();
      expect(dispatch).not.toHaveBeenCalled();
      expect((await readLaunch(launch.id))?.submittedAt).toBeNull();
    }
  );

  it('skips superseded snapshots and submitted launches', async () => {
    const launch = await addLaunch();
    await db
      .update(sequences)
      .set({ workflowRunId: 'synthetic_storyboard_' + generateId() })
      .where(eq(sequences.id, fixture.sequenceId));
    const other = await seedOwner();
    await addLaunch(other, new Date());
    await reconcileLaunches();
    expect(dispatch).not.toHaveBeenCalled();
    expect((await readLaunch(launch.id))?.submittedAt).toBeNull();
  });

  it('rechecks each pending owner before dispatching a selected batch', async () => {
    await addLaunch();
    const other = await seedOwner();
    await addLaunch(other);
    dispatch.mockImplementation(async (prepared) => {
      const archiveId =
        prepared.body.sequenceId === fixture.sequenceId
          ? other.sequenceId
          : fixture.sequenceId;
      await db
        .update(sequences)
        .set({ status: 'archived' })
        .where(eq(sequences.id, archiveId));
      return prepared.workflowRunId;
    });
    const counts = await reconcileLaunches();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(counts['sequences.dispatch']).toBe(1);
  });

  it('rotates a refused oldest launch out of a limited batch on the next sweep', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const firstSweep = new Date('2026-11-14T00:00:00.000Z');
    const nextSweep = new Date('2026-11-14T00:05:00.000Z');
    vi.setSystemTime(firstSweep);
    const refused = await addLaunch();
    const allowed = await addLaunch(await seedOwner());
    await db
      .update(storyboardLaunches)
      .set({ createdAt: STALE_AT })
      .where(eq(storyboardLaunches.id, refused.id));
    dispatch.mockImplementation(async (prepared) => {
      if (prepared.workflowRunId === refused.workflowRunId)
        throw new Error('Synthetic permanent enforcement refusal');
      return prepared.workflowRunId;
    });
    const first = await reconcileLaunches(1);
    expect(first['sequences.dispatch']).toBe(PASS_ERRORED);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(refused.prepared);
    expect((await readLaunch(refused.id))?.lastAttemptAt).toEqual(firstSweep);
    expect((await readLaunch(refused.id))?.submittedAt).toBeNull();
    expect((await readLaunch(allowed.id))?.lastAttemptAt).toBeNull();
    vi.setSystemTime(nextSweep);
    const second = await reconcileLaunches(1);
    expect(second['sequences.dispatch']).toBe(1);
    expect(
      dispatch.mock.calls.map(([prepared]) => prepared.workflowRunId)
    ).toEqual([refused.workflowRunId, allowed.workflowRunId]);
    expect((await readLaunch(allowed.id))?.lastAttemptAt).toEqual(nextSweep);
    expect((await readLaunch(allowed.id))?.submittedAt).toEqual(nextSweep);
    expect((await readLaunch(refused.id))?.submittedAt).toBeNull();
    expect((await readOwner())?.status).toBe('processing');
  });

  it('continues other pending launches after an enforcement refusal', async () => {
    const refused = await addLaunch();
    const allowed = await addLaunch(await seedOwner());
    dispatch.mockImplementation(async (prepared) => {
      if (prepared.workflowRunId === refused.workflowRunId)
        throw new Error('Synthetic enforcement refusal');
      return prepared.workflowRunId;
    });
    const counts = await reconcileLaunches();
    expect(counts['sequences.dispatch']).toBe(PASS_ERRORED);
    expect((await readLaunch(refused.id))?.submittedAt).toBeNull();
    expect((await readLaunch(allowed.id))?.submittedAt).toBeInstanceOf(Date);
    expect((await readOwner())?.status).toBe('processing');
  });
});

describe('storyboard sequence status reconciliation', () => {
  it.each(['missing', 'unreadable', 'no_binding'] as const)(
    'keeps pending + %s nonterminal',
    async (kind) => {
      const launch = await addLaunch();
      dispatch.mockRejectedValue(new Error('Synthetic unconfirmed dispatch'));
      readInstance.mockResolvedValue({ kind });
      runState.mockResolvedValue('failed');
      const counts = await reconcileLaunches();
      expect((await readOwner())?.status).toBe('processing');
      expect((await readLaunch(launch.id))?.submittedAt).toBeNull();
      expect(counts['sequences.status']).toBe(0);
      expect(runState).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['complete', 'completed'],
    ['errored', 'failed'],
    ['terminated', 'failed'],
  ] as const)(
    'trusts a pending run positively observed as %s',
    async (status, expected) => {
      await addLaunch();
      dispatch.mockRejectedValue(new Error('Synthetic response loss'));
      readInstance.mockResolvedValue({
        kind: 'read',
        status,
        output: undefined,
        error: null,
      });
      await reconcileLaunches();
      expect((await readOwner())?.status).toBe(expected);
    }
  );

  it('retains the generic missing-instance verdict for a submitted run', async () => {
    await addLaunch(fixture, new Date());
    runState.mockResolvedValue('failed');
    await reconcileLaunches();
    expect(dispatch).not.toHaveBeenCalled();
    expect(readInstance).not.toHaveBeenCalled();
    expect((await readOwner())?.status).toBe('failed');
  });

  it('does not write an old run verdict over a new owner', async () => {
    const nextRun = 'synthetic_storyboard_' + generateId();
    runState.mockImplementation(async () => {
      await db
        .update(sequences)
        .set({ workflowRunId: nextRun })
        .where(eq(sequences.id, fixture.sequenceId));
      return 'failed';
    });
    await reconcileLaunches();
    expect((await readOwner())?.workflowRunId).toBe(nextRun);
    expect((await readOwner())?.status).toBe('processing');
  });
});

describe('storyboard launch DB ownership and deletion cleanup', () => {
  it('requires matching organization, sequence and current run for pending reads', async () => {
    await addLaunch();
    const query = {
      id: fixture.sequenceId,
      organizationId: fixture.organizationId,
      workflowRunId: fixture.workflowRunId,
    };
    expect(await launchDb.hasPendingStoryboardLaunch(db, query)).toBe(true);
    expect(
      await launchDb.hasPendingStoryboardLaunch(db, {
        ...query,
        organizationId: generateId(),
      })
    ).toBe(false);
    expect(
      await launchDb.hasPendingStoryboardLaunch(db, {
        ...query,
        id: generateId(),
      })
    ).toBe(false);
    expect(
      await launchDb.hasPendingStoryboardLaunch(db, {
        ...query,
        workflowRunId: generateId(),
      })
    ).toBe(false);
    await db
      .update(sequences)
      .set({ workflowRunId: generateId() })
      .where(eq(sequences.id, fixture.sequenceId));
    expect(await launchDb.hasPendingStoryboardLaunch(db, query)).toBe(false);
  });

  it('excludes an outbox row whose organization disagrees with its sequence', async () => {
    const other = await seedOwner();
    await addLaunch({ ...fixture, organizationId: other.organizationId });
    expect(
      await launchDb.listPendingStoryboardLaunches(db, MAX_LAUNCHES)
    ).toEqual([]);
  });

  it('deletes sequence launches in the parent batch and preserves another organization', async () => {
    const ownLaunch = await addLaunch();
    const other = await seedOwner();
    const otherLaunch = await addLaunch(other);
    await db.batch([
      launchDb.deleteStoryboardLaunchesForSequences(
        db,
        eq(sequences.id, fixture.sequenceId)
      ),
      db.delete(sequences).where(eq(sequences.id, fixture.sequenceId)),
    ]);
    expect(await readLaunch(ownLaunch.id)).toBeUndefined();
    expect(await readOwner()).toBeUndefined();
    expect(await readLaunch(otherLaunch.id)).toBeDefined();
  });

  it('rolls back launch cleanup when the parent delete batch fails', async () => {
    const launch = await addLaunch();
    await expect(
      db.batch([
        launchDb.deleteStoryboardLaunchesForSequences(
          db,
          eq(sequences.id, fixture.sequenceId)
        ),
        db.delete(sequences).where(eq(sequences.id, fixture.sequenceId)),
        db.insert(organization).values({
          id: fixture.organizationId,
          name: 'Synthetic duplicate to fail the batch',
          slug: fixture.organizationId,
        }),
      ])
    ).rejects.toThrow();
    expect((await readOwner())?.workflowRunId).toBe(fixture.workflowRunId);
    expect(await readLaunch(launch.id)).toEqual(launch);
    await reconcileLaunches();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(launch.prepared);
    expect((await readLaunch(launch.id))?.submittedAt).toBeInstanceOf(Date);
  });

  it('allows production organization deletion, hides its orphan and then removes it', async () => {
    const ownLaunch = await addLaunch();
    const other = await seedOwner();
    const otherLaunch = await addLaunch(other);
    await db
      .delete(organization)
      .where(eq(organization.id, fixture.organizationId));
    expect(await readOwner()).toBeUndefined();
    expect(await readLaunch(ownLaunch.id)).toEqual(ownLaunch);
    expect(
      await launchDb.hasPendingStoryboardLaunch(db, {
        id: fixture.sequenceId,
        organizationId: fixture.organizationId,
        workflowRunId: fixture.workflowRunId,
      })
    ).toBe(false);
    expect(
      (await launchDb.listPendingStoryboardLaunches(db, MAX_LAUNCHES)).map(
        (launch) => launch.id
      )
    ).toEqual([otherLaunch.id]);
    expect(await launchDb.markStoryboardLaunchAttempt(db, ownLaunch)).toBe(
      false
    );
    expect(await launchDb.confirmStoryboardLaunchSubmitted(db, ownLaunch)).toBe(
      false
    );
    await reconcileLaunches();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(otherLaunch.prepared);
    expect(await readLaunch(ownLaunch.id)).toBeUndefined();
    expect((await readLaunch(otherLaunch.id))?.submittedAt).toBeInstanceOf(
      Date
    );
    expect(await readOwner(other)).toBeDefined();
  });

  it('caps orphan cleanup and also removes logs whose sequence alone was deleted', async () => {
    const first = await addLaunch();
    const other = await seedOwner();
    const second = await addLaunch(other, new Date());
    await db.batch([
      db.delete(sequences).where(eq(sequences.id, fixture.sequenceId)),
      db.delete(sequences).where(eq(sequences.id, other.sequenceId)),
    ]);
    expect(
      await launchDb.listPendingStoryboardLaunches(db, MAX_LAUNCHES)
    ).toEqual([]);
    expect(await launchDb.markStoryboardLaunchAttempt(db, first)).toBe(false);
    expect(await launchDb.confirmStoryboardLaunchSubmitted(db, first)).toBe(
      false
    );
    expect(await launchDb.deleteOrphanedStoryboardLaunches(db, 1)).toBe(1);
    const remaining = [
      await readLaunch(first.id),
      await readLaunch(second.id),
    ].filter(Boolean);
    expect(remaining).toHaveLength(1);
    expect(await launchDb.deleteOrphanedStoryboardLaunches(db, 1)).toBe(1);
    expect(await launchDb.deleteOrphanedStoryboardLaunches(db, 1)).toBe(0);
  });
});
