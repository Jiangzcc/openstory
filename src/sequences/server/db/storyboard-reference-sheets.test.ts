import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { characters } from '@/platform/server/db/schema';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { createTestDb } from '@/platform/server/db/test-d1';
import { bindReferenceSheetOutput } from '@/cast/server/workflows/reference-sheet-output';
import {
  COUNT,
  FAULT,
  KINDS,
  STATE,
  seedSheetGraph,
  setClaim,
  snapshot,
  state,
} from '@/cast/server/db/storyboard-sheet-publication.test.fixture';
import type {
  Graph,
  Kind,
} from '@/cast/server/db/storyboard-sheet-publication.test.fixture';
import { ownerFor, setRoot, STATUS } from './storyboard-cast.test.fixture';
import { createStoryboardReferenceSheetsMethods } from './storyboard-reference-sheets';

let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedSheetGraph(db);
});

const bound = () =>
  createStoryboardReferenceSheetsMethods(
    db,
    graph.organizationId,
    ownerFor(graph)
  );

async function takeClaim(kind: Kind) {
  const activity = {
    sequenceId: graph.sequenceId,
    actorId: null,
    summary: 'Synthetic claim',
  };
  if (kind === 'location') {
    return bound().locations.claimReference(graph.target.locationId, {
      markGenerating: true,
      activity,
    });
  }
  const [row] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, graph.target.characterId));
  if (!row) throw new Error('Missing synthetic character');
  const claim = await bound().characterLooks.claimSheet(
    graph.target.lookId,
    {
      lookVersionId: graph.target.lookVersionId,
      bibleVersionId: row.selectedBibleVersionId,
    },
    { markGenerating: true, activity }
  );
  expect(claim.held).toBe(true);
  return claim.versionId;
}

function failClaim(
  kind: Kind,
  versionId: string | null,
  organizationId = graph.organizationId
) {
  const writer = createStoryboardReferenceSheetsMethods(
    db,
    organizationId,
    ownerFor(graph)
  );
  return kind === 'character'
    ? writer.characterLooks.failSheetClaim(
        graph.target.lookId,
        versionId,
        FAULT
      )
    : writer.locations.failReferenceClaim(
        graph.target.locationId,
        versionId,
        FAULT
      );
}

it.each(KINDS)(
  'takes a %s claim through the active trusted root',
  async (kind) => {
    const versionId = await takeClaim(kind);
    expect(await state(db, kind, graph.target)).toMatchObject({
      claim: versionId,
      status: STATE.generating,
      error: null,
    });
  }
);

it.each(KINDS)(
  'refuses a %s claim after root replacement without writing a start event',
  async (kind) => {
    await setRoot(db, graph, { workflowRunId: generateId() });
    const before = await snapshot(db);
    await expect(takeClaim(kind)).rejects.toThrow(
      'Storyboard no longer owns sequence content'
    );
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(KINDS)(
  'cleans only its own %s claim after the root completes',
  async (kind) => {
    const versionId = await takeClaim(kind);
    await setRoot(db, graph, { status: STATUS.completed });
    await failClaim(kind, versionId);
    expect(await state(db, kind, graph.target)).toMatchObject({
      claim: null,
      status: STATE.failed,
      error: FAULT,
    });
  }
);

it.each(KINDS)(
  'preserves a newer %s claim when the old run fails',
  async (kind) => {
    const versionId = await takeClaim(kind);
    const newer = generateId();
    await setClaim(db, kind, graph.target, newer);
    const before = await snapshot(db);
    await failClaim(kind, versionId);
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(KINDS)(
  'does not turn a demoted %s claim or missing legacy id into a failed sheet',
  async (kind) => {
    const versionId = await takeClaim(kind);
    await setClaim(db, kind, graph.target, null);
    const before = await snapshot(db);
    await failClaim(kind, versionId);
    await failClaim(kind, null);
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(KINDS)('keeps %s failure cleanup organization scoped', async (kind) => {
  const versionId = await takeClaim(kind);
  const before = await snapshot(db);
  await failClaim(kind, versionId, graph.foreign.organizationId);
  expect(await snapshot(db)).toEqual(before);
});

it('keeps a changed character snapshot unclaimed without inventing a start event', async () => {
  const before = await snapshot(db);
  const result = await bound().characterLooks.claimSheet(
    graph.target.lookId,
    {
      lookVersionId: generateId(),
      bibleVersionId: generateId(),
    },
    {
      markGenerating: true,
      activity: {
        sequenceId: graph.sequenceId,
        actorId: null,
        summary: 'Synthetic stale snapshot',
      },
    }
  );
  expect(result.held).toBe(false);
  expect(await snapshot(db)).toEqual(before);
});

it('binds explicit and direct-parent root identity through the real WorkflowScopedDb factory', async () => {
  const workflow = toWorkflowScopedDb(
    createScopedDb(graph.organizationId, graph.userId)
  );
  const capture = vi.spyOn(workflow, 'storyboardReferenceSheets');
  const explicit = {
    workflowRunId: graph.workflowRunId,
    workflowClaimId: graph.rawClaimId,
  };
  bindReferenceSheetOutput(workflow, {
    sequenceId: graph.sequenceId,
    storyboardOwner: explicit,
  });
  expect(capture).toHaveBeenLastCalledWith({
    id: graph.sequenceId,
    ...explicit,
  });
  bindReferenceSheetOutput(workflow, {
    sequenceId: graph.sequenceId,
    _parent: {
      bindingName: 'STORYBOARD_WORKFLOW',
      parentInstanceId: graph.workflowRunId,
      eventType: 'synthetic-result',
    },
  });
  expect(capture).toHaveBeenLastCalledWith(ownerFor(graph));
  expect(capture).toHaveBeenCalledTimes(COUNT.two);
});

it('keeps a standalone sheet unbound and rejects a root without its sequence', () => {
  const workflow = toWorkflowScopedDb(
    createScopedDb(graph.organizationId, graph.userId)
  );
  const capture = vi.spyOn(workflow, 'storyboardReferenceSheets');
  bindReferenceSheetOutput(workflow, { sequenceId: null });
  expect(capture).not.toHaveBeenCalled();
  expect(() =>
    bindReferenceSheetOutput(workflow, {
      sequenceId: null,
      storyboardOwner: { workflowRunId: graph.workflowRunId },
    })
  ).toThrow('A Storyboard sheet requires its sequence');
});
