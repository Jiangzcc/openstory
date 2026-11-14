import { eq, sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import type { NewCharacter } from '@/platform/server/db/schema';
import {
  characterBibleVersions,
  characterLooks,
  characterLookVersions,
  characters,
  organization,
  scenes,
  sceneScriptVersions,
  sequenceCast,
  sequences,
  styles,
} from '@/platform/server/db/schema';
import { createStoryboardCastScope } from '@/sequences/server/db/storyboard-cast-scope';
import { checkedStoryboardContentWrite } from '@/sequences/server/db/storyboard-content-writes';
import { createCharactersMethods } from './characters';
import { createCharacterLooksMethods } from './character-looks';
import { dbSceneId } from '@/shots/scene-id';

// Synthetic cast graph; all statements run through the migrated SQLite D1 adapter.
export const OPTIONS = { source: 'analysis', createdBy: null } as const;
export const DATE = new Date('2026-11-14T01:00:00Z');
const LOOKS = [
  { lookId: 'default', name: 'Default', clothing: 'coat', styling: '' },
  { lookId: 'retire', name: 'Retire', clothing: 'suit', styling: '' },
  { lookId: 'revive', name: 'Revive', clothing: 'dress', styling: '' },
];
export const ANALYSED = [
  { lookId: 'default', name: 'Default', clothing: 'coat', styling: 'new hair' },
  { lookId: 'revive', name: 'Revive', clothing: 'new dress', styling: '' },
  {
    lookId: 'new',
    name: 'New outfit',
    clothing: '羽绒服\n"白色"',
    styling: '',
  },
];
export const BULK_LOOK_COUNT = 7;
export const STATEMENTS_PER_NEW_LOOK = 2;
export const BULK_LOOKS = Array.from(
  { length: BULK_LOOK_COUNT },
  (_, index) => ({
    lookId: `bulk_${index}`,
    name: `Synthetic outfit ${index}`,
    clothing: `Synthetic coat ${index}`,
    styling: '',
  })
);
const TABLES = [
  'characters',
  'character_bible_versions',
  'sequence_cast',
  'character_looks',
  'character_look_versions',
  'character_voice_versions',
  'character_sheet_variants',
  'sequence_events',
] as const;
export type Graph = Awaited<ReturnType<typeof seedGraph>>;
type Bound = ReturnType<typeof bindCast>;
export type Mutation = {
  name: string;
  write: (bound: Bound, graph: Graph) => Promise<unknown>;
};

export async function seedSpace(db: Database) {
  const organizationId = generateId();
  const styleId = generateId();
  const [template] = DEFAULT_STYLE_TEMPLATES;
  if (!template) throw new Error('Missing synthetic fixture style');
  await db.insert(organization).values({
    id: organizationId,
    slug: organizationId,
    name: 'Synthetic cast',
  });
  await db.insert(styles).values({
    id: styleId,
    organizationId,
    name: 'Synthetic style',
    config: template.config,
  });
  return { organizationId, styleId };
}

export async function seedSequence(
  db: Database,
  space: Awaited<ReturnType<typeof seedSpace>>
) {
  const sequenceId = generateId();
  const workflowRunId = 'synthetic-cast-' + generateId();
  await db.insert(sequences).values({
    id: sequenceId,
    organizationId: space.organizationId,
    styleId: space.styleId,
    title: 'Synthetic storyboard cast',
    status: 'processing',
    workflowRunId,
  });
  return { ...space, sequenceId, workflowRunId };
}

export function input(
  sequenceId: string,
  patch: Partial<NewCharacter> = {}
): NewCharacter {
  return {
    sequenceId,
    characterId: 'char_001',
    name: 'Synthetic Ada',
    rendering: PHOTOREAL_RENDERING,
    standardClothing: 'coat',
    isPerson: true,
    ...patch,
  };
}

export async function seedGraph(db: Database) {
  const root = await seedSequence(db, await seedSpace(db));
  const cast = createCharactersMethods(db, root.organizationId);
  const looks = createCharacterLooksMethods(db, root.organizationId);
  const character = await cast.create(input(root.sequenceId), OPTIONS);
  const ids = await looks.syncFromAnalysis(
    root.sequenceId,
    character.id,
    LOOKS
  );
  const retireId = ids.retire;
  const reviveId = ids.revive;
  if (!retireId || !reviveId)
    throw new Error('Missing synthetic fixture looks');
  await db
    .update(characterLooks)
    .set({ deletedAt: DATE })
    .where(eq(characterLooks.id, reviveId));
  const claimId = generateId();
  await db
    .update(characterLooks)
    .set({ pendingPromoteSheetVersionId: claimId })
    .where(eq(characterLooks.id, character.id));
  await db
    .update(characterBibleVersions)
    .set({ legacyDistinguishingFeatures: 'old scar' })
    .where(eq(characterBibleVersions.id, character.selectedBibleVersionId));
  return { ...root, character, retireId, reviveId, claimId };
}

export function bindCast(
  db: Database,
  graph: Graph,
  organizationId = graph.organizationId
) {
  const scope = createStoryboardCastScope(db, organizationId, {
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
  });
  const cast = createCharactersMethods(db, organizationId, scope);
  const looks = createCharacterLooksMethods(db, organizationId, scope);
  return {
    create: checkedStoryboardContentWrite(scope, cast.create),
    sync: checkedStoryboardContentWrite(scope, looks.syncFromAnalysis),
    link: checkedStoryboardContentWrite(scope, looks.linkFromAnalysis),
    scope,
  };
}

export const MUTATIONS: Mutation[] = [
  {
    name: 'new character and incoming voice',
    write: (b, g) =>
      b.create(
        input(g.sequenceId, {
          characterId: 'char_new',
          voiceDescription: '温柔\n"自然"',
        }),
        OPTIONS
      ),
  },
  {
    name: 'bible, clothing, status, claims, events and incoming voice',
    write: (b, g) =>
      b.create(
        input(g.sequenceId, {
          age: '40',
          standardClothing: 'new coat',
          sheetStatus: 'generating',
          voiceDescription: 'new voice',
        }),
        OPTIONS
      ),
  },
  {
    name: 'look versions, legacy move, new look, revival and retirement',
    write: (b, g) => b.sync(g.sequenceId, g.character.id, ANALYSED),
  },
  {
    name: 'shared look linking',
    write: (b, g) => b.link(g.sequenceId, g.character.id, ANALYSED),
  },
];

export async function snapshot(db: Database) {
  const rows = await Promise.all(
    TABLES.map((table) =>
      db.all(sql.raw(`SELECT * FROM "${table}" ORDER BY id`))
    )
  );
  return Object.fromEntries(TABLES.map((table, index) => [table, rows[index]]));
}

export async function history(db: Database) {
  const rows = await snapshot(db);
  return {
    bibles: rows.character_bible_versions,
    looks: rows.character_look_versions,
    voices: rows.character_voice_versions,
    events: rows.sequence_events,
  };
}

export async function replaceOwner(db: Database, graph: Graph) {
  await db
    .update(sequences)
    .set({ workflowRunId: 'synthetic-replacement' })
    .where(eq(sequences.id, graph.sequenceId));
}

// Transport scheduling only: never interrupt D1's atomic batch or replace SQL results.
function scheduledStatement(
  statement: D1PreparedStatement,
  query: string,
  before: (queries: string[]) => Promise<void>,
  queries: WeakMap<D1PreparedStatement, string>
): D1PreparedStatement {
  const wrapped = new Proxy(statement, {
    get(target, key) {
      if (key === 'bind')
        return (...values: unknown[]) =>
          scheduledStatement(target.bind(...values), query, before, queries);
      if (key === 'raw')
        return async () => {
          await before([query]);
          return target.raw();
        };
      if (key === 'all')
        return async () => {
          await before([query]);
          return target.all();
        };
      if (key === 'run')
        return async () => {
          await before([query]);
          return target.run();
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  queries.set(wrapped, query);
  return wrapped;
}

export function scheduleTransport(
  db: Database,
  match: RegExp,
  action: () => Promise<void>,
  skipMatches = 0
) {
  const queries = new WeakMap<D1PreparedStatement, string>();
  const prepare = db.$client.prepare.bind(db.$client);
  const batch = db.$client.batch.bind(db.$client);
  let ran = false;
  let prechecked = false;
  let matches = 0;
  const before = async (sqlQueries: string[]) => {
    if (
      sqlQueries.some((query) => /^select "id" from "sequences"/i.test(query))
    )
      prechecked = true;
    if (ran || !sqlQueries.some((query) => match.test(query))) return;
    if (matches++ < skipMatches) return;
    ran = true;
    await action();
  };
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) =>
    scheduledStatement(prepare(query), query, before, queries)
  );
  vi.spyOn(db.$client, 'batch').mockImplementation(async (statements) => {
    await before(statements.map((statement) => queries.get(statement) ?? ''));
    return batch(statements);
  });
  return () => ({ ran, prechecked });
}

export function replaceBefore(
  db: Database,
  graph: Graph,
  match = /^(insert|update|delete)\b/i,
  skipMatches = 0
) {
  let expected: Awaited<ReturnType<typeof snapshot>> | undefined;
  const observed = scheduleTransport(
    db,
    match,
    async () => {
      await replaceOwner(db, graph);
      expected = await snapshot(db);
    },
    skipMatches
  );
  return () => ({ ...observed(), expected });
}

export async function removeDefaultLook(db: Database, graph: Graph) {
  await db
    .update(characterBibleVersions)
    .set({ legacyStandardClothing: 'legacy coat' })
    .where(
      eq(characterBibleVersions.id, graph.character.selectedBibleVersionId)
    );
  await db
    .delete(characterLookVersions)
    .where(eq(characterLookVersions.lookId, graph.character.id));
  await db
    .delete(characterLooks)
    .where(eq(characterLooks.id, graph.character.id));
  await db
    .update(characters)
    .set({
      legacyStandardClothing: 'legacy coat',
      legacySheetStatus: 'generating',
      legacyPendingPromoteSheetVersionId: graph.claimId,
    })
    .where(eq(characters.id, graph.character.id));
}

export async function shareWithArchivedSequence(db: Database, graph: Graph) {
  const other = await seedSequence(db, graph);
  await db
    .update(sequences)
    .set({ status: 'archived' })
    .where(eq(sequences.id, other.sequenceId));
  await db.insert(sequenceCast).values({
    sequenceId: other.sequenceId,
    characterId: graph.character.id,
    scriptCharacterId: 'archived_char',
    removedAt: DATE,
  });
  return other;
}

export async function wearRetiredLook(db: Database, graph: Graph) {
  const sceneId = dbSceneId(generateId());
  const versionId = generateId();
  await db.insert(scenes).values({
    id: sceneId,
    sequenceId: graph.sequenceId,
    orderIndex: 0,
    selectedScriptVersionId: versionId,
  });
  await db.insert(sceneScriptVersions).values({
    id: versionId,
    sceneId,
    source: 'split',
    content: { extract: 'Synthetic scene', dialogue: [] },
    continuity: {
      characterTags: ['char_001'],
      characterLooks: { char_001: graph.retireId },
      environmentTag: 'synthetic',
      elementTags: [],
      lightingSetup: 'Natural',
      styleTag: 'synthetic',
    },
  });
}
