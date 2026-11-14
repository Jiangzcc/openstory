import { eq, sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import {
  characterBibleVersions,
  characterLooks,
  characterLookVersions,
  characters,
  locationBibleVersions,
  locations,
  organization,
  sequenceCast,
  sequenceLocationLinks,
  sequences,
  styles,
} from '@/platform/server/db/schema';
import type { NewSequenceElement } from '@/platform/server/db/schema';
import { STORYBOARD_WORKFLOW_STATUS } from './storyboard-owner';

// Synthetic parents and payloads; migrations and SQL use the real test D1 adapter.
export const COUNT = { none: 0, one: 1, checks: 2 } as const;
export const STATUS = {
  ...STORYBOARD_WORKFLOW_STATUS,
  draft: 'draft',
} as const;
export const SOURCE = { source: 'analysis', createdBy: null } as const;
export const FIXTURE_DATE = new Date('2026-11-14T08:00:00.000Z');
export const NEXT_DATE = new Date('2026-11-14T08:01:00.000Z');
export const REPLACEMENT_RUN = 'synthetic-replacement-storyboard';
const LOOK_NAME = 'Synthetic original look';
const SHEET_STATUS = { pending: 'pending' } as const;
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const SQL_TARGET = {
  ownership: /^select "id" from "sequences" where /i,
  element: /^insert into "sequence_elements"/i,
} as const;
export const SQL_FAULT = {
  trigger: 'synthetic_storyboard_cast_element_fault',
  message: 'Synthetic storyboard element INSERT refused',
} as const;
export const ENGINE_ABORT = 'Aborting engine: Grace period complete';
export const TARGET_ERROR =
  'Cast write target is outside the Storyboard sequence';
export type Cast = ReturnType<ScopedDb['storyboardCast']>;
export type Graph = Awaited<ReturnType<typeof seedCastGraph>>;
export type Parents = Awaited<ReturnType<typeof seedParents>>;
type Root = Awaited<ReturnType<typeof seedRoot>>;
type RootPatch = Partial<typeof sequences.$inferInsert>;

export const ROOT_LOSSES = [
  {
    name: 'replacement root',
    patch: () => ({ workflowRunId: REPLACEMENT_RUN }),
  },
  { name: 'cleared root', patch: () => ({ workflowRunId: null }) },
  { name: 'failed root', patch: () => ({ status: STATUS.failed }) },
  { name: 'completed root', patch: () => ({ status: STATUS.completed }) },
  { name: 'draft root', patch: () => ({ status: STATUS.draft }) },
  {
    name: 'undeclared raw claim',
    patch: (graph: Graph) => ({ workflowRunId: graph.rawClaimId }),
  },
  {
    name: 'foreign organization',
    patch: (graph: Graph) => ({ organizationId: graph.foreign.organizationId }),
  },
] satisfies Array<{ name: string; patch: (graph: Graph) => RootPatch }>;

async function seedSpace(db: Database) {
  const organizationId = generateId();
  const styleId = generateId();
  const [template] = DEFAULT_STYLE_TEMPLATES;
  if (!template) throw new Error('Synthetic cast fixture needs a style');
  await db.insert(organization).values({
    id: organizationId,
    slug: organizationId,
    name: 'Synthetic cast organization',
  });
  await db.insert(styles).values({
    id: styleId,
    organizationId,
    name: 'Synthetic cast style',
    config: template.config,
  });
  return { organizationId, styleId };
}

async function seedRoot(
  db: Database,
  space: Awaited<ReturnType<typeof seedSpace>>
) {
  const sequenceId = generateId();
  const workflowRunId = 'synthetic-storyboard-' + generateId();
  await db.insert(sequences).values({
    ...space,
    id: sequenceId,
    workflowRunId,
    title: 'Synthetic cast sequence',
    status: STATUS.processing,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
  });
  return { ...space, sequenceId, workflowRunId, rawClaimId: generateId() };
}

export async function seedCastGraph(db: Database) {
  const space = await seedSpace(db);
  const foreignSpace = await seedSpace(db);
  const own = await seedRoot(db, space);
  const sibling = await seedRoot(db, space);
  const foreign = await seedRoot(db, foreignSpace);
  return { ...own, sibling, foreign, userId: generateId() };
}

async function seedCharacter(db: Database, organizationId: string) {
  const characterId = generateId();
  const bibleId = generateId();
  const lookVersionId = generateId();
  await db.insert(characters).values({
    id: characterId,
    organizationId,
    legacyName: 'Synthetic original character',
    selectedBibleVersionId: bibleId,
  });
  await db.insert(characterBibleVersions).values({
    id: bibleId,
    characterId,
    name: 'Synthetic original character',
    voiceOnly: false,
    isPerson: false,
    rendering: PHOTOREAL_RENDERING,
    ...SOURCE,
  });
  await db.insert(characterLooks).values({
    id: characterId,
    characterId,
    isDefault: true,
    sortOrder: COUNT.none,
    selectedLookVersionId: lookVersionId,
    sheetStatus: SHEET_STATUS.pending,
  });
  await db.insert(characterLookVersions).values({
    id: lookVersionId,
    lookId: characterId,
    name: LOOK_NAME,
    clothing: 'Synthetic original coat',
    styling: 'Synthetic original hair',
    ...SOURCE,
  });
  return { characterId, lookId: characterId, lookVersionId };
}

async function seedLocation(db: Database, organizationId: string) {
  const locationId = generateId();
  const bibleId = generateId();
  await db.insert(locations).values({
    id: locationId,
    organizationId,
    legacyName: 'Synthetic original location',
    selectedBibleVersionId: bibleId,
  });
  await db.insert(locationBibleVersions).values({
    id: bibleId,
    locationId,
    name: 'Synthetic original location',
    rendering: PHOTOREAL_RENDERING,
    ...SOURCE,
  });
  return locationId;
}

export async function seedParents(
  db: Database,
  root: Pick<Root, 'organizationId' | 'sequenceId'>,
  linked = true,
  removedAt: Date | null = null
) {
  const character = await seedCharacter(db, root.organizationId);
  const locationId = await seedLocation(db, root.organizationId);
  const scriptCharacterId = 'synthetic-character-' + character.characterId;
  const scriptLocationId = 'synthetic-location-' + locationId;
  if (linked) {
    await db.insert(sequenceCast).values({
      sequenceId: root.sequenceId,
      characterId: character.characterId,
      scriptCharacterId,
      removedAt,
    });
    await db.insert(sequenceLocationLinks).values({
      sequenceId: root.sequenceId,
      locationId,
      scriptLocationId,
      removedAt,
      attached: false,
    });
  }
  return { ...character, locationId, scriptCharacterId, scriptLocationId };
}

export async function seedAlternateLook(db: Database, parent: Parents) {
  const lookId = generateId();
  const lookVersionId = generateId();
  await db.insert(characterLooks).values({
    id: lookId,
    characterId: parent.characterId,
    isDefault: false,
    sortOrder: COUNT.one,
    selectedLookVersionId: lookVersionId,
    sheetStatus: SHEET_STATUS.pending,
  });
  await db.insert(characterLookVersions).values({
    id: lookVersionId,
    lookId,
    name: 'Synthetic alternate look',
    ...SOURCE,
  });
  return { ...parent, lookId, lookVersionId };
}

export function ownerFor(graph: Root) {
  return { id: graph.sequenceId, workflowRunId: graph.workflowRunId };
}

export function setRoot(db: Database, graph: Root, patch: RootPatch) {
  return db
    .update(sequences)
    .set(patch)
    .where(eq(sequences.id, graph.sequenceId));
}

export function elementInput(
  graph: Pick<Root, 'sequenceId'>
): NewSequenceElement {
  return {
    sequenceId: graph.sequenceId,
    uploadedFilename: '合成参考 "ELEMENT".png',
    token: 'SYNTHETIC_ELEMENT',
  };
}

export function characterInput(root: Root, parent: Parents) {
  return {
    sequenceId: root.sequenceId,
    characterId: parent.scriptCharacterId,
    name: 'Synthetic changed character',
    rendering: PHOTOREAL_RENDERING,
    standardClothing: 'Synthetic changed coat',
    voiceOnly: false,
    isPerson: false,
  };
}

export function locationInput(root: Root, parent: Parents) {
  return {
    sequenceId: root.sequenceId,
    locationId: parent.scriptLocationId,
    name: 'Synthetic changed location',
    rendering: PHOTOREAL_RENDERING,
    boundTo: null,
  };
}

export function analysedLook(parent: Parents) {
  return {
    lookId: parent.lookId,
    name: LOOK_NAME,
    clothing: 'Synthetic changed coat',
    styling: 'Synthetic changed hair',
  };
}

const SNAPSHOT_TABLES = [
  'sequences',
  'characters',
  'character_bible_versions',
  'character_looks',
  'character_look_versions',
  'character_voice_versions',
  'character_sheet_variants',
  'sequence_cast',
  'sequence_locations',
  'location_bible_versions',
  'sequence_location_links',
  'location_reference_photos',
  'sequence_elements',
  'sequence_events',
] as const;

export async function castSnapshot(db: Database) {
  const rows = await Promise.all(
    SNAPSHOT_TABLES.map((table) =>
      db.all(sql.raw(`SELECT * FROM "${table}" ORDER BY id`))
    )
  );
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table, index) => [table, rows[index]])
  );
}

// Explicit transport substitute; it never substitutes rows or D1 batch semantics.
function beforeExecution(
  statement: D1PreparedStatement,
  before: () => Promise<void>
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, key) {
      if (key === 'bind')
        return (...values: unknown[]) =>
          beforeExecution(target.bind(...values), before);
      if (key === 'raw')
        return async () => {
          await before();
          return target.raw();
        };
      if (key === 'all')
        return async () => {
          await before();
          return target.all();
        };
      if (key === 'run')
        return async () => {
          await before();
          return target.run();
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function interceptSql(
  db: Database,
  match: RegExp,
  before: () => Promise<void>,
  ordinal: number = COUNT.one
) {
  let executions: number = COUNT.none;
  const prepare = db.$client.prepare.bind(db.$client);
  const onExecute = async () => {
    executions += COUNT.one;
    if (executions === ordinal) await before();
  };
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) => {
    const statement = prepare(query);
    return match.test(query)
      ? beforeExecution(statement, onExecute)
      : statement;
  });
  return () => executions;
}

export function failElementInsert(db: Database) {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT.trigger} BEFORE INSERT ON sequence_elements ` +
        `BEGIN SELECT RAISE(ABORT, '${SQL_FAULT.message}'); END`
    )
  );
}

export async function failureFrom(
  write: () => Promise<unknown>
): Promise<Error> {
  try {
    await write();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Expected the synthetic cast operation to reject');
}
