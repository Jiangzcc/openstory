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
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { sequences } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createSequencesMethods } from './sequences';
import { STORYBOARD_WORKFLOW_STATUS } from './storyboard-owner';
import type { StoryboardOwner } from './storyboard-owner';
import {
  COUNT,
  LOSS_CASES,
  OWNER_MODES,
  POSTER,
  PUBLISHED_AT,
  REPLAYED_AT,
  REPLACEMENT_RUN,
  SQL_FAULT,
  beforePosterSql,
  failPosterSql,
  failureFrom,
  posterOwner,
  posterSequence,
  posterSnapshot,
  seedPosterGraph,
  setRoot,
} from './storyboard-poster.test.fixture';
import type { Graph } from './storyboard-poster.test.fixture';

// Migrated SQLite through the real Drizzle D1 driver; no workflow engine is mocked.
let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  graph = await seedPosterGraph(db);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PUBLISHED_AT);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT.trigger));
});

function methods(organizationId = graph.organizationId) {
  return createSequencesMethods(db, organizationId, graph.userId);
}

function write(
  owner: StoryboardOwner = posterOwner(graph),
  organizationId = graph.organizationId,
  posterUrl: string = POSTER.published
) {
  return methods(organizationId).setPosterIfCurrent({ ...owner, posterUrl });
}

async function activeOwner(rawClaim: boolean) {
  if (rawClaim) await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  return posterOwner(graph, rawClaim);
}

async function expectRefused(
  owner: StoryboardOwner = posterOwner(graph),
  organizationId = graph.organizationId
) {
  const before = await posterSnapshot(db);
  expect(await write(owner, organizationId)).toBe(false);
  expect(await posterSnapshot(db)).toEqual(before);
}

it.each(OWNER_MODES)(
  'publishes only poster and timestamp for the $name in one UPDATE RETURNING',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    const sibling = await seedPosterGraph(db, graph);
    await setRoot(db, sibling, {
      workflowRunId: rawClaim ? graph.rawClaimId : graph.workflowRunId,
    });
    const before = await posterSnapshot(db);
    const prepare = vi.spyOn(db.$client, 'prepare');
    const batch = vi.spyOn(db.$client, 'batch');
    expect(await write(owner)).toBe(true);
    const queries = prepare.mock.calls.map(([query]) => query);
    expect(queries).toHaveLength(COUNT.one);
    expect(queries.at(COUNT.none)).toMatch(/^update "sequences" set\b/i);
    expect(queries.at(COUNT.none)).toMatch(/returning "id"$/i);
    expect(batch).not.toHaveBeenCalled();
    expect(await posterSnapshot(db)).toEqual({
      rows: before.rows.map((row) =>
        row.id === graph.sequenceId
          ? { ...row, posterUrl: POSTER.published, updatedAt: PUBLISHED_AT }
          : row
      ),
      changes: before.changes + COUNT.one,
    });
  }
);

it('accepts the current run even when the optional claim differs', async () => {
  expect(
    await write({ ...posterOwner(graph), workflowClaimId: generateId() })
  ).toBe(true);
  expect((await posterSequence(db, graph)).posterUrl).toBe(POSTER.published);
});

it.each([
  { name: 'omitted', claim: undefined },
  { name: 'empty', claim: '' },
  { name: 'unrelated', claim: REPLACEMENT_RUN },
])(
  'rejects a raw claim when its explicit claim is $name',
  async ({ claim }) => {
    await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    await expectRefused({ ...posterOwner(graph), workflowClaimId: claim });
  }
);

it('does not infer a raw claim from a workflow instance prefix', async () => {
  await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  await expectRefused();
});

it.each(LOSS_CASES)(
  'rejects $name after $loss without any writes',
  async ({ rawClaim, state }) => {
    const owner = await activeOwner(rawClaim);
    await setRoot(db, graph, state);
    await expectRefused(owner);
  }
);

it.each(OWNER_MODES)(
  'rejects the $name from another organization',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    const other = await seedPosterGraph(db);
    await expectRefused(owner, other.organizationId);
  }
);

it.each(OWNER_MODES)(
  'rejects a missing sequence for the $name',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    await expectRefused({ ...owner, id: generateId() });
  }
);

it.each(OWNER_MODES)(
  'does not recreate a deleted sequence for the $name',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    await db.delete(sequences).where(eq(sequences.id, graph.sequenceId));
    await expectRefused(owner);
  }
);

it('replays publication across raw-claim to workflow-run promotion', async () => {
  const owner = await activeOwner(true);
  expect(await write(owner)).toBe(true);
  await setRoot(db, graph, { workflowRunId: graph.workflowRunId });
  const before = await posterSnapshot(db);
  vi.setSystemTime(REPLAYED_AT);
  expect(await write(owner)).toBe(true);
  expect(await posterSnapshot(db)).toEqual({
    rows: before.rows.map((row) =>
      row.id === graph.sequenceId ? { ...row, updatedAt: REPLAYED_AT } : row
    ),
    changes: before.changes + COUNT.one,
  });
});

it.each(LOSS_CASES)(
  'refuses a publication replay for $name after $loss',
  async ({ rawClaim, state }) => {
    const owner = await activeOwner(rawClaim);
    expect(await write(owner)).toBe(true);
    await setRoot(db, graph, state);
    vi.setSystemTime(REPLAYED_AT);
    await expectRefused(owner);
  }
);

it.each(LOSS_CASES)(
  'checks $name against $loss immediately before actual SQL execution',
  async ({ rawClaim, state }) => {
    const owner = await activeOwner(rawClaim);
    const timing = beforePosterSql(db, () => setRoot(db, graph, state));
    expect(await write(owner)).toBe(false);
    expect(timing.fired).toBe(true);
    expect(timing.query).toMatch(/returning "id"$/i);
    expect(timing.expected).toBeDefined();
    expect(await posterSnapshot(db)).toEqual(timing.expected);
  }
);

it('accepts a trusted claim promoted immediately before SQL execution', async () => {
  const owner = await activeOwner(true);
  const timing = beforePosterSql(db, () =>
    setRoot(db, graph, { workflowRunId: graph.workflowRunId })
  );
  expect(await write(owner)).toBe(true);
  expect(timing.fired).toBe(true);
  expect(await posterSequence(db, graph)).toMatchObject({
    posterUrl: POSTER.published,
    workflowRunId: graph.workflowRunId,
    updatedAt: PUBLISHED_AT,
  });
});

it.each(OWNER_MODES)(
  'refuses the $name when organization changes immediately before SQL',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    const other = await seedPosterGraph(db);
    const timing = beforePosterSql(db, () =>
      setRoot(db, graph, { organizationId: other.organizationId })
    );
    expect(await write(owner)).toBe(false);
    expect(timing.fired).toBe(true);
    expect(await posterSnapshot(db)).toEqual(timing.expected);
  }
);

it.each(OWNER_MODES)(
  'refuses the $name when its row is deleted immediately before SQL',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    const timing = beforePosterSql(db, () =>
      db.delete(sequences).where(eq(sequences.id, graph.sequenceId))
    );
    expect(await write(owner)).toBe(false);
    expect(timing.fired).toBe(true);
    expect(await posterSnapshot(db)).toEqual(timing.expected);
  }
);

it.each(OWNER_MODES)(
  'propagates a SQL failure for the $name without any writes',
  async ({ rawClaim }) => {
    const owner = await activeOwner(rawClaim);
    await failPosterSql(db);
    const before = await posterSnapshot(db);
    const error = await failureFrom(write(owner));
    expect(error).toHaveProperty('cause.message', SQL_FAULT.message);
    expect(await posterSnapshot(db)).toEqual(before);
  }
);

it('preserves an unavailable execution cause without fallback writes', async () => {
  const fault = new Error('Synthetic unavailable poster execution');
  const before = await posterSnapshot(db);
  const timing = beforePosterSql(db, () => Promise.reject(fault));
  const error = await failureFrom(write());
  expect(timing.fired).toBe(true);
  expect(error).toHaveProperty('cause', fault);
  expect(await posterSnapshot(db)).toEqual(before);
});

it('keeps ordinary sequence update available outside storyboard ownership', async () => {
  await setRoot(db, graph, {
    workflowRunId: REPLACEMENT_RUN,
    status: STORYBOARD_WORKFLOW_STATUS.completed,
  });
  await expectRefused();
  const updated = await methods().update({
    id: graph.sequenceId,
    posterUrl: POSTER.replacement,
  });
  expect(updated.posterUrl).toBe(POSTER.replacement);
  expect(updated.status).toBe(STORYBOARD_WORKFLOW_STATUS.completed);
  expect(updated.workflowRunId).toBe(REPLACEMENT_RUN);
});
