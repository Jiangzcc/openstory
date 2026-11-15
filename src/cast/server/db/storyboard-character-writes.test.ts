import { eq, sql } from 'drizzle-orm';
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
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  characterBibleVersions,
  characterLooks,
  characterLookVersions,
  characterVoiceVersions,
  characters,
  sequenceCast,
  sequenceEvents,
  sequences,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { StoryboardContentOwnershipError } from '@/sequences/server/db/storyboard-content-scope';
import { createCharactersMethods } from './characters';
import {
  createCharacterLooksMethods,
  lookDefinitionWrite,
  requireLook,
} from './character-looks';
import {
  ANALYSED,
  BULK_LOOKS,
  BULK_LOOK_COUNT,
  STATEMENTS_PER_NEW_LOOK,
  DATE,
  MUTATIONS,
  OPTIONS,
  bindCast,
  input,
  removeDefaultLook,
  replaceBefore,
  replaceOwner,
  scheduleTransport,
  seedGraph,
  seedSequence,
  shareWithArchivedSequence,
  snapshot,
  history,
  wearRetiredLook,
} from './storyboard-character-writes.test.fixture';
import type { Graph } from './storyboard-character-writes.test.fixture';

// Migrated Node SQLite D1 coverage; no provider calls or durable workflow replay.
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
  graph = await seedGraph(db);
});
const SQL_FAULT = 'synthetic_character_failure';
const SQL_FAILURE = 'synthetic character write refused';
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT));
});

it('writes real slugs on guarded inserts without the test-only default', async () => {
  vi.stubEnv('VITEST', '');
  const bound = bindCast(db, graph);
  const first = await bound.create(
    input(graph.sequenceId, { characterId: 'slug-one', name: 'Café Ada' }),
    OPTIONS
  );
  const second = await bound.create(
    input(graph.sequenceId, { characterId: 'slug-two', name: 'Cafe-Ada' }),
    OPTIONS
  );
  const rows = await db.select().from(characters);
  expect(rows.find((row) => row.id === first.id)?.slug).toBe('cafe-ada');
  expect(rows.find((row) => row.id === second.id)?.slug).toBe('cafe-ada-2');
});

it('renames a guarded character slug with its selected bible version', async () => {
  vi.stubEnv('VITEST', '');
  const bound = bindCast(db, graph);
  await bound.create(input(graph.sequenceId, { name: 'Café Ada' }), OPTIONS);
  await bound.create(input(graph.sequenceId, { name: 'Cafe-Ada' }), OPTIONS);
  const [row] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, graph.character.id));
  expect(row?.slug).toBe('cafe-ada');
  expect(
    (
      await createCharactersMethods(db, graph.organizationId).getCurrent(
        graph.character.id
      )
    )?.name
  ).toBe('Cafe-Ada');
});

it('creates and renames organization character slugs without test-only defaults', async () => {
  vi.stubEnv('VITEST', '');
  const actorId = generateId();
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic slug writer',
    email: actorId + '@example.invalid',
  });
  const methods = createCharactersMethods(db, graph.organizationId);
  const character = await methods.createForOrganization(
    {
      name: 'Café Portrait',
      rendering: PHOTOREAL_RENDERING,
      standardClothing: 'coat',
    },
    { createdBy: actorId }
  );
  expect(await methods.resolveId('cafe-portrait')).toBe(character.id);
  await methods.updateBible(
    null,
    character.id,
    { name: 'Moved Portrait' },
    { source: 'edit', actorId }
  );
  expect(await methods.resolveId('moved-portrait')).toBe(character.id);
  expect(await methods.resolveId('cafe-portrait')).toBeNull();
});

it('retries a concurrent organization slug collision without partial version rows', async () => {
  vi.stubEnv('VITEST', '');
  const actorId = generateId();
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic collision writer',
    email: actorId + '@example.invalid',
  });
  const methods = createCharactersMethods(db, graph.organizationId);
  const created = await Promise.all(
    ['Café Twin', 'Cafe-Twin'].map((name) =>
      methods.createForOrganization(
        { name, rendering: PHOTOREAL_RENDERING, standardClothing: 'coat' },
        { createdBy: actorId }
      )
    )
  );
  expect(new Set(created.map((character) => character.id)).size).toBe(2);
  expect(
    new Set([
      await methods.resolveId('cafe-twin'),
      await methods.resolveId('cafe-twin-2'),
    ])
  ).toEqual(new Set(created.map((character) => character.id)));
  const versions = await db.select().from(characterBibleVersions);
  expect(
    versions.filter((version) =>
      created.some((character) => character.id === version.characterId)
    )
  ).toHaveLength(2);
});

it.each(MUTATIONS)(
  'allows $name under the active owner within D1 bind limits',
  async ({ write }) => {
    const before = await snapshot(db);
    await write(bindCast(db, graph), graph);
    expect(await snapshot(db)).not.toEqual(before);
  }
);

describe.each(['replaced', 'failed', 'completed'] as const)(
  'owner %s',
  (loss) => {
    it.each(MUTATIONS)(
      'blocks $name before any mutation',
      async ({ write }) => {
        const bound = bindCast(db, graph);
        if (loss === 'replaced') await replaceOwner(db, graph);
        else
          await db
            .update(sequences)
            .set({ status: loss })
            .where(eq(sequences.id, graph.sequenceId));
        const before = await snapshot(db);
        await expect(write(bound, graph)).rejects.toBeInstanceOf(
          StoryboardContentOwnershipError
        );
        expect(await snapshot(db)).toEqual(before);
      }
    );
  }
);

it.each(MUTATIONS)(
  'fences $name when replacement lands after precheck',
  async ({ write }) => {
    const race = replaceBefore(db, graph);
    await expect(write(bindCast(db, graph), graph)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(race()).toMatchObject({ ran: true, prechecked: true });
    expect(await snapshot(db)).toEqual(race().expected);
  }
);

it.each(MUTATIONS)(
  'rejects $name under another organization',
  async ({ write }) => {
    const other = await seedGraph(db);
    const before = await snapshot(db);
    await expect(
      write(bindCast(db, graph, other.organizationId), graph)
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(await snapshot(db)).toEqual(before);
  }
);

it('preserves schema defaults, JSON, timestamps and changed-only histories', async () => {
  const bound = bindCast(db, graph);
  const created = await bound.create(
    input(graph.sequenceId, {
      characterId: 'new',
      voiceDescription: '轻柔\n"自然"',
    }),
    OPTIONS
  );
  const [row] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, created.id));
  const [link] = await db
    .select()
    .from(sequenceCast)
    .where(eq(sequenceCast.characterId, created.id));
  const look = await requireLook(db, graph.organizationId, created.id);
  expect(row?.createdAt).toBeInstanceOf(Date);
  expect(link?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(link?.attached).toBe(false);
  expect(look).toMatchObject({
    id: created.id,
    isDefault: true,
    sheetStatus: 'pending',
  });
  expect(created.voiceDescription).toBe('轻柔\n"自然"');
  const before = await history(db);
  await bound.create(
    input(graph.sequenceId, {
      characterId: 'new',
      voiceDescription: '轻柔\n"自然"',
    }),
    OPTIONS
  );
  expect(await history(db)).toEqual(before);
});

it('keeps isPerson monotonic and clears sheet claims only for changed inputs', async () => {
  const bound = bindCast(db, graph);
  await bound.create(input(graph.sequenceId, { isPerson: false }), OPTIONS);
  expect(
    await requireLook(db, graph.organizationId, graph.character.id)
  ).toMatchObject({ pendingPromoteSheetVersionId: graph.claimId });
  const changed = await bound.create(
    input(graph.sequenceId, {
      age: 'older',
      isPerson: false,
      standardClothing: 'new coat',
    }),
    OPTIONS
  );
  expect(changed.isPerson).toBe(true);
  expect(
    await requireLook(db, graph.organizationId, graph.character.id)
  ).toMatchObject({ clothing: 'new coat', pendingPromoteSheetVersionId: null });
  const history = await db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.targetId, graph.character.id));
  expect(
    history.some(
      (event) => event.kind === 'character.updated' && event.data?.bibleVersion
    )
  ).toBe(true);
});

it('moves legacy features, revives matched looks and retires eligible analysis looks', async () => {
  const ids = await bindCast(db, graph).sync(
    graph.sequenceId,
    graph.character.id,
    ANALYSED
  );
  expect(ids.revive).toBe(graph.reviveId);
  const look = await requireLook(db, graph.organizationId, graph.character.id);
  expect(look).toMatchObject({
    styling: 'new hair',
    pendingPromoteSheetVersionId: null,
  });
  const [bible] = await db
    .select()
    .from(characterBibleVersions)
    .innerJoin(
      characters,
      eq(characters.selectedBibleVersionId, characterBibleVersions.id)
    )
    .where(eq(characters.id, graph.character.id));
  expect(
    bible?.character_bible_versions.legacyDistinguishingFeatures
  ).toBeNull();
  expect(
    await requireLook(db, graph.organizationId, graph.reviveId)
  ).toMatchObject({ deletedAt: null, clothing: 'new dress' });
  expect(
    (await requireLook(db, graph.organizationId, graph.retireId)).deletedAt
  ).toBeInstanceOf(Date);
  expect(
    await requireLook(db, graph.organizationId, ids.new ?? '')
  ).toMatchObject({ clothing: '羽绒服\n"白色"' });
});

it.each(['create', 'sync'] as const)(
  'fences %s default-look backfill after its legacy read',
  async (kind) => {
    await removeDefaultLook(db, graph);
    const race = replaceBefore(db, graph, /^insert into "character_looks"/i);
    const bound = bindCast(db, graph);
    const write =
      kind === 'create'
        ? bound.create(input(graph.sequenceId, { age: 'older' }), OPTIONS)
        : bound.sync(graph.sequenceId, graph.character.id, ANALYSED);
    await expect(write).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(race()).toMatchObject({ ran: true, prechecked: true });
    expect(await snapshot(db)).toEqual(race().expected);
  }
);

it('backfills a valid legacy default without losing its sheet claim', async () => {
  await removeDefaultLook(db, graph);
  await bindCast(db, graph).create(
    input(graph.sequenceId, { standardClothing: 'legacy coat' }),
    OPTIONS
  );
  const look = await requireLook(db, graph.organizationId, graph.character.id);
  expect(look).toMatchObject({
    clothing: 'legacy coat',
    sheetStatus: 'generating',
    pendingPromoteSheetVersionId: graph.claimId,
  });
});

it.each(['new', 'existing'] as const)(
  'fences the separate incoming voice batch for %s characters',
  async (kind) => {
    const voiceClaim = generateId();
    await db
      .update(characters)
      .set({ pendingPromoteVoiceVersionId: voiceClaim })
      .where(eq(characters.id, graph.character.id));
    const race = replaceBefore(
      db,
      graph,
      /^insert into "character_voice_versions"/i
    );
    const characterId = kind === 'new' ? 'new' : 'char_001';
    await expect(
      bindCast(db, graph).create(
        input(graph.sequenceId, {
          characterId,
          age: 'older',
          voiceDescription: 'new voice',
        }),
        OPTIONS
      )
    ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
    expect(race().ran).toBe(true);
    expect(await snapshot(db)).toEqual(race().expected);
    const [row] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, graph.character.id));
    expect(row?.pendingPromoteVoiceVersionId).toBe(voiceClaim);
  }
);

it('retains authorized look history when a later nested batch loses ownership', async () => {
  const race = replaceBefore(db, graph, /^insert into "character_looks"/i);
  await expect(
    bindCast(db, graph).sync(graph.sequenceId, graph.character.id, ANALYSED)
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(race().ran).toBe(true);
  expect(await snapshot(db)).toEqual(race().expected);
  expect(
    await requireLook(db, graph.organizationId, graph.character.id)
  ).toMatchObject({ styling: 'new hair' });
  expect(
    await requireLook(db, graph.organizationId, graph.reviveId)
  ).toMatchObject({ deletedAt: null, clothing: 'new dress' });
  expect(
    await requireLook(db, graph.organizationId, graph.retireId)
  ).toMatchObject({ deletedAt: null });
});

it('checks the actual link after precheck instead of trusting a character id', async () => {
  const race = scheduleTransport(db, /^update "sequence_cast"/i, async () => {
    await db
      .delete(sequenceCast)
      .where(eq(sequenceCast.characterId, graph.character.id));
  });
  await expect(
    bindCast(db, graph).create(
      input(graph.sequenceId, { age: 'older' }),
      OPTIONS
    )
  ).rejects.toThrow();
  expect(race().ran).toBe(true);
  const [row] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, graph.character.id));
  expect(row?.selectedBibleVersionId).toBe(
    graph.character.selectedBibleVersionId
  );
  expect(
    await requireLook(db, graph.organizationId, graph.character.id)
  ).toMatchObject({ pendingPromoteSheetVersionId: graph.claimId });
});

it('checks a look parent relationship again before its definition and legacy move', async () => {
  const before = await snapshot(db);
  const race = scheduleTransport(
    db,
    /^insert into "character_look_versions"/i,
    async () => {
      await db
        .delete(sequenceCast)
        .where(eq(sequenceCast.characterId, graph.character.id));
    }
  );
  const [defaultAnalysis] = ANALYSED;
  if (!defaultAnalysis) throw new Error('Missing synthetic default look');
  await bindCast(db, graph).sync(graph.sequenceId, graph.character.id, [
    defaultAnalysis,
  ]);
  expect(race().ran).toBe(true);
  const after = await snapshot(db);
  expect({ ...after, sequence_cast: before.sequence_cast }).toEqual(before);
});

it('does not backfill or append looks for characters in another sequence or organization', async () => {
  const otherSequence = await seedSequence(db, graph);
  const foreign = await createCharactersMethods(
    db,
    graph.organizationId
  ).create(input(otherSequence.sequenceId), OPTIONS);
  const foreignGraph = { ...graph, ...otherSequence, character: foreign };
  await removeDefaultLook(db, foreignGraph);
  const otherOrg = await seedGraph(db);
  const before = await snapshot(db);
  const bound = bindCast(db, graph);
  await expect(
    bound.sync(graph.sequenceId, foreign.id, ANALYSED)
  ).rejects.toThrow();
  await expect(
    bound.link(graph.sequenceId, foreign.id, ANALYSED)
  ).rejects.toThrow();
  await expect(
    bound.sync(graph.sequenceId, otherOrg.character.id, ANALYSED)
  ).rejects.toThrow();
  expect(await snapshot(db)).toEqual(before);
});

it.each(['attached', 'archived and removed elsewhere'] as const)(
  'preserves %s sharing and only adds missing looks',
  async (sharing) => {
    if (sharing === 'attached')
      await db
        .update(sequenceCast)
        .set({ attached: true })
        .where(eq(sequenceCast.characterId, graph.character.id));
    else await shareWithArchivedSequence(db, graph);
    const bound = bindCast(db, graph);
    const created = await bound.create(
      input(graph.sequenceId, {
        age: 'older',
        standardClothing: 'changed',
        sheetStatus: 'generating',
      }),
      OPTIONS
    );
    expect(created.selectedBibleVersionId).toBe(
      graph.character.selectedBibleVersionId
    );
    const before = await requireLook(
      db,
      graph.organizationId,
      graph.character.id
    );
    await bound.sync(graph.sequenceId, graph.character.id, ANALYSED);
    expect(
      await requireLook(db, graph.organizationId, graph.character.id)
    ).toEqual(before);
    expect(
      (await requireLook(db, graph.organizationId, graph.retireId)).deletedAt
    ).toBeNull();
  }
);

it('leaves shared removed links removed and allocates a new script id', async () => {
  await shareWithArchivedSequence(db, graph);
  await db
    .update(sequenceCast)
    .set({ removedAt: DATE })
    .where(eq(sequenceCast.id, graph.character.castId));
  const created = await bindCast(db, graph).create(
    input(graph.sequenceId),
    OPTIONS
  );
  expect(created.id).not.toBe(graph.character.id);
  expect(created.characterId).toBe('char_001_2');
  const [link] = await db
    .select()
    .from(sequenceCast)
    .where(eq(sequenceCast.id, graph.character.castId));
  expect(link?.removedAt).toEqual(DATE);
});

it('retains the ordinary standalone, claims and voice-history contract', async () => {
  await replaceOwner(db, graph);
  const cast = createCharactersMethods(db, graph.organizationId);
  const looks = createCharacterLooksMethods(db, graph.organizationId);
  const updated = await cast.create(
    input(graph.sequenceId, {
      age: 'older',
      voiceDescription: 'ordinary voice',
    }),
    OPTIONS
  );
  expect(updated.voiceDescription).toBe('ordinary voice');
  const look = await looks.ensureDefault(graph.character.id);
  const claim = await looks.claimSheet(
    look.id,
    {
      lookVersionId: look.lookVersionId,
      bibleVersionId: updated.selectedBibleVersionId,
    },
    { markGenerating: true, activity: null }
  );
  expect(claim.held).toBe(true);
  const voices = await db
    .select()
    .from(characterVoiceVersions)
    .where(eq(characterVoiceVersions.characterId, graph.character.id));
  expect(voices).toHaveLength(1);
  const before = await history(db);
  await cast.create(
    input(graph.sequenceId, {
      age: 'older',
      voiceDescription: 'ignored incoming replacement',
    }),
    OPTIONS
  );
  expect(await history(db)).toEqual(before);
});

it('fences retirement after earlier look versions and revival were authorized', async () => {
  const SKIP_REVIVAL = 1;
  const race = replaceBefore(
    db,
    graph,
    /^update "character_looks" set "deleted_at"/i,
    SKIP_REVIVAL
  );
  await expect(
    bindCast(db, graph).sync(graph.sequenceId, graph.character.id, ANALYSED)
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(race().ran).toBe(true);
  expect(await snapshot(db)).toEqual(race().expected);
  expect(
    (await requireLook(db, graph.organizationId, graph.retireId)).deletedAt
  ).toBeNull();
});

it('fences the shared-character status update without revoking claims', async () => {
  await shareWithArchivedSequence(db, graph);
  const race = replaceBefore(db, graph, /^update "character_looks"/i);
  await expect(
    bindCast(db, graph).create(
      input(graph.sequenceId, { sheetStatus: 'generating' }),
      OPTIONS
    )
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(race()).toMatchObject({ ran: true, prechecked: true });
  expect(await snapshot(db)).toEqual(race().expected);
  expect(
    await requireLook(db, graph.organizationId, graph.character.id)
  ).toMatchObject({
    sheetStatus: 'pending',
    pendingPromoteSheetVersionId: graph.claimId,
  });
});

it.each(['claim', 'generating', 'sheet pointer', 'person authored'] as const)(
  'keeps a stale look with %s',
  async (reason) => {
    if (reason === 'person authored') {
      await db.insert(characterLookVersions).values({
        lookId: graph.retireId,
        name: 'Old manual version',
        source: 'edit',
        clothing: 'manual suit',
      });
    } else {
      const patch =
        reason === 'claim'
          ? { pendingPromoteSheetVersionId: generateId() }
          : reason === 'generating'
            ? { sheetStatus: 'generating' as const }
            : { selectedSheetVersionId: generateId() };
      await db
        .update(characterLooks)
        .set(patch)
        .where(eq(characterLooks.id, graph.retireId));
    }
    await bindCast(db, graph).sync(
      graph.sequenceId,
      graph.character.id,
      ANALYSED
    );
    expect(
      (await requireLook(db, graph.organizationId, graph.retireId)).deletedAt
    ).toBeNull();
  }
);

it('fences direct helper versions, legacy migration and claims for foreign parents', async () => {
  const other = await seedGraph(db);
  const foreign = await requireLook(
    db,
    other.organizationId,
    other.character.id
  );
  const before = await snapshot(db);
  const result = await lookDefinitionWrite(
    db,
    foreign,
    { styling: 'overwrite' },
    { ...OPTIONS, sequenceId: graph.sequenceId },
    bindCast(db, graph).scope
  );
  const [first, ...rest] = result.statements;
  if (!first) throw new Error('Synthetic edit must produce statements');
  await db.batch([first, ...rest]);
  expect(await snapshot(db)).toEqual(before);
});

it('keeps a stale analysis look worn by a selected real scene version', async () => {
  await wearRetiredLook(db, graph);
  await bindCast(db, graph).sync(
    graph.sequenceId,
    graph.character.id,
    ANALYSED
  );
  expect(
    (await requireLook(db, graph.organizationId, graph.retireId)).deletedAt
  ).toBeNull();
});

it('keeps storage failures as failures while the owner remains active', async () => {
  await db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT} BEFORE INSERT ON character_bible_versions BEGIN SELECT RAISE(ABORT, '${SQL_FAILURE}'); END`
    )
  );
  const before = await snapshot(db);
  const result = bindCast(db, graph).create(
    input(graph.sequenceId, { age: 'older' }),
    OPTIONS
  );
  await expect(result).rejects.toThrow(SQL_FAILURE);
  expect(await snapshot(db)).toEqual(before);
});

it('revives its own removed cast and organization character without changing its bible', async () => {
  await db
    .update(sequenceCast)
    .set({ removedAt: DATE })
    .where(eq(sequenceCast.id, graph.character.castId));
  await db
    .update(characters)
    .set({ deletedAt: DATE })
    .where(eq(characters.id, graph.character.id));
  const result = await bindCast(db, graph).create(
    input(graph.sequenceId),
    OPTIONS
  );
  expect(result).toMatchObject({
    id: graph.character.id,
    deletedAt: null,
    selectedBibleVersionId: graph.character.selectedBibleVersionId,
  });
  const [row] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, graph.character.id));
  expect(row?.deletedAt).toBeNull();
  expect(
    await requireLook(db, graph.organizationId, graph.character.id)
  ).toMatchObject({ pendingPromoteSheetVersionId: graph.claimId });
});

it('fills a missing supplied voice once and retains the original authorized voice', async () => {
  const voiceId = 'seed:synthetic-original';
  const bound = bindCast(db, graph);
  const first = await bound.create(
    input(graph.sequenceId, { voiceId, voiceDescription: 'Synthetic voice' }),
    OPTIONS
  );
  expect(first).toMatchObject({ voiceId, voiceDescription: 'Synthetic voice' });
  const before = await history(db);
  const second = await bound.create(
    input(graph.sequenceId, {
      voiceId: 'seed:synthetic-replacement',
      voiceDescription: 'Replacement',
    }),
    OPTIONS
  );
  expect(second).toMatchObject({
    voiceId,
    voiceDescription: 'Synthetic voice',
  });
  expect(await history(db)).toEqual(before);
});

it('keeps independent organization creation and no-sequence edits unbound', async () => {
  await replaceOwner(db, graph);
  const actorId = generateId();
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic writer',
    email: actorId + '@example.invalid',
  });
  const cast = createCharactersMethods(db, graph.organizationId);
  const created = await cast.createForOrganization(
    {
      name: 'Independent',
      rendering: graph.character.rendering,
      standardClothing: 'coat',
    },
    { createdBy: actorId }
  );
  const updated = await cast.updateBible(
    null,
    created.id,
    { age: 'older', standardClothing: 'new coat' },
    { source: 'edit', actorId }
  );
  expect(updated).toMatchObject({ age: 'older', standardClothing: 'new coat' });
  const links = await db
    .select()
    .from(sequenceCast)
    .where(eq(sequenceCast.characterId, created.id));
  expect(links).toHaveLength(0);
  const events = await db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.targetId, created.id));
  expect(events).toHaveLength(0);
});

it('links more than three new looks in one atomic batch within D1 parameter limits', async () => {
  const batch = vi.spyOn(db.$client, 'batch');
  const ids = await bindCast(db, graph).link(
    graph.sequenceId,
    graph.character.id,
    BULK_LOOKS
  );
  expect(Object.keys(ids)).toHaveLength(BULK_LOOK_COUNT);
  expect(batch).toHaveBeenCalledOnce();
  expect(batch.mock.calls[0]?.[0]).toHaveLength(
    BULK_LOOK_COUNT * STATEMENTS_PER_NEW_LOOK
  );
  for (const definition of BULK_LOOKS) {
    const look = await requireLook(
      db,
      graph.organizationId,
      ids[definition.lookId] ?? ''
    );
    expect(look).toMatchObject({
      name: definition.name,
      clothing: definition.clothing,
      sheetStatus: 'pending',
    });
  }
});

it('rolls back every new look when the last version in the multi-look batch fails', async () => {
  const lastName = BULK_LOOKS.at(-1)?.name;
  if (!lastName) throw new Error('Missing synthetic last look');
  await db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT} BEFORE INSERT ON character_look_versions WHEN NEW.name = '${lastName}' BEGIN SELECT RAISE(ABORT, '${SQL_FAILURE}'); END`
    )
  );
  const before = await snapshot(db);
  const batch = vi.spyOn(db.$client, 'batch');
  await expect(
    bindCast(db, graph).link(graph.sequenceId, graph.character.id, BULK_LOOKS)
  ).rejects.toThrow(SQL_FAILURE);
  expect(batch).toHaveBeenCalledOnce();
  expect(batch.mock.calls[0]?.[0]).toHaveLength(
    BULK_LOOK_COUNT * STATEMENTS_PER_NEW_LOOK
  );
  expect(await snapshot(db)).toEqual(before);
});
