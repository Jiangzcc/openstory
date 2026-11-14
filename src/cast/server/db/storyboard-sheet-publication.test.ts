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
import {
  sequenceCast,
  sequenceLocationLinks,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createStoryboardReferenceSheetsMethods } from '@/sequences/server/db/storyboard-reference-sheets';
import {
  ROOT_LOSSES,
  ownerFor,
  setRoot,
  STATUS,
} from '@/sequences/server/db/storyboard-cast.test.fixture';
import {
  COUNT,
  FAULT,
  KINDS,
  MEDIA,
  STATE,
  TABLE,
  beforeBatch,
  dropTriggers,
  errorChain,
  events,
  failureFrom,
  publish,
  scopeFor,
  seedSheetGraph,
  setClaim,
  sheetInput,
  snapshot,
  state,
  trigger,
  versions,
} from './storyboard-sheet-publication.test.fixture';
import type { Graph, Kind } from './storyboard-sheet-publication.test.fixture';

let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedSheetGraph(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dropTriggers(db);
});

const bound = () =>
  createStoryboardReferenceSheetsMethods(
    db,
    graph.organizationId,
    ownerFor(graph)
  );

function boundPublish(kind: Kind, input = sheetInput(graph)) {
  const writer = bound();
  return kind === 'character'
    ? writer.characterSheetVariants.promoteIfPending(input.character)
    : writer.locationSheetVariants.promoteIfPending(input.location);
}

it.each(KINDS)(
  'atomically publishes a %s sheet and keeps retries idempotent',
  async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    expect(await boundPublish(kind, input)).toBe('promoted');
    expect(await state(db, kind, graph.target)).toEqual({
      selected: input[kind].versionId,
      claim: null,
      status: STATE.completed,
      error: null,
    });
    const landed = await snapshot(db);
    expect(await boundPublish(kind, input)).toBe('promoted');
    expect(await snapshot(db)).toEqual(landed);
    expect(await events(db, graph)).toHaveLength(COUNT.one);
    expect(await versions(db, kind)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: input[kind].versionId,
          ...MEDIA,
          divergedAt: null,
        }),
      ])
    );
  }
);

it.each(KINDS)(
  'parks an old %s result without clearing the newer claim',
  async (kind) => {
    const input = sheetInput(graph);
    const newer = generateId();
    await setClaim(db, kind, graph.target, newer);
    expect(await boundPublish(kind, input)).toBe('parked');
    expect(await state(db, kind, graph.target)).toEqual({
      selected: null,
      claim: newer,
      status: STATE.generating,
      error: FAULT,
    });
    expect(await versions(db, kind)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: input[kind].versionId,
          divergedAt: expect.any(Date),
        }),
      ])
    );
  }
);

it.each(KINDS)(
  'allows an attached shared %s reference through its live link',
  async (kind) => {
    if (kind === 'character') {
      await db
        .update(sequenceCast)
        .set({ attached: true })
        .where(eq(sequenceCast.characterId, graph.target.characterId));
    } else {
      await db
        .update(sequenceLocationLinks)
        .set({ attached: true })
        .where(eq(sequenceLocationLinks.locationId, graph.target.locationId));
    }
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    expect(await boundPublish(kind, input)).toBe('promoted');
  }
);

for (const loss of ROOT_LOSSES) {
  it.each(KINDS)(`refuses %s publication after ${loss.name}`, async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    await setRoot(db, graph, loss.patch(graph));
    const before = await snapshot(db);
    await expect(boundPublish(kind, input)).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });
}

it.each(KINDS)(
  'blocks a %s root takeover immediately before the publication batch',
  async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    let before = await snapshot(db);
    beforeBatch(db, async () => {
      await setRoot(db, graph, { workflowRunId: generateId() });
      before = await snapshot(db);
    });
    await expect(boundPublish(kind, input)).rejects.toThrow(
      'Storyboard no longer owns sequence content'
    );
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(KINDS)(
  'rolls back every %s write when ownership changes inside its D1 batch',
  async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    const before = await snapshot(db);
    await trigger(
      db,
      0,
      `AFTER INSERT ON ${TABLE[kind].version}`,
      `UPDATE sequences SET status = '${STATE.failed}' WHERE id = '${graph.sequenceId}'`
    );
    await expect(boundPublish(kind, input)).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
    await expect(scopeFor(db, graph).assert()).resolves.toBeUndefined();
  }
);

it.each(KINDS)(
  'rolls back a %s version, pointer and event when the pointer write fails',
  async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    const before = await snapshot(db);
    await trigger(
      db,
      2,
      `BEFORE UPDATE OF ${TABLE[kind].pointer} ON ${TABLE[kind].parent}`,
      `SELECT RAISE(ABORT, '${FAULT}')`
    );
    const error = await failureFrom(() => boundPublish(kind, input));
    expect(errorChain(error)).toContain(FAULT);
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(KINDS)(
  'rejects an unlinked, sibling or foreign %s target without any mutation',
  async (kind) => {
    for (const target of [
      graph.unlinked,
      graph.siblingTarget,
      graph.foreignTarget,
    ]) {
      const input = sheetInput(graph, target);
      await setClaim(db, kind, target, input[kind].versionId);
      const before = await snapshot(db);
      await expect(boundPublish(kind, input)).rejects.toThrow();
      expect(await snapshot(db)).toEqual(before);
    }
  }
);

it.each(KINDS)(
  'rejects a removed %s link and preserves its outstanding claim',
  async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    if (kind === 'character') {
      await db
        .update(sequenceCast)
        .set({ removedAt: new Date() })
        .where(eq(sequenceCast.characterId, graph.target.characterId));
    } else {
      await db
        .update(sequenceLocationLinks)
        .set({ removedAt: new Date() })
        .where(eq(sequenceLocationLinks.locationId, graph.target.locationId));
    }
    const before = await snapshot(db);
    await expect(boundPublish(kind, input)).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(KINDS)(
  'refuses a %s version id belonging to another parent',
  async (kind) => {
    const other = sheetInput(graph, graph.other);
    await setClaim(db, kind, graph.other, other[kind].versionId);
    expect(await boundPublish(kind, other)).toBe('promoted');
    const input = sheetInput(graph);
    input[kind].versionId = other[kind].versionId;
    await setClaim(db, kind, graph.target, input[kind].versionId);
    const before = await snapshot(db);
    await expect(boundPublish(kind, input)).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  }
);

it('refuses a character/look mismatch and an activity outside the originating sequence', async () => {
  const input = sheetInput(graph);
  input.character.characterId = graph.other.characterId;
  const before = await snapshot(db);
  await expect(boundPublish('character', input)).rejects.toThrow();
  expect(await snapshot(db)).toEqual(before);
  input.location.activity.sequenceId = graph.sibling.sequenceId;
  await expect(boundPublish('location', input)).rejects.toThrow(
    'Sheet activity is outside the Storyboard sequence'
  );
  expect(await snapshot(db)).toEqual(before);
});

it.each(KINDS)(
  'retains standalone %s publication when the sequence is already completed',
  async (kind) => {
    const input = sheetInput(graph);
    await setClaim(db, kind, graph.target, input[kind].versionId);
    await setRoot(db, graph, { status: STATUS.completed });
    expect(await publish(db, graph, kind, input)).toBe('promoted');
  }
);

it.each(KINDS)(
  'rejects a %s activity target mismatch within the atomic landing batch',
  async (kind) => {
    const input = sheetInput(graph);
    input[kind].activity.targetId = generateId();
    await setClaim(db, kind, graph.target, input[kind].versionId);
    const before = await snapshot(db);
    await expect(boundPublish(kind, input)).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  }
);

it('keeps the explicit raw workflow claim alias while refusing an undeclared alias', async () => {
  await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  const input = sheetInput(graph);
  await setClaim(db, 'character', graph.target, input.character.versionId);
  await expect(
    publish(
      db,
      graph,
      'character',
      input,
      scopeFor(db, graph, {
        workflowClaimId: graph.rawClaimId,
      })
    )
  ).resolves.toBe('promoted');
  expect(
    await db.get<{ status: string }>(
      sql`select status from sequences where id = ${graph.sequenceId}`
    )
  ).toEqual({ status: STATUS.processing });
});
