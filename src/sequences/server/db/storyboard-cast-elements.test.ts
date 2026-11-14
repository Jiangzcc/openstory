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
import { createSequenceElementsMethods } from '@/cast/server/db/sequence-elements';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { sequenceElements } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createStoryboardCastScope } from './storyboard-cast-scope';
import { StoryboardContentOwnershipError } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';
import {
  COUNT,
  FIXTURE_DATE,
  NEXT_DATE,
  ROOT_LOSSES,
  SQL_FAULT,
  SQL_TARGET,
  STATUS,
  ULID_PATTERN,
  castSnapshot,
  elementInput,
  failElementInsert,
  failureFrom,
  interceptSql,
  ownerFor,
  seedCastGraph,
  setRoot,
} from './storyboard-cast.test.fixture';
import type { Graph } from './storyboard-cast.test.fixture';

// Real migrated D1 and factories; transport hooks only choose SQL execution time.
let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');
const KIND = { image: 'image', video: 'video' } as const;
const VISION = { pending: 'pending', completed: 'completed' } as const;
const DURATION_SECONDS = 1.25;
const ACTIVE_ROOTS = [
  { name: 'published root', raw: false, declared: false },
  { name: 'explicit trusted raw claim', raw: true, declared: true },
  { name: 'published root with a declared claim', raw: false, declared: true },
];

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedCastGraph(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT.trigger));
});

function scoped(organizationId = graph.organizationId) {
  return createScopedDb(organizationId, graph.userId);
}
function bound(owner: StoryboardOwner = ownerFor(graph)) {
  return scoped().storyboardCast(owner);
}
function stored(id: string) {
  return db.select().from(sequenceElements).where(eq(sequenceElements.id, id));
}

it.each(ACTIVE_ROOTS)(
  'inserts ELEMENTS for $name',
  async ({ raw, declared }) => {
    await setRoot(db, graph, {
      workflowRunId: raw ? graph.rawClaimId : graph.workflowRunId,
    });
    const owner = {
      ...ownerFor(graph),
      ...(declared ? { workflowClaimId: graph.rawClaimId } : {}),
    };
    const element = await bound(owner).sequenceElements.create(
      elementInput(graph)
    );
    expect(element.id).toMatch(ULID_PATTERN);
    expect(element.sequenceId).toBe(graph.sequenceId);
    expect(await stored(element.id)).toEqual([element]);
  }
);

it.each([true, false])(
  'encodes explicit fields and personInMedia=%s',
  async (personInMedia) => {
    const input = {
      ...elementInput(graph),
      id: generateId(),
      kind: KIND.video,
      durationSeconds: DURATION_SECONDS,
      description: '合成描述："引号"\n第二行；不要执行 SQL。',
      consistencyTag: 'synthetic-tag',
      imageUrl: '/r2/synthetic/参考.mp4',
      imagePath: 'synthetic/参考.mp4',
      personInMedia,
      visionStatus: VISION.completed,
      visionGeneratedAt: FIXTURE_DATE,
      firstMentionSceneId: generateId(),
      firstMentionText: '合成 ELEMENT 首次出现',
      firstMentionLine: COUNT.one,
      createdAt: FIXTURE_DATE,
      updatedAt: NEXT_DATE,
    };
    const element = await bound().sequenceElements.create(input);
    expect(element).toMatchObject(input);
    expect(element.visionError).toBeNull();
    expect(element.deletedAt).toBeNull();
    expect(await stored(element.id)).toEqual([element]);
  }
);

it('keeps schema defaults and generated timestamps in the guarded INSERT', async () => {
  const element = await bound().sequenceElements.create(elementInput(graph));
  expect(element).toMatchObject({
    kind: KIND.image,
    personInMedia: false,
    visionStatus: VISION.pending,
    durationSeconds: null,
    description: null,
    imageUrl: null,
    imagePath: null,
    visionGeneratedAt: null,
    firstMentionSceneId: null,
    firstMentionLine: null,
    deletedAt: null,
  });
  expect(element.id).toMatch(ULID_PATTERN);
  expect(element.createdAt).toBeInstanceOf(Date);
  expect(element.updatedAt).toBeInstanceOf(Date);
  expect(Number.isFinite(element.createdAt.getTime())).toBe(true);
  expect(await stored(element.id)).toEqual([element]);
});

it.each(ROOT_LOSSES)(
  'does not attempt an INSERT for $name at precheck',
  async (loss) => {
    const surface = bound();
    await setRoot(db, graph, loss.patch(graph));
    const before = await castSnapshot(db);
    const prepare = vi.spyOn(db.$client, 'prepare');
    await expect(
      surface.sequenceElements.create(elementInput(graph))
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(
      prepare.mock.calls.some(([query]) => SQL_TARGET.element.test(query))
    ).toBe(false);
    expect(await castSnapshot(db)).toEqual(before);
  }
);

it('rejects a foreign caller organization without changing any row', async () => {
  const surface = scoped(graph.foreign.organizationId).storyboardCast(
    ownerFor(graph)
  );
  const before = await castSnapshot(db);
  await expect(
    surface.sequenceElements.create(elementInput(graph))
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(await castSnapshot(db)).toEqual(before);
});

it('cannot borrow another sequence root instance', async () => {
  const surface = bound({
    ...ownerFor(graph),
    workflowRunId: graph.sibling.workflowRunId,
  });
  const before = await castSnapshot(db);
  await expect(
    surface.sequenceElements.create(elementInput(graph))
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(await castSnapshot(db)).toEqual(before);
});

it('does not trust a raw claim other than the explicitly declared claim', async () => {
  await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  const surface = bound({
    ...ownerFor(graph),
    workflowClaimId: graph.sibling.rawClaimId,
  });
  const before = await castSnapshot(db);
  await expect(
    surface.sequenceElements.create(elementInput(graph))
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(await castSnapshot(db)).toEqual(before);
});

it.each(ROOT_LOSSES)(
  'guards the actual INSERT after precheck against $name',
  async (loss) => {
    const surface = bound();
    let expected: Awaited<ReturnType<typeof castSnapshot>> | undefined;
    const executions = interceptSql(db, SQL_TARGET.element, async () => {
      await setRoot(db, graph, loss.patch(graph));
      expected = await castSnapshot(db);
    });
    const error = await failureFrom(() =>
      surface.sequenceElements.create(elementInput(graph))
    );
    expect(executions()).toBe(COUNT.one);
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
    expect(error.cause).toMatchObject({
      message: 'Failed to insert sequence element',
    });
    expect(expected).toBeDefined();
    expect(await castSnapshot(db)).toEqual(expected);
  }
);

it('allows a declared raw claim to publish its final root before INSERT', async () => {
  await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
  const surface = bound({
    ...ownerFor(graph),
    workflowClaimId: graph.rawClaimId,
  });
  const executions = interceptSql(db, SQL_TARGET.element, async () => {
    await setRoot(db, graph, { workflowRunId: graph.workflowRunId });
  });
  const element = await surface.sequenceElements.create(elementInput(graph));
  expect(executions()).toBe(COUNT.one);
  expect(await stored(element.id)).toEqual([element]);
});

it.each(['sibling', 'foreign'] as const)(
  'protects %s targets in the domain INSERT predicate itself',
  async (target) => {
    const scope = createStoryboardCastScope(
      db,
      graph.organizationId,
      ownerFor(graph)
    );
    const elements = createSequenceElementsMethods(db, scope);
    const before = await castSnapshot(db);
    await expect(elements.create(elementInput(graph[target]))).rejects.toThrow(
      'Failed to insert sequence element'
    );
    expect(await castSnapshot(db)).toEqual(before);
  }
);

it('retains SQLite token uniqueness errors, including soft-deleted elements', async () => {
  await db.insert(sequenceElements).values({
    ...elementInput(graph),
    deletedAt: FIXTURE_DATE,
  });
  const before = await castSnapshot(db);
  const error = await failureFrom(() =>
    bound().sequenceElements.create(elementInput(graph))
  );
  expect(error).not.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(error.cause).toMatchObject({
    message: expect.stringContaining(
      'UNIQUE constraint failed: sequence_elements.sequence_id, sequence_elements.token'
    ),
  });
  expect(await castSnapshot(db)).toEqual(before);
});

it('retains the real SQLite abort cause when INSERT fails for an active owner', async () => {
  await failElementInsert(db);
  const before = await castSnapshot(db);
  const error = await failureFrom(() =>
    bound().sequenceElements.create(elementInput(graph))
  );
  expect(error).not.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(error.cause).toMatchObject({ message: SQL_FAULT.message });
  expect(await castSnapshot(db)).toEqual(before);
});

it('keeps ordinary unbound element creation independent of Storyboard status', async () => {
  await setRoot(db, graph, { status: STATUS.failed });
  const element = await scoped().sequenceElements.create(elementInput(graph));
  expect(await stored(element.id)).toEqual([element]);
});
