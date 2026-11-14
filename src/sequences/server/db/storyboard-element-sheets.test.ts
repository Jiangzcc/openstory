import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { createElementSheetPublicationMethods } from '@/cast/server/db/element-sheet-publication';
import {
  COUNT,
  ENGINE_ABORT,
  MEDIA,
  MOMENT,
  REPLACEMENT_RUN,
  ROOT_LOSSES,
  SQL_FAULT,
  STATUS,
  afterMutation,
  beforeBatch,
  dropFault,
  elementById,
  elementsSnapshot,
  failOwnershipRead,
  failSql,
  failureFrom,
  ownerFor,
  publicationInput,
  seedElement,
  seedPublicationGraph,
  setRoot,
} from '@/cast/server/db/element-sheet-publication.test.fixture';
import type { Graph } from '@/cast/server/db/element-sheet-publication.test.fixture';
import { ValidationError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { sequenceElements, sequences } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import {
  createStoryboardContentScope,
  StoryboardContentOwnershipError,
  StoryboardContentOwnershipCheckError,
} from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';

let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');

const ACTIVE_ROOTS = [
  { name: 'current root', raw: false, declared: false },
  { name: 'explicit trusted raw claim', raw: true, declared: true },
  { name: 'current root with a trusted claim', raw: false, declared: true },
];
const TARGETS = ['insert', 'placeholder', 'uploaded'] as const;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedPublicationGraph(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dropFault(db);
});

function scoped(organizationId = graph.organizationId) {
  return createScopedDb(organizationId, graph.userId);
}
function bound(owner: StoryboardOwner = ownerFor(graph)) {
  return scoped().storyboardElementSheets(owner);
}

it.each(ACTIVE_ROOTS)('publishes for $name', async ({ raw, declared }) => {
  await setRoot(db, graph, {
    workflowRunId: raw ? graph.rawClaimId : graph.workflowRunId,
  });
  const owner = ownerFor(
    graph,
    declared ? { workflowClaimId: graph.rawClaimId } : {}
  );
  const data = publicationInput(graph);
  const row = await bound(owner).publishGenerated(data);
  expect(row).toMatchObject(data);
  expect(await elementById(db, row.id)).toEqual([row]);
});

it('exposes only publication and the ownership bracket through workflow scoped DB', () => {
  const surface = toWorkflowScopedDb(scoped()).storyboardElementSheets(
    ownerFor(graph)
  );
  expect(Object.keys(surface).sort()).toEqual([
    'publishGenerated',
    'withOwnership',
  ]);
});

it.each(['sibling', 'foreign'] as const)(
  'rejects a supplied %s sequence with ValidationError',
  async (target) => {
    const before = await elementsSnapshot(db);
    const batch = vi.spyOn(db.$client, 'batch');
    await expect(
      bound().publishGenerated(publicationInput(graph[target]))
    ).rejects.toBeInstanceOf(ValidationError);
    expect(batch).not.toHaveBeenCalled();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it('rejects another organization even when root and sequence IDs are supplied correctly', async () => {
  const surface = scoped(graph.foreign.organizationId).storyboardElementSheets(
    ownerFor(graph)
  );
  const before = await elementsSnapshot(db);
  await expect(
    surface.publishGenerated(publicationInput(graph))
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(await elementsSnapshot(db)).toEqual(before);
});

it('rejects a sibling instance and a wrongly declared raw claim', async () => {
  await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  const surface = bound(
    ownerFor(graph, {
      workflowRunId: graph.sibling.workflowRunId,
      workflowClaimId: graph.sibling.rawClaimId,
    })
  );
  await expect(
    surface.publishGenerated(publicationInput(graph))
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
});

it.each(ROOT_LOSSES)(
  'does not enter the batch after $name at precheck',
  async (loss) => {
    const surface = bound();
    await setRoot(db, graph, loss.patch(graph));
    const before = await elementsSnapshot(db);
    const batch = vi.spyOn(db.$client, 'batch');
    await expect(
      surface.publishGenerated(publicationInput(graph))
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(batch).not.toHaveBeenCalled();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

for (const target of TARGETS) {
  it.each(ROOT_LOSSES)(
    `fences ${target} at actual SQL execution against $name`,
    async (loss) => {
      const data = publicationInput(graph);
      if (target !== 'insert')
        await seedElement(db, data, {
          imageUrl: target === 'uploaded' ? MEDIA.uploaded : null,
        });
      const before = await elementsSnapshot(db);
      const batch = beforeBatch(db, () =>
        setRoot(db, graph, loss.patch(graph))
      );
      const error = await failureFrom(() => bound().publishGenerated(data));
      expect(batch).toHaveBeenCalledTimes(COUNT.one);
      expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
      expect(error.cause).toBeInstanceOf(Error);
      expect(await elementsSnapshot(db)).toEqual(before);
    }
  );
}

it.each(TARGETS)(
  'rejects a missing sequence at the %s batch boundary',
  async (target) => {
    const data = publicationInput(graph);
    if (target !== 'insert')
      await seedElement(db, data, {
        imageUrl: target === 'uploaded' ? MEDIA.uploaded : null,
      });
    beforeBatch(db, () =>
      db.delete(sequences).where(eq(sequences.id, graph.sequenceId))
    );
    await expect(bound().publishGenerated(data)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(await elementById(db, data.id)).toEqual([]);
  }
);

it('allows the trusted raw claim to become its actual root before SQL execution', async () => {
  await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  const surface = bound(ownerFor(graph, { workflowClaimId: graph.rawClaimId }));
  beforeBatch(db, () =>
    setRoot(db, graph, { workflowRunId: graph.workflowRunId })
  );
  expect(
    await surface.publishGenerated(publicationInput(graph))
  ).toHaveProperty('sequenceId', graph.sequenceId);
});

it.each(['sibling', 'foreign'] as const)(
  'enforces the owner sequence on %s in the base SQL operation itself',
  async (target) => {
    const scope = createStoryboardContentScope(
      db,
      graph.organizationId,
      ownerFor(graph)
    );
    const writer = createElementSheetPublicationMethods(
      db,
      graph.organizationId,
      scope
    );
    const before = await elementsSnapshot(db);
    await expect(
      writer.publishGenerated(publicationInput(graph[target]))
    ).rejects.toThrow();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it('cannot use prechecks as authority when base SQL sees a stale root', async () => {
  const scope = createStoryboardContentScope(
    db,
    graph.organizationId,
    ownerFor(graph)
  );
  const writer = createElementSheetPublicationMethods(
    db,
    graph.organizationId,
    scope
  );
  const data = publicationInput(graph);
  await seedElement(db, data);
  await setRoot(db, graph, { workflowRunId: REPLACEMENT_RUN });
  const before = await elementsSnapshot(db);
  await expect(writer.publishGenerated(data)).rejects.toThrow();
  expect(await elementsSnapshot(db)).toEqual(before);
});

it.each(['sibling', 'foreign'] as const)(
  'rejects an actual %s element ID without updating our token candidate',
  async (target) => {
    const data = publicationInput(graph);
    await seedElement(db, { ...data, sequenceId: graph[target].sequenceId });
    await seedElement(db, { ...data, id: generateId() });
    const before = await elementsSnapshot(db);
    const error = await failureFrom(() => bound().publishGenerated(data));
    expect(error).not.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it('refuses a target moved to a different sequence at the actual batch boundary', async () => {
  const data = publicationInput(graph);
  await seedElement(db, data);
  beforeBatch(db, () =>
    db
      .update(sequenceElements)
      .set({ sequenceId: graph.foreign.sequenceId })
      .where(eq(sequenceElements.id, data.id))
  );
  await expect(bound().publishGenerated(data)).rejects.toThrow();
  const [row] = await elementById(db, data.id);
  expect(row).toMatchObject({
    sequenceId: graph.foreign.sequenceId,
    imageUrl: null,
  });
});

it('refuses a target deleted after precheck without resurrecting it', async () => {
  const data = publicationInput(graph);
  await seedElement(db, data);
  beforeBatch(db, () =>
    db
      .update(sequenceElements)
      .set({ deletedAt: MOMENT.original })
      .where(eq(sequenceElements.id, data.id))
  );
  await expect(bound().publishGenerated(data)).rejects.toThrow();
  const [row] = await elementById(db, data.id);
  expect(row).toMatchObject({ deletedAt: MOMENT.original, imageUrl: null });
});

it('rolls back a fill and trigger takeover when the final read loses its root', async () => {
  const data = publicationInput(graph);
  await seedElement(db, data);
  await afterMutation(
    db,
    'UPDATE',
    `UPDATE sequences SET workflow_run_id = '${REPLACEMENT_RUN}' WHERE id = NEW.sequence_id`
  );
  const before = await elementsSnapshot(db);
  await expect(bound().publishGenerated(data)).rejects.toThrow();
  expect(await elementsSnapshot(db)).toEqual(before);
  const [root] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, graph.sequenceId));
  expect(root?.workflowRunId).toBe(graph.workflowRunId);
});

it('guards INSERT again when an earlier UPDATE trigger loses root and removes its candidate', async () => {
  const data = publicationInput(graph);
  await seedElement(db, data);
  await failSql(db, 'INSERT');
  await afterMutation(
    db,
    'UPDATE',
    `UPDATE sequences SET workflow_run_id = '${REPLACEMENT_RUN}' WHERE id = NEW.sequence_id; DELETE FROM sequence_elements WHERE id = NEW.id`
  );
  const before = await elementsSnapshot(db);
  const error = await failureFrom(() => bound().publishGenerated(data));
  expect(error.message).not.toContain(SQL_FAULT.message);
  expect(await elementsSnapshot(db)).toEqual(before);
});

it('retains active-owner SQL failure and its real SQLite message', async () => {
  await failSql(db, 'INSERT');
  const error = await failureFrom(() =>
    bound().publishGenerated(publicationInput(graph))
  );
  expect(error).not.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(error.message).toContain(SQL_FAULT.message);
});

it('checks ownership even when publication would return an uploaded no-op', async () => {
  const data = publicationInput(graph);
  const uploaded = await seedElement(db, data, { imageUrl: MEDIA.uploaded });
  const checks = vi.spyOn(db.$client, 'prepare');
  expect(await bound().publishGenerated(data)).toEqual(uploaded);
  expect(
    checks.mock.calls.filter(([query]) =>
      /^select "id" from "sequences" where /i.test(query)
    )
  ).toHaveLength(COUNT.two);
});

it('checks empty bracket results before and after the callback', async () => {
  const surface = bound();
  expect(await surface.withOwnership(async () => [])).toEqual([]);
  await expect(
    surface.withOwnership(async () => {
      await setRoot(db, graph, { status: STATUS.failed });
      return [];
    })
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
});

it('does not invoke a no-op callback for a lost owner', async () => {
  await setRoot(db, graph, { workflowRunId: null });
  const callback = vi.fn(async () => []);
  await expect(bound().withOwnership(callback)).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  expect(callback).not.toHaveBeenCalled();
});

it('preserves callback failure as the cause of confirmed ownership loss', async () => {
  const failure = new Error('Synthetic callback failure');
  const error = await failureFrom(() =>
    bound().withOwnership(async () => {
      await setRoot(db, graph, { workflowRunId: REPLACEMENT_RUN });
      throw failure;
    })
  );
  expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  expect(error.cause).toBe(failure);
});

it('does not replace callback errors while ownership is active', async () => {
  const failure = new Error('Synthetic active-owner failure');
  await expect(
    bound().withOwnership(async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
});

it('propagates unavailable prechecks without executing a batch', async () => {
  const failure = new Error('Synthetic ownership read unavailable');
  failOwnershipRead(db, failure);
  const batch = vi.spyOn(db.$client, 'batch');
  const error = await failureFrom(() =>
    bound().publishGenerated(publicationInput(graph))
  );
  expect(error).toBeInstanceOf(StoryboardContentOwnershipCheckError);
  expect(error.cause).toMatchObject({ cause: failure });
  expect(batch).not.toHaveBeenCalled();
});

it('preserves SQL and ownership-verification failures together', async () => {
  const readFailure = new Error('Synthetic verification unavailable');
  await failSql(db, 'INSERT');
  failOwnershipRead(db, readFailure, COUNT.two);
  const error = await failureFrom(() =>
    bound().publishGenerated(publicationInput(graph))
  );
  expect(error).toBeInstanceOf(StoryboardContentOwnershipCheckError);
  expect(error.cause).toBeInstanceOf(AggregateError);
  if (!(error.cause instanceof AggregateError))
    throw new Error('Expected original failure pair');
  expect(error.cause.errors).toEqual([
    expect.objectContaining({
      message: expect.stringContaining(SQL_FAULT.message),
    }),
    expect.objectContaining({
      cause: expect.objectContaining({ cause: readFailure }),
    }),
  ]);
});

it('preserves engine aborts from the ownership bracket', async () => {
  const abort = new Error(ENGINE_ABORT);
  await expect(
    bound().withOwnership(async () => {
      throw abort;
    })
  ).rejects.toBe(abort);
});

it('propagates a final ownership read failure after a real successful commit', async () => {
  const failure = new Error('Synthetic postcommit ownership read unavailable');
  failOwnershipRead(db, failure, COUNT.two);
  const data = publicationInput(graph);
  await expect(bound().publishGenerated(data)).rejects.toBeInstanceOf(
    StoryboardContentOwnershipCheckError
  );
  const [stored] = await elementById(db, data.id);
  expect(stored).toMatchObject(data);
});
