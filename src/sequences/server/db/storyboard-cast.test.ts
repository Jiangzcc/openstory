import { sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { ValidationError } from '@/platform/errors';
import type { Database } from '@/platform/server/db/client';
import { sequenceElements } from '@/platform/server/db/schema';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  StoryboardContentOwnershipCheckError,
  StoryboardContentOwnershipError,
} from './storyboard-content-scope';
import {
  COUNT,
  ENGINE_ABORT,
  REPLACEMENT_RUN,
  SOURCE,
  SQL_FAULT,
  SQL_TARGET,
  TARGET_ERROR,
  analysedLook,
  castSnapshot,
  characterInput,
  elementInput,
  failElementInsert,
  failureFrom,
  interceptSql,
  locationInput,
  ownerFor,
  seedCastGraph,
  seedParents,
  setRoot,
} from './storyboard-cast.test.fixture';
import type { Cast, Graph, Parents } from './storyboard-cast.test.fixture';

// Only getDb is mocked; both composition factories and all domain methods are real.
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
  graph = await seedCastGraph(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT.trigger));
});

function scoped() {
  return createScopedDb(graph.organizationId, graph.userId);
}
function bound() {
  return scoped().storyboardCast(ownerFor(graph));
}
function replaceRoot() {
  return setRoot(db, graph, { workflowRunId: REPLACEMENT_RUN });
}

type TargetRoot = Graph['sibling'];
type Method = {
  name: string;
  write: (cast: Cast, target: TargetRoot, parent: Parents) => Promise<unknown>;
};
const METHODS: Method[] = [
  {
    name: 'characters.create',
    write: (cast, target, parent) =>
      cast.characters.create(characterInput(target, parent), SOURCE),
  },
  {
    name: 'characterLooks.syncFromAnalysis',
    write: (cast, target, parent) =>
      cast.characterLooks.syncFromAnalysis(
        target.sequenceId,
        parent.characterId,
        [analysedLook(parent)]
      ),
  },
  {
    name: 'characterLooks.linkFromAnalysis',
    write: (cast, target, parent) =>
      cast.characterLooks.linkFromAnalysis(
        target.sequenceId,
        parent.characterId,
        [analysedLook(parent)]
      ),
  },
  {
    name: 'locations.createBulk',
    write: (cast, target, parent) =>
      cast.locations.createBulk(
        [locationInput(graph, parent), locationInput(target, parent)],
        SOURCE
      ),
  },
  {
    name: 'sequenceElements.create',
    write: (cast, target) => cast.sequenceElements.create(elementInput(target)),
  },
];
const BAD_TARGETS = ['sibling', 'foreign'] as const;
const CROSS_SEQUENCE_CASES = METHODS.flatMap((method) =>
  BAD_TARGETS.map((target) => ({ ...method, target }))
);

it.each(CROSS_SEQUENCE_CASES)(
  'rejects $name targeting $target before any domain query or mutation',
  async ({ write, target }) => {
    const root = graph[target];
    const parent = await seedParents(db, root);
    const surface = bound();
    const before = await castSnapshot(db);
    const prepare = vi.spyOn(db.$client, 'prepare');
    const error = await failureFrom(() => write(surface, root, parent));
    const queries = prepare.mock.calls.map(([query]) => query);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe(TARGET_ERROR);
    expect(queries).toHaveLength(COUNT.checks);
    expect(queries.every((query) => SQL_TARGET.ownership.test(query))).toBe(
      true
    );
    expect(await castSnapshot(db)).toEqual(before);
  }
);

it('keeps the narrow facade on the actual workflow composition', async () => {
  const workflow = toWorkflowScopedDb(scoped());
  const surface = workflow.storyboardCast(ownerFor(graph));
  expect(Object.keys(surface).sort()).toEqual([
    'characterLooks',
    'characters',
    'locations',
    'sequenceElements',
    'withOwnership',
  ]);
  expect(Object.keys(surface.characters)).toEqual(['create']);
  expect(Object.keys(surface.characterLooks).sort()).toEqual([
    'linkFromAnalysis',
    'syncFromAnalysis',
  ]);
  expect(Object.keys(surface.locations)).toEqual(['createBulk']);
  expect(Object.keys(surface.sequenceElements)).toEqual(['create']);
  const element = await surface.sequenceElements.create(elementInput(graph));
  expect(await db.select().from(sequenceElements)).toContainEqual(element);
});

it('checks both sides of an empty location bulk without changing any row', async () => {
  const surface = bound();
  const before = await castSnapshot(db);
  const reads = interceptSql(db, SQL_TARGET.ownership, async () => {});
  await expect(surface.locations.createBulk([], SOURCE)).resolves.toEqual([]);
  expect(reads()).toBe(COUNT.checks);
  expect(await castSnapshot(db)).toEqual(before);
});

it('rejects empty bulk when the root changes after precheck', async () => {
  const surface = bound();
  let expected: Awaited<ReturnType<typeof castSnapshot>> | undefined;
  const reads = interceptSql(
    db,
    SQL_TARGET.ownership,
    async () => {
      await replaceRoot();
      expected = await castSnapshot(db);
    },
    COUNT.checks
  );
  await expect(surface.locations.createBulk([], SOURCE)).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  expect(reads()).toBe(COUNT.checks);
  expect(expected).toBeDefined();
  expect(await castSnapshot(db)).toEqual(expected);
});

it('rechecks a reused look mapping without adding versions or links', async () => {
  const parent = await seedParents(db, graph);
  const surface = bound();
  const before = await castSnapshot(db);
  const reads = interceptSql(db, SQL_TARGET.ownership, async () => {});
  const result = await surface.characterLooks.linkFromAnalysis(
    graph.sequenceId,
    parent.characterId,
    [analysedLook(parent)]
  );
  expect(result).toEqual({ [parent.lookId]: parent.lookId });
  expect(reads()).toBe(COUNT.checks);
  expect(await castSnapshot(db)).toEqual(before);
});

it('rejects a reused look mapping if its postcheck loses ownership', async () => {
  const parent = await seedParents(db, graph);
  const surface = bound();
  let expected: Awaited<ReturnType<typeof castSnapshot>> | undefined;
  interceptSql(
    db,
    SQL_TARGET.ownership,
    async () => {
      await replaceRoot();
      expected = await castSnapshot(db);
    },
    COUNT.checks
  );
  await expect(
    surface.characterLooks.linkFromAnalysis(
      graph.sequenceId,
      parent.characterId,
      [analysedLook(parent)]
    )
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(expected).toBeDefined();
  expect(await castSnapshot(db)).toEqual(expected);
});

it('does not invoke withOwnership callbacks for a stale root', async () => {
  const surface = bound();
  await replaceRoot();
  const before = await castSnapshot(db);
  const callback = vi.fn(async () => ({ reused: true }));
  await expect(surface.withOwnership(callback)).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  expect(callback).not.toHaveBeenCalled();
  expect(await castSnapshot(db)).toEqual(before);
});

it('returns the identical typed callback result after both ownership checks', async () => {
  const result = { reused: true, ids: [graph.sequenceId] };
  const reads = interceptSql(db, SQL_TARGET.ownership, async () => {});
  const actual = await bound().withOwnership(async () => result);
  expect(actual).toBe(result);
  expect(actual.ids).toEqual([graph.sequenceId]);
  expect(reads()).toBe(COUNT.checks);
});

it('checks ownership after a callback that reused data without SQL', async () => {
  const surface = bound();
  const reused = { ids: [graph.sequenceId] };
  let expected: Awaited<ReturnType<typeof castSnapshot>> | undefined;
  await expect(
    surface.withOwnership(async () => {
      await replaceRoot();
      expected = await castSnapshot(db);
      return reused;
    })
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(expected).toBeDefined();
  expect(await castSnapshot(db)).toEqual(expected);
});

it('retains the callback error by identity while ownership still holds', async () => {
  const failure = new Error('Synthetic reuse callback failure');
  const reads = interceptSql(db, SQL_TARGET.ownership, async () => {});
  await expect(
    bound().withOwnership(async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  expect(reads()).toBe(COUNT.checks);
});

it('keeps a real SQL failure unchanged after a successful catch recheck', async () => {
  const surface = bound();
  await failElementInsert(db);
  const before = await castSnapshot(db);
  let original: Error | undefined;
  const error = await failureFrom(() =>
    surface.withOwnership(async () => {
      original = await failureFrom(async () => {
        await db.insert(sequenceElements).values(elementInput(graph));
      });
      throw original;
    })
  );
  expect(original).toBeDefined();
  expect(error).toBe(original);
  expect(error.cause).toMatchObject({ message: SQL_FAULT.message });
  expect(await castSnapshot(db)).toEqual(before);
});

it('classifies SQL failure after root replacement and retains the original cause', async () => {
  const surface = bound();
  await failElementInsert(db);
  let original: Error | undefined;
  let expected: Awaited<ReturnType<typeof castSnapshot>> | undefined;
  const error = await failureFrom(() =>
    surface.withOwnership(async () => {
      original = await failureFrom(async () => {
        await db.insert(sequenceElements).values(elementInput(graph));
      });
      await replaceRoot();
      expected = await castSnapshot(db);
      throw original;
    })
  );
  expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  expect(error.cause).toBe(original);
  expect(original?.cause).toMatchObject({ message: SQL_FAULT.message });
  expect(expected).toBeDefined();
  expect(await castSnapshot(db)).toEqual(expected);
});

it('retains both callback and unavailable catch-recheck SQL errors', async () => {
  const failure = new Error('Synthetic callback failure');
  const readFailure = new Error('Synthetic D1 transport unavailable');
  const reads = interceptSql(
    db,
    SQL_TARGET.ownership,
    async () => {
      throw readFailure;
    },
    COUNT.checks
  );
  const error = await failureFrom(() =>
    bound().withOwnership(async () => {
      throw failure;
    })
  );
  expect(error).toBeInstanceOf(StoryboardContentOwnershipCheckError);
  expect(error.cause).toBeInstanceOf(AggregateError);
  if (!(error.cause instanceof AggregateError)) {
    throw new Error(
      'Expected the callback and ownership SQL failure aggregate'
    );
  }
  expect(error.cause.errors).toEqual([
    failure,
    expect.objectContaining({
      name: 'StoryboardContentOwnershipCheckError',
      cause: expect.objectContaining({ cause: readFailure }),
    }),
  ]);
  expect(reads()).toBe(COUNT.checks);
});

it.each([
  { name: 'precheck', ordinal: COUNT.one, called: false },
  { name: 'postcheck', ordinal: COUNT.checks, called: true },
])('preserves unavailable $name SQL causes', async ({ ordinal, called }) => {
  const failure = new Error('Synthetic ownership SQL unavailable');
  const before = await castSnapshot(db);
  const callback = vi.fn(async () => ({ reused: true }));
  interceptSql(
    db,
    SQL_TARGET.ownership,
    async () => {
      throw failure;
    },
    ordinal
  );
  const error = await failureFrom(() => bound().withOwnership(callback));
  expect(error).toBeInstanceOf(StoryboardContentOwnershipCheckError);
  expect(error.cause).toMatchObject({ cause: failure });
  expect(callback).toHaveBeenCalledTimes(called ? COUNT.one : COUNT.none);
  expect(await castSnapshot(db)).toEqual(before);
});

it('preserves callback engine abort without a catch recheck after root replacement', async () => {
  const surface = bound();
  const abort = new Error(ENGINE_ABORT);
  const reads = interceptSql(db, SQL_TARGET.ownership, async () => {});
  let expected: Awaited<ReturnType<typeof castSnapshot>> | undefined;
  await expect(
    surface.withOwnership(async () => {
      await replaceRoot();
      expected = await castSnapshot(db);
      throw abort;
    })
  ).rejects.toBe(abort);
  expect(reads()).toBe(COUNT.one);
  expect(expected).toBeDefined();
  expect(await castSnapshot(db)).toEqual(expected);
});
