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
import { createTestDb } from '@/platform/server/db/test-d1';
import type { Database } from '@/platform/server/db/client';
import { generateId } from '@/platform/id';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import {
  locationBibleVersions,
  locationReferencePhotos,
  locations,
  locationSheetVariants,
  sequenceLocationLinks,
  sequences,
} from '@/platform/server/db/schema';
import { createStoryboardCastScope } from '@/sequences/server/db/storyboard-cast-scope';
import { StoryboardContentOwnershipError } from '@/sequences/server/db/storyboard-content-scope';
import { STORYBOARD_WORKFLOW_STATUS } from '@/sequences/server/db/storyboard-owner';
import { createLocationsMethods } from './locations';
import type { AnalysedLocation } from './locations';
import {
  ANALYSIS,
  D1_BIND_LIMIT,
  FIRST_LINE,
  LOCATION_BATCH_COUNT,
  RUN,
  SQL_FAILURE,
  SQL_TARGET,
  failLocationInsert,
  interceptLocationSql,
  locationEntry,
  locationSnapshot,
  locationWriter,
  makeAnalysedLocation,
  makePickedLocation,
  observeLocationBinds,
  replaceLocationOwner,
  seedLocationOwners,
} from './storyboard-location-writes.test.fixture';
import type { LocationGraph } from './storyboard-location-writes.test.fixture';

let db: Database;
let closeDb: () => Promise<void>;
let graph: LocationGraph;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await db.run(sql`DROP TRIGGER IF EXISTS synthetic_location_failure`);
  graph = await seedLocationOwners(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const ordinary = () => createLocationsMethods(db, graph.organizationId);
const write = (entries: readonly AnalysedLocation[], bound = true) =>
  locationWriter(db, graph, bound)(entries, ANALYSIS);
const versionsOf = (id: string) =>
  db
    .select()
    .from(locationBibleVersions)
    .where(eq(locationBibleVersions.locationId, id));
const identityOf = async (id: string) => {
  const [row] = await db.select().from(locations).where(eq(locations.id, id));
  if (!row) throw new Error('Synthetic location identity missing');
  return row;
};
const linksOf = () =>
  db
    .select()
    .from(sequenceLocationLinks)
    .where(eq(sequenceLocationLinks.sequenceId, graph.sequenceId));

it('writes and renames guarded location slugs without test-only defaults', async () => {
  vi.stubEnv('VITEST', '');
  const [first, second] = await write([
    locationEntry(graph, 'slug-one', { name: 'Café Street' }),
    locationEntry(graph, 'slug-two', { name: 'Cafe-Street' }),
  ]);
  if (!first || !second) throw new Error('Missing synthetic slug locations');
  expect((await identityOf(first.id)).slug).toBe('cafe-street');
  expect((await identityOf(second.id)).slug).toBe('cafe-street-2');
  await write([locationEntry(graph, 'slug-one', { name: 'Moved Street' })]);
  expect((await identityOf(first.id)).slug).toBe('moved-street');
});

it('creates and renames organization location slugs without test-only defaults', async () => {
  vi.stubEnv('VITEST', '');
  const methods = ordinary();
  const location = await methods.createForOrganization(
    { name: 'Café Dock', rendering: PHOTOREAL_RENDERING },
    { createdBy: graph.actorId }
  );
  expect(await methods.resolveId('cafe-dock')).toBe(location.id);
  await methods.updateBible(
    null,
    location.id,
    { name: 'Moved Dock' },
    { actorId: graph.actorId }
  );
  expect(await methods.resolveId('moved-dock')).toBe(location.id);
  expect(await methods.resolveId('cafe-dock')).toBeNull();
});

async function protectLocation(id: string, sequenceId: string) {
  if (sequenceId === graph.sequenceId)
    await ordinary().softDelete(sequenceId, id, { actorId: graph.actorId });
  return ordinary().attach(sequenceId, id, { actorId: graph.actorId });
}

async function removeLocation(id: string) {
  await ordinary().softDelete(graph.sequenceId, id, { actorId: graph.actorId });
  await ordinary().softDeleteForOrganization(id);
}

async function readyReference(id: string) {
  const versionId = generateId();
  const claimId = generateId();
  await db.insert(locationSheetVariants).values({
    id: versionId,
    locationId: id,
    model: 'synthetic-model',
    url: '/r2/synthetic-location.png',
    storagePath: 'synthetic-location.png',
    status: 'completed',
  });
  await db.insert(locationReferencePhotos).values({
    locationId: id,
    url: '/r2/synthetic-photo.png',
    path: 'synthetic-photo.png',
  });
  await db
    .update(locations)
    .set({
      selectedReferenceVersionId: versionId,
      pendingPromoteReferenceVersionId: claimId,
      referenceStatus: 'completed',
      referenceError: 'Synthetic retained error',
    })
    .where(eq(locations.id, id));
  return { versionId, claimId };
}

for (const { mode, bound } of [
  { mode: 'ordinary', bound: false },
  { mode: 'owner-bound', bound: true },
]) {
  it(`${mode}: keeps schema defaults, scalar types, input order and replay identities`, async () => {
    const entries = [
      locationEntry(graph, 'loc_one'),
      locationEntry(graph, 'loc_two'),
    ];
    const first = await write(entries, bound);
    const replay = await write(entries, bound);
    expect(first.map((row) => row.locationId)).toEqual(['loc_one', 'loc_two']);
    expect(replay).toEqual(first);
    expect(await db.select().from(locations)).toHaveLength(entries.length);
    for (const row of first) {
      expect(row).toMatchObject({
        organizationId: graph.organizationId,
        attached: false,
        held: false,
        deletedAt: null,
        referenceStatus: 'pending',
        keyFeatures: '合成窗户、柜台',
        firstMentionLine: FIRST_LINE,
        createdAt: expect.any(Date),
      });
      expect(await versionsOf(row.id)).toMatchObject([
        {
          source: ANALYSIS.source,
          createdBy: null,
          createdAt: expect.any(Date),
          keyFeatures: '合成窗户、柜台',
        },
      ]);
    }
  });

  it(`${mode}: revives removed links and locations, appending only changed bibles`, async () => {
    const made = await makeAnalysedLocation(db, graph);
    const { versionId } = await readyReference(made.id);
    await removeLocation(made.id);
    const before = await locationSnapshot(db);
    const [result] = await write(
      [
        locationEntry(graph, made.locationId, {
          description: 'Synthetic changed bible',
          referenceStatus: 'failed',
          firstMentionText: 'Synthetic refreshed mention',
        }),
      ],
      bound
    );
    expect(result).toMatchObject({
      id: made.id,
      linkId: made.linkId,
      deletedAt: null,
      held: false,
      description: 'Synthetic changed bible',
      firstMentionText: 'Synthetic refreshed mention',
      referenceStatus: 'completed',
      referenceError: 'Synthetic retained error',
      selectedReferenceVersionId: versionId,
      pendingPromoteReferenceVersionId: null,
      referenceImageUrl: '/r2/synthetic-location.png',
    });
    expect(await versionsOf(made.id)).toHaveLength(before.bibles.length + 1);
    expect(await identityOf(made.id)).toMatchObject({ deletedAt: null });
    const after = await locationSnapshot(db);
    expect(after.sheets).toEqual(before.sheets);
    expect(after.photos).toEqual(before.photos);
    expect(after.events).toEqual(before.events);
  });

  it.each(['attached', 'shared', 'removed-and-archived'])(
    `${mode}: holds %s bibles and claims while refreshing the owner link`,
    async (protection) => {
      const made = await makeAnalysedLocation(db, graph);
      const { claimId } = await readyReference(made.id);
      const sequenceId =
        protection === 'attached' ? graph.sequenceId : graph.otherSequenceId;
      await protectLocation(made.id, sequenceId);
      if (protection === 'removed-and-archived') {
        await ordinary().softDelete(sequenceId, made.id, {
          actorId: graph.actorId,
        });
        await db
          .update(sequences)
          .set({ status: 'archived' })
          .where(eq(sequences.id, sequenceId));
      }
      await ordinary().softDelete(graph.sequenceId, made.id, {
        actorId: graph.actorId,
      });
      const before = await locationSnapshot(db);
      const [result] = await write(
        [
          locationEntry(graph, made.locationId, {
            description: 'Synthetic ignored bible',
            firstMentionText: 'Synthetic held mention',
          }),
        ],
        bound
      );
      expect(result).toMatchObject({
        id: made.id,
        held: true,
        deletedAt: null,
        description: made.description,
        selectedBibleVersionId: made.selectedBibleVersionId,
        pendingPromoteReferenceVersionId: claimId,
        firstMentionText: 'Synthetic held mention',
      });
      expect((await locationSnapshot(db)).bibles).toEqual(before.bibles);
    }
  );

  it.each(['new', 'own', 'holder', 'own-and-holder', 'removed-own'])(
    `${mode}: binds the %s link path without rewriting the matched location`,
    async (path) => {
      const picked = await makePickedLocation(db, graph);
      const holder = path.includes('holder')
        ? await makeAnalysedLocation(db, graph)
        : null;
      const own = path.includes('own')
        ? await ordinary().attach(graph.sequenceId, picked.id, {
            actorId: graph.actorId,
          })
        : null;
      if (path === 'removed-own')
        await ordinary().softDelete(graph.sequenceId, picked.id, {
          actorId: graph.actorId,
        });
      const before = await versionsOf(picked.id);
      const [result] = await write(
        [
          locationEntry(graph, 'loc_bound', {
            locationId: holder?.locationId ?? 'loc_bound',
            boundTo: picked.id,
            consistencyTag: 'synthetic_script_tag',
          }),
        ],
        bound
      );
      expect(result).toMatchObject({
        id: picked.id,
        held: true,
        attached: true,
        deletedAt: null,
        name: picked.name,
        description: picked.description,
        consistencyTag: 'synthetic_script_tag',
      });
      expect(result?.linkId).toEqual(
        own?.linkId ?? holder?.linkId ?? expect.any(String)
      );
      expect(await linksOf()).toHaveLength(1);
      expect(await versionsOf(picked.id)).toEqual(before);
      expect((await ordinary().getCurrent(picked.id))?.consistencyTag).toBe(
        'picked_tag'
      );
      if (holder) expect(await ordinary().getCurrent(holder.id)).toBeNull();
    }
  );

  it.each(['attached', 'shared'])(
    `${mode}: keeps the displaced %s location`,
    async (protection) => {
      const holder = await makeAnalysedLocation(db, graph);
      const picked = await makePickedLocation(db, graph);
      const sequenceId =
        protection === 'attached' ? graph.sequenceId : graph.otherSequenceId;
      await protectLocation(holder.id, sequenceId);
      await write(
        [locationEntry(graph, holder.locationId, { boundTo: picked.id })],
        bound
      );
      expect(await ordinary().getCurrent(holder.id)).toMatchObject({
        id: holder.id,
      });
    }
  );

  it(`${mode}: keeps empty writes and failures free of unintended mutations`, async () => {
    const before = await locationSnapshot(db);
    await expect(write([], bound)).resolves.toEqual([]);
    await expect(
      write([locationEntry(graph, 'loc_bad', { rendering: ' ' })], bound)
    ).rejects.toThrow('Rendering is required');
    await expect(
      write(
        [
          locationEntry(graph, 'loc_bad', {
            sequenceId: graph.foreignSequenceId,
          }),
        ],
        bound
      )
    ).rejects.toThrow('Sequence not found');
    const picked = await makePickedLocation(
      db,
      graph,
      graph.foreignOrganizationId
    );
    const withForeign = await locationSnapshot(db);
    await expect(
      write([locationEntry(graph, 'loc_bad', { boundTo: picked.id })], bound)
    ).rejects.toThrow('Location not found');
    expect(await locationSnapshot(db)).toEqual(withForeign);
    expect(withForeign.links).toEqual(before.links);
  });

  it(`${mode}: retains the authorized first batch when a later input fails`, async () => {
    await expect(
      write(
        [
          locationEntry(graph, 'loc_authorized'),
          locationEntry(graph, 'loc_bad', { rendering: ' ' }),
        ],
        bound
      )
    ).rejects.toThrow('Rendering is required');
    expect(await linksOf()).toMatchObject([
      { scriptLocationId: 'loc_authorized' },
    ]);
    expect(await db.select().from(locations)).toHaveLength(1);
    expect(await db.select().from(locationBibleVersions)).toHaveLength(1);
  });
}

it('keeps populated conditional inserts within the D1 bind budget', async () => {
  const counts = observeLocationBinds(db);
  const batch = vi.spyOn(db.$client, 'batch');
  const entries = Array.from({ length: LOCATION_BATCH_COUNT }, (_, index) =>
    locationEntry(graph, `loc_budget_${index}`, {
      id: generateId(),
      type: 'interior',
      architecturalStyle: 'Synthetic art deco',
      ambiance: 'Synthetic quiet',
      firstMentionSceneId: 'scene_synthetic',
    })
  );
  await expect(write(entries)).resolves.toHaveLength(LOCATION_BATCH_COUNT);
  expect(batch).toHaveBeenCalledTimes(LOCATION_BATCH_COUNT);
  expect(counts.length).toBeGreaterThan(LOCATION_BATCH_COUNT);
  expect(Math.max(...counts)).toBeLessThanOrEqual(D1_BIND_LIMIT);
});

it.each([
  { name: 'identity', match: SQL_TARGET.identity },
  { name: 'bible', match: SQL_TARGET.bible },
  { name: 'link', match: SQL_TARGET.linkInsert },
])(
  'checks the whole new-location batch at its $name boundary',
  async ({ match }) => {
    const timing = interceptLocationSql(db, {
      match,
      change: () => replaceLocationOwner(db, graph),
    });
    await expect(write([locationEntry(graph)])).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    await timing.assertUnchanged();
  }
);

it.each(['rewritten', 'unchanged', 'attached', 'shared'])(
  'fences every existing %s link/bible/pointer/claim write',
  async (path) => {
    const made = await makeAnalysedLocation(db, graph);
    await readyReference(made.id);
    if (path === 'attached' || path === 'shared')
      await ordinary().attach(
        path === 'attached' ? graph.sequenceId : graph.otherSequenceId,
        made.id,
        { actorId: graph.actorId }
      );
    await removeLocation(made.id);
    const timing = interceptLocationSql(db, {
      match: SQL_TARGET.linkUpdate,
      change: () => replaceLocationOwner(db, graph),
    });
    await expect(
      write([
        locationEntry(graph, made.locationId, {
          description:
            path === 'unchanged' ? made.description : 'Synthetic stale rewrite',
        }),
      ])
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    await timing.assertUnchanged();
  }
);

it.each(['new', 'own', 'holder', 'own-and-holder'])(
  'fences matched %s insertion, repointing and conflict deletion',
  async (path) => {
    const picked = await makePickedLocation(db, graph);
    if (path.includes('holder')) await makeAnalysedLocation(db, graph);
    if (path.includes('own'))
      await ordinary().attach(graph.sequenceId, picked.id, {
        actorId: graph.actorId,
      });
    const match =
      path === 'new' ? SQL_TARGET.linkInsert : SQL_TARGET.linkUpdate;
    const timing = interceptLocationSql(db, {
      match,
      change: () => replaceLocationOwner(db, graph),
    });
    await expect(
      write([locationEntry(graph, 'loc_synthetic', { boundTo: picked.id })])
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    await timing.assertUnchanged();
  }
);

it('fences the conflict DELETE before the entire bind batch', async () => {
  const holder = await makeAnalysedLocation(db, graph);
  const picked = await makePickedLocation(db, graph);
  await ordinary().attach(graph.sequenceId, picked.id, {
    actorId: graph.actorId,
  });
  const timing = interceptLocationSql(db, {
    match: SQL_TARGET.linkDelete,
    change: () => replaceLocationOwner(db, graph),
  });
  await expect(
    write([locationEntry(graph, holder.locationId, { boundTo: picked.id })])
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  await timing.assertUnchanged();
});

it.each(['holder', 'own-and-holder'])(
  'fences the separate orphan cleanup after authorized %s repointing',
  async (path) => {
    const holder = await makeAnalysedLocation(db, graph);
    const picked = await makePickedLocation(db, graph);
    if (path === 'own-and-holder')
      await ordinary().attach(graph.sequenceId, picked.id, {
        actorId: graph.actorId,
      });
    const timing = interceptLocationSql(db, {
      match: SQL_TARGET.cleanup,
      change: () => replaceLocationOwner(db, graph),
    });
    await expect(
      write([locationEntry(graph, holder.locationId, { boundTo: picked.id })])
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    await timing.assertUnchanged();
    expect(await ordinary().getById(graph.sequenceId, holder.id)).toBeNull();
    expect(await ordinary().getCurrent(holder.id)).toMatchObject({
      id: holder.id,
    });
    expect(await linksOf()).toMatchObject([{ locationId: picked.id }]);
  }
);

it('keeps completed first batches while stopping the next location', async () => {
  const timing = interceptLocationSql(db, {
    match: SQL_TARGET.identity,
    skip: 1,
    change: () => replaceLocationOwner(db, graph),
  });
  await expect(
    write([locationEntry(graph, 'loc_first'), locationEntry(graph, 'loc_late')])
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  await timing.assertUnchanged();
  expect(await linksOf()).toMatchObject([{ scriptLocationId: 'loc_first' }]);
  expect(await db.select().from(locationBibleVersions)).toHaveLength(1);
});

it('reports owner loss after a fully authorized batch without rolling it back', async () => {
  const timing = interceptLocationSql(db, {
    match: SQL_TARGET.identity,
    moment: 'after',
    change: () => replaceLocationOwner(db, graph),
  });
  await expect(write([locationEntry(graph)])).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  await timing.assertUnchanged();
  expect(await linksOf()).toHaveLength(1);
  expect(await db.select().from(locationBibleVersions)).toHaveLength(1);
});

it.each(['completed', 'wrong-org'])(
  'requires the root to stay active and organization-owned (%s)',
  async (change) => {
    const timing = interceptLocationSql(db, {
      match: SQL_TARGET.identity,
      change: () =>
        db
          .update(sequences)
          .set(
            change === 'completed'
              ? { status: STORYBOARD_WORKFLOW_STATUS.completed }
              : { organizationId: graph.foreignOrganizationId }
          )
          .where(eq(sequences.id, graph.sequenceId)),
    });
    await expect(write([locationEntry(graph)])).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    await timing.assertUnchanged();
  }
);

it('accepts the owner claim alias and preserves the ordinary empty path', async () => {
  await db
    .update(sequences)
    .set({ workflowRunId: RUN.claim })
    .where(eq(sequences.id, graph.sequenceId));
  await expect(write([locationEntry(graph)])).resolves.toHaveLength(1);
  await replaceLocationOwner(db, graph);
  const before = await locationSnapshot(db);
  await expect(write([])).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  await expect(write([], false)).resolves.toEqual([]);
  expect(await locationSnapshot(db)).toEqual(before);
});

it('preserves a real SQL failure and the atomic batch rollback while owned', async () => {
  await failLocationInsert(db);
  const before = await locationSnapshot(db);
  const failure = await write([locationEntry(graph)]).catch(
    (error: unknown) => error
  );
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(failure).toMatchObject({ message: SQL_FAILURE });
  expect(await locationSnapshot(db)).toEqual(before);
});

it.each(['other-sequence', 'foreign-location', 'repointed-location'])(
  'stops existing writes after a parent changes to %s',
  async (parent) => {
    const made = await makeAnalysedLocation(db, graph);
    const foreign = await makePickedLocation(
      db,
      graph,
      graph.foreignOrganizationId
    );
    await readyReference(made.id);
    await removeLocation(made.id);
    const timing = interceptLocationSql(db, {
      match: SQL_TARGET.linkUpdate,
      change: () =>
        changeExistingParent(parent, made.id, made.linkId, foreign.id),
    });
    await expect(
      write([
        locationEntry(graph, made.locationId, {
          description: 'Synthetic forbidden',
        }),
      ])
    ).rejects.toThrow('Location not found');
    await timing.assertUnchanged();
  }
);

it.each(['new', 'holder', 'own', 'own-and-holder'])(
  'refuses matched %s writes when the destination changes organization',
  async (path) => {
    const picked = await makePickedLocation(db, graph);
    if (path.includes('holder')) await makeAnalysedLocation(db, graph);
    if (path.includes('own'))
      await ordinary().attach(graph.sequenceId, picked.id, {
        actorId: graph.actorId,
      });
    const timing = interceptLocationSql(db, {
      match: path === 'new' ? SQL_TARGET.linkInsert : SQL_TARGET.linkUpdate,
      change: () =>
        db
          .update(locations)
          .set({ organizationId: graph.foreignOrganizationId })
          .where(eq(locations.id, picked.id)),
    });
    await expect(
      write([locationEntry(graph, 'loc_synthetic', { boundTo: picked.id })])
    ).rejects.toThrow('Location not found');
    await timing.assertUnchanged();
  }
);

it.each(['other-sequence', 'foreign-location'])(
  'fences a matched holder whose actual parent becomes %s',
  async (parent) => {
    const holder = await makeAnalysedLocation(db, graph);
    const picked = await makePickedLocation(db, graph);
    const timing = interceptLocationSql(db, {
      match: SQL_TARGET.linkUpdate,
      change: () =>
        changeExistingParent(parent, holder.id, holder.linkId, holder.id),
    });
    await expect(
      write([locationEntry(graph, holder.locationId, { boundTo: picked.id })])
    ).rejects.toThrow('Location not found');
    await timing.assertUnchanged();
  }
);

it('checks orphan eligibility again when another sequence takes the displaced location', async () => {
  const holder = await makeAnalysedLocation(db, graph);
  const picked = await makePickedLocation(db, graph);
  const timing = interceptLocationSql(db, {
    match: SQL_TARGET.cleanup,
    change: () =>
      ordinary().attach(graph.otherSequenceId, holder.id, {
        actorId: graph.actorId,
      }),
  });
  await expect(
    write([locationEntry(graph, holder.locationId, { boundTo: picked.id })])
  ).resolves.toHaveLength(1);
  await timing.assertUnchanged();
  expect(await ordinary().getCurrent(holder.id)).not.toBeNull();
});

it('keeps the conflict holder when the existing matched link moves to another sequence', async () => {
  const holder = await makeAnalysedLocation(db, graph);
  const picked = await makePickedLocation(db, graph);
  const own = await ordinary().attach(graph.sequenceId, picked.id, {
    actorId: graph.actorId,
  });
  const timing = interceptLocationSql(db, {
    match: SQL_TARGET.linkDelete,
    change: () =>
      db
        .update(sequenceLocationLinks)
        .set({ sequenceId: graph.otherSequenceId })
        .where(eq(sequenceLocationLinks.id, own.linkId)),
  });
  await expect(
    write([locationEntry(graph, holder.locationId, { boundTo: picked.id })])
  ).rejects.toThrow('Location not found');
  await timing.assertUnchanged();
});

it('keeps the organization check on orphan cleanup after its link has gone', async () => {
  const holder = await makeAnalysedLocation(db, graph);
  const picked = await makePickedLocation(db, graph);
  const timing = interceptLocationSql(db, {
    match: SQL_TARGET.cleanup,
    change: () =>
      db
        .update(locations)
        .set({ organizationId: graph.foreignOrganizationId })
        .where(eq(locations.id, holder.id)),
  });
  await expect(
    write([locationEntry(graph, holder.locationId, { boundTo: picked.id })])
  ).resolves.toHaveLength(1);
  await timing.assertUnchanged();
});

it('rejects a fresh identity targeting another sequence without inserting anything', async () => {
  const before = await locationSnapshot(db);
  await expect(
    write([
      locationEntry(graph, 'loc_other', {
        sequenceId: graph.otherSequenceId,
      }),
    ])
  ).rejects.toThrow('Location not found');
  expect(await locationSnapshot(db)).toEqual(before);
});

it('fences another sequence even when it shares the owner location', async () => {
  const made = await makeAnalysedLocation(db, graph);
  const attached = await ordinary().attach(graph.otherSequenceId, made.id, {
    actorId: graph.actorId,
  });
  await ordinary().softDelete(graph.otherSequenceId, made.id, {
    actorId: graph.actorId,
  });
  const before = await locationSnapshot(db);
  await expect(
    write([
      locationEntry(graph, attached.locationId, {
        sequenceId: graph.otherSequenceId,
        firstMentionText: 'Synthetic forbidden mention',
      }),
    ])
  ).resolves.toHaveLength(1);
  expect(await locationSnapshot(db)).toEqual(before);
});

it('also guards a direct optional-scope factory without the facade precheck', async () => {
  const scope = createStoryboardCastScope(db, graph.organizationId, {
    id: graph.sequenceId,
    workflowRunId: RUN.owner,
  });
  await replaceLocationOwner(db, graph);
  const before = await locationSnapshot(db);
  await expect(
    createLocationsMethods(db, graph.organizationId, scope).createBulk(
      [locationEntry(graph)],
      ANALYSIS
    )
  ).rejects.toThrow('Location not found');
  expect(await locationSnapshot(db)).toEqual(before);
});
function changeExistingParent(
  parent: string,
  id: string,
  linkId: string,
  foreignId: string
) {
  if (parent === 'foreign-location')
    return db
      .update(locations)
      .set({ organizationId: graph.foreignOrganizationId })
      .where(eq(locations.id, id));
  return db
    .update(sequenceLocationLinks)
    .set(
      parent === 'other-sequence'
        ? { sequenceId: graph.otherSequenceId }
        : { locationId: foreignId }
    )
    .where(eq(sequenceLocationLinks.id, linkId));
}
