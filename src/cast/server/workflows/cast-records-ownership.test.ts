import { NonRetryableError } from 'cloudflare:workflows';
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
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import {
  sequenceCast,
  sequenceElements,
  characterLooks,
  characterBibleVersions,
  locations,
  sequences,
} from '@/platform/server/db/schema';
import { StoryboardContentOwnershipError } from '@/sequences/server/db/storyboard-content-scope';
import { STORYBOARD_WORKFLOW_STATUS } from '@/sequences/server/db/storyboard-owner';
import { createCastRecords } from './cast-records';
import {
  CHARACTER,
  ELEMENT,
  COUNT,
  NEXT_ROOT,
  castInput,
  replaceCastOwner,
  seedCastSequence,
} from '../db/cast-records-ownership.test.fixture';
import type { Graph } from '../db/cast-records-ownership.test.fixture';

// Actual scoped-DB/service composition in migrated Node SQLite; not Workerd/provider acceptance.
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
  graph = await seedCastSequence(db);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(new Error('Unexpected network in synthetic cast test'))
    )
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function scope() {
  return createScopedDb(graph.organizationId, graph.userId);
}
function workflow() {
  return toWorkflowScopedDb(scope());
}
async function counts() {
  const tables = [
    'characters',
    'character_bible_versions',
    'character_looks',
    'character_look_versions',
    'sequence_cast',
    'sequence_locations',
    'location_bible_versions',
    'sequence_location_links',
    'sequence_elements',
    'character_voice_versions',
    'sequence_events',
  ] as const;
  const rows = await Promise.all(
    tables.map((name) =>
      db.all<{ count: number }>(
        sql.raw(`SELECT count(*) AS count FROM "${name}"`)
      )
    )
  );
  return Object.fromEntries(
    tables.map((name, index) => [name, rows[index]?.[0]?.count])
  );
}
async function castCharacterId() {
  const [link] = await db
    .select()
    .from(sequenceCast)
    .where(eq(sequenceCast.sequenceId, graph.sequenceId));
  if (!link) throw new Error('Synthetic cast must have a character');
  return link.characterId;
}

it('publishes actual character looks, location and element records through the scoped cast facade', async () => {
  const scopedDb = workflow();
  const facade = vi.spyOn(scopedDb, 'storyboardCast');
  const result = await createCastRecords(scopedDb, castInput(graph));
  expect(facade).toHaveBeenCalledExactlyOnceWith({
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
  });
  expect(result.elements).toEqual([
    expect.objectContaining({
      token: ELEMENT.token,
      description: ELEMENT.description,
      imageUrl: null,
    }),
  ]);
  const characterId = await castCharacterId();
  const looks = await db
    .select()
    .from(characterLooks)
    .where(eq(characterLooks.characterId, characterId));
  expect(looks).toHaveLength(COUNT.two);
  expect(result.lookIds).toMatchObject({
    'char_1:default': characterId,
    'char_1:rain': expect.any(String),
  });
  expect(
    (await scope().characters.getById(graph.sequenceId, characterId))
      ?.voiceDescription
  ).toBe(CHARACTER.voiceDescription);
  expect(await scope().locations.list(graph.sequenceId)).toHaveLength(
    COUNT.one
  );
  expect(await scope().sequenceElements.list(graph.sequenceId)).toHaveLength(
    COUNT.one
  );
});

it('replays unchanged input without extra bibles, looks, locations, voices or elements', async () => {
  const first = await createCastRecords(workflow(), castInput(graph));
  const before = await counts();
  const second = await createCastRecords(workflow(), castInput(graph));
  expect(second).toEqual(first);
  expect(await counts()).toEqual(before);
});

it('keeps a snapshotted shared character bible and reuses its look identities', async () => {
  const first = await createCastRecords(workflow(), castInput(graph));
  const characterId = await castCharacterId();
  const before = await db.select().from(characterBibleVersions);
  const result = await createCastRecords(workflow(), {
    ...castInput(graph),
    cast: [{ id: characterId, shared: true, entry: CHARACTER }],
    characterBible: [
      { ...CHARACTER, name: '迟到的合成改写', physicalDescription: '不得重写' },
    ],
  });
  expect(await db.select().from(characterBibleVersions)).toEqual(before);
  expect(result.lookIds).toEqual(first.lookIds);
});

it('preserves uploaded-element precedence and the generation cap in the actual service', async () => {
  const uploaded = await scope().sequenceElements.create({
    sequenceId: graph.sequenceId,
    token: ELEMENT.token,
    uploadedFilename: 'synthetic.png',
    imageUrl: '/r2/synthetic-upload',
  });
  const additional = ['A', 'B', 'C', 'D'].map((token) => ({
    ...ELEMENT,
    token,
  }));
  const result = await createCastRecords(workflow(), {
    ...castInput(graph),
    characterBible: [],
    locationBible: [],
    elementBible: [ELEMENT, ...additional],
    existingElements: [
      { id: uploaded.id, token: uploaded.token, imageUrl: uploaded.imageUrl },
    ],
  });
  expect(result.elements.map((row) => row.token)).toEqual(['A', 'B', 'C']);
  expect((await scope().sequenceElements.getById(uploaded.id))?.imageUrl).toBe(
    '/r2/synthetic-upload'
  );
});

it('stops before any cast write after the root has changed', async () => {
  await replaceCastOwner(db, graph);
  const before = await counts();
  await expect(
    createCastRecords(workflow(), castInput(graph))
  ).rejects.toBeInstanceOf(NonRetryableError);
  expect(await counts()).toEqual(before);
});

it('retains the authorized first character batch but stops all later methods after takeover', async () => {
  const originalLocations = await db.select().from(locations);
  const originalElements = await db.select().from(sequenceElements);
  const scopedDb = workflow();
  const output = scopedDb.storyboardCast({
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
  });
  vi.spyOn(scopedDb, 'storyboardCast').mockReturnValue({
    ...output,
    characters: {
      create: async (...args) => {
        const row = await output.characters.create(...args);
        await replaceCastOwner(db, graph);
        return row;
      },
    },
  });
  await expect(
    createCastRecords(scopedDb, castInput(graph))
  ).rejects.toBeInstanceOf(NonRetryableError);
  const characterId = await castCharacterId();
  expect(
    await db
      .select()
      .from(characterLooks)
      .where(eq(characterLooks.characterId, characterId))
  ).toHaveLength(COUNT.one);
  expect(await db.select().from(locations)).toEqual(originalLocations);
  expect(await db.select().from(sequenceElements)).toEqual(originalElements);
});

it('rejects takeover after the reused-element lookup even when no element INSERT runs', async () => {
  const scopedDb = workflow();
  const row = await scope().sequenceElements.create({
    sequenceId: graph.sequenceId,
    token: ELEMENT.token,
    uploadedFilename: 'synthetic.png',
  });
  const get = scopedDb.liveRead.sequenceElements.getByToken;
  vi.spyOn(scopedDb.liveRead.sequenceElements, 'getByToken').mockImplementation(
    async (...args) => {
      const result = await get(...args);
      await replaceCastOwner(db, graph);
      return result;
    }
  );
  const before = await counts();
  await expect(
    createCastRecords(scopedDb, {
      ...castInput(graph),
      characterBible: [],
      locationBible: [],
    })
  ).rejects.toBeInstanceOf(NonRetryableError);
  expect(await counts()).toEqual(before);
  expect(await scope().sequenceElements.getById(row.id)).toEqual(row);
});

it('rechecks the completely empty cast before returning its no-op result', async () => {
  const scopedDb = workflow();
  const output = scopedDb.storyboardCast({
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
  });
  vi.spyOn(scopedDb, 'storyboardCast').mockReturnValue({
    ...output,
    locations: {
      createBulk: async (...args) => {
        const result = await output.locations.createBulk(...args);
        await replaceCastOwner(db, graph);
        return result;
      },
    },
  });
  await expect(
    createCastRecords(scopedDb, {
      ...castInput(graph),
      characterBible: [],
      locationBible: [],
      elementBible: [],
    })
  ).rejects.toBeInstanceOf(NonRetryableError);
});

it('uses the declared raw launcher claim without inferring authority from another instance id', async () => {
  await db
    .update(sequences)
    .set({ workflowRunId: graph.rawClaimId })
    .where(eq(sequences.id, graph.sequenceId));
  await expect(
    createCastRecords(workflow(), castInput(graph))
  ).rejects.toBeInstanceOf(NonRetryableError);
  const result = await createCastRecords(workflow(), {
    ...castInput(graph),
    storyboardOwner: {
      workflowRunId: graph.workflowRunId,
      workflowClaimId: graph.rawClaimId,
    },
  });
  expect(result.elements).toHaveLength(COUNT.one);
});

it('keeps ownerless standalone behavior on a terminal sequence without making a facade', async () => {
  const scopedDb = workflow();
  const facade = vi.spyOn(scopedDb, 'storyboardCast');
  await db
    .update(sequences)
    .set({
      status: STORYBOARD_WORKFLOW_STATUS.completed,
      workflowRunId: NEXT_ROOT,
    })
    .where(eq(sequences.id, graph.sequenceId));
  const result = await createCastRecords(scopedDb, {
    ...castInput(graph),
    storyboardOwner: undefined,
  });
  expect(result.elements).toHaveLength(COUNT.one);
  expect(facade).not.toHaveBeenCalled();
});

it('converts callback ownership loss inside the service while retaining its cause', async () => {
  const scopedDb = workflow();
  const output = scopedDb.storyboardCast({
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
  });
  const failure = new StoryboardContentOwnershipError();
  vi.spyOn(scopedDb, 'storyboardCast').mockReturnValue({
    ...output,
    withOwnership: async () => {
      throw failure;
    },
  });
  await expect(
    createCastRecords(scopedDb, castInput(graph))
  ).rejects.toMatchObject({ name: failure.name, cause: failure });
});
