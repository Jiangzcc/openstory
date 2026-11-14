import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import {
  characterLooks,
  characters,
  locations,
  sequenceCast,
  sequenceLocationLinks,
  sequences,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createStoryboardCastScope } from './storyboard-cast-scope';
import type { StoryboardCastScope } from './storyboard-cast-scope';
import {
  FIXTURE_DATE,
  ROOT_LOSSES,
  STATUS,
  REPLACEMENT_RUN,
  ownerFor,
  seedAlternateLook,
  seedCastGraph,
  seedParents,
  setRoot,
} from './storyboard-cast.test.fixture';
import type { Graph, Parents } from './storyboard-cast.test.fixture';

let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
let parents: Awaited<ReturnType<typeof seedScopeParents>>;
let scope: StoryboardCastScope;
const MODE = { parameter: 'parameter', column: 'column' } as const;
type Mode = (typeof MODE)[keyof typeof MODE];
const ALL = {
  character: true,
  look: true,
  location: true,
  organizationCharacter: true,
  organizationLocation: true,
};
const NONE = Object.fromEntries(Object.keys(ALL).map((key) => [key, false]));
const TARGETS = [
  { key: 'own', linked: true, organization: true },
  { key: 'removed', linked: true, organization: true },
  { key: 'orphan', linked: false, organization: true },
  { key: 'sibling', linked: false, organization: true },
  { key: 'foreign', linked: false, organization: false },
  { key: 'foreignLinked', linked: false, organization: false },
  { key: 'missing', linked: false, organization: false },
] as const;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedCastGraph(db);
  parents = await seedScopeParents();
  scope = createStoryboardCastScope(db, graph.organizationId, ownerFor(graph));
});

async function seedScopeParents() {
  const own = await seedScopeParent(graph);
  const removed = await seedScopeParent(graph, true, FIXTURE_DATE);
  const orphan = await seedScopeParent(graph, false);
  const sibling = await seedScopeParent(graph.sibling);
  const foreign = await seedScopeParent(graph.foreign);
  const foreignLinked = await seedScopeParent({
    ...graph.foreign,
    sequenceId: graph.sequenceId,
  });
  const missing = {
    ...own,
    characterId: graph.userId,
    lookId: graph.userId,
    locationId: graph.userId,
  };
  return { own, removed, orphan, sibling, foreign, foreignLinked, missing };
}

async function seedScopeParent(
  root: Pick<Graph, 'organizationId' | 'sequenceId'>,
  linked = true,
  removedAt: Date | null = null
) {
  return seedAlternateLook(db, await seedParents(db, root, linked, removedAt));
}

async function matches(
  table: SQLiteTable,
  column: AnySQLiteColumn,
  id: string,
  predicate: SQL | undefined
) {
  const rows = await db
    .select({ id: column })
    .from(table)
    .where(and(eq(column, id), predicate));
  return rows.length > 0;
}

function scopeRows(parent: Parents, mode: Mode = MODE.column) {
  const target = (column: AnySQLiteColumn, id: string) =>
    mode === MODE.column ? column : id;
  return Promise.all([
    matches(
      characters,
      characters.id,
      parent.characterId,
      scope.character(target(characters.id, parent.characterId))
    ),
    matches(
      characterLooks,
      characterLooks.id,
      parent.lookId,
      scope.look(target(characterLooks.id, parent.lookId))
    ),
    matches(
      locations,
      locations.id,
      parent.locationId,
      scope.location(target(locations.id, parent.locationId))
    ),
    matches(
      characters,
      characters.id,
      parent.characterId,
      scope.organizationCharacter(target(characters.id, parent.characterId))
    ),
    matches(
      locations,
      locations.id,
      parent.locationId,
      scope.organizationLocation(target(locations.id, parent.locationId))
    ),
  ]).then(
    ([
      character,
      look,
      location,
      organizationCharacter,
      organizationLocation,
    ]) => ({
      character,
      look,
      location,
      organizationCharacter,
      organizationLocation,
    })
  );
}

it.each(
  TARGETS.flatMap((target) =>
    Object.values(MODE).map((mode) => ({ ...target, mode }))
  )
)('checks $key parents through $mode predicates', async (scenario) => {
  expect(await scopeRows(parents[scenario.key], scenario.mode)).toEqual({
    character: scenario.linked,
    look: scenario.linked,
    location: scenario.linked,
    organizationCharacter: scenario.organization,
    organizationLocation: scenario.organization,
  });
});

it.each(['own', 'sibling', 'foreign'] as const)(
  'checks the actual %s sequence with parameter and column predicates',
  async (key) => {
    const root = key === 'own' ? graph : graph[key];
    expect(
      await matches(
        sequences,
        sequences.id,
        root.sequenceId,
        scope.sequence(root.sequenceId)
      )
    ).toBe(key === 'own');
    expect(
      await matches(
        sequences,
        sequences.id,
        root.sequenceId,
        scope.sequence(sequences.id)
      )
    ).toBe(key === 'own');
  }
);

it('allows newly inserted organization parents only on the cleanup predicates', async () => {
  const orphan = await seedScopeParent(graph, false);
  expect(await scopeRows(orphan)).toEqual({
    ...ALL,
    character: false,
    look: false,
    location: false,
  });
});

it.each(ROOT_LOSSES)(
  'invalidates every predicate after $name',
  async (loss) => {
    expect(await scopeRows(parents.own)).toEqual(ALL);
    await setRoot(db, graph, loss.patch(graph));
    expect(await scopeRows(parents.own)).toEqual(NONE);
    expect(await scopeRows(parents.orphan)).toEqual(NONE);
  }
);

it.each([
  { name: 'root replacement', patch: { workflowRunId: REPLACEMENT_RUN } },
  { name: 'status completion', patch: { status: STATUS.completed } },
])('reuses live predicates across $name and restoration', async ({ patch }) => {
  await setRoot(db, graph, patch);
  expect(await scopeRows(parents.own)).toEqual(NONE);
  await setRoot(db, graph, {
    workflowRunId: graph.workflowRunId,
    status: STATUS.processing,
  });
  expect(await scopeRows(parents.own)).toEqual(ALL);
});

it('keeps removed links valid until the actual links disappear', async () => {
  expect(await scopeRows(parents.removed)).toEqual(ALL);
  await db
    .delete(sequenceCast)
    .where(eq(sequenceCast.characterId, parents.removed.characterId));
  await db
    .delete(sequenceLocationLinks)
    .where(eq(sequenceLocationLinks.locationId, parents.removed.locationId));
  expect(await scopeRows(parents.removed)).toEqual({
    ...ALL,
    character: false,
    look: false,
    location: false,
  });
});

it('ignores misleading script identities, mention pointers and look selections', async () => {
  await db
    .update(characters)
    .set({ firstMentionSceneId: graph.sequenceId })
    .where(eq(characters.id, parents.sibling.characterId));
  await db
    .update(sequenceCast)
    .set({
      scriptCharacterId: parents.own.scriptCharacterId,
      aliases: [
        {
          characterId: parents.own.characterId,
          name: 'Synthetic original character',
          consistencyTag: null,
        },
      ],
    })
    .where(eq(sequenceCast.characterId, parents.sibling.characterId));
  await db
    .update(sequenceLocationLinks)
    .set({
      scriptLocationId: parents.own.scriptLocationId,
      firstMentionSceneId: graph.sequenceId,
    })
    .where(eq(sequenceLocationLinks.locationId, parents.sibling.locationId));
  await db
    .update(characterLooks)
    .set({
      selectedLookVersionId: parents.own.lookVersionId,
    })
    .where(eq(characterLooks.id, parents.foreignLinked.lookId));
  expect(await scopeRows(parents.sibling)).toEqual({
    ...ALL,
    character: false,
    look: false,
    location: false,
  });
  expect(await scopeRows(parents.foreignLinked)).toEqual(NONE);
  expect(await scopeRows(parents.own)).toEqual(ALL);
});
