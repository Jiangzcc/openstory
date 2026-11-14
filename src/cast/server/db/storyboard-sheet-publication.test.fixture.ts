import { eq, sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  characterLooks,
  characterSheetVariants,
  locationSheetVariants,
  locations,
  sequenceEvents,
} from '@/platform/server/db/schema';
import {
  castSnapshot,
  seedAlternateLook,
  seedCastGraph,
  seedParents,
} from '@/sequences/server/db/storyboard-cast.test.fixture';
import type { Parents } from '@/sequences/server/db/storyboard-cast.test.fixture';
import { createStoryboardSheetScope } from '@/sequences/server/db/storyboard-sheet-scope';
import type { StoryboardCastScope } from '@/sequences/server/db/storyboard-cast-scope';
import type { StoryboardOwner } from '@/sequences/server/db/storyboard-owner';
import {
  characterSheetInputHash,
  locationSheetInputHash,
} from '@/shots/input-hash';
import { createCharacterSheetVariantsMethods } from './character-sheet-variants';
import { createLocationSheetVariantsMethods } from './location-sheet-variants';

// Synthetic media and race scheduling; every mutation executes on migrated test D1.
export const KINDS = ['character', 'location'] as const;
export type Kind = (typeof KINDS)[number];
export const STATE = {
  generating: 'generating',
  completed: 'completed',
  failed: 'failed',
} as const;
export const COUNT = {
  none: 0,
  one: 1,
  two: 2,
  boundLimit: 100,
  bareBatch: 5,
  eventBatch: 6,
} as const;
export const MEDIA = {
  url: '/r2/synthetic/参考 "图".png',
  storagePath: 'synthetic/参考 "图".png',
};
export const FAULT = 'Synthetic sheet publication SQL fault';
export const TABLE = {
  character: {
    parent: 'character_looks',
    version: 'character_sheet_variants',
    pointer: 'selected_sheet_version_id',
  },
  location: {
    parent: 'sequence_locations',
    version: 'location_sheet_variants',
    pointer: 'selected_reference_version_id',
  },
} as const;
const TRIGGERS = [
  'synthetic_sheet_publication_race',
  'synthetic_sheet_publication_probe',
  'synthetic_sheet_publication_fault',
] as const;
export type Graph = Awaited<ReturnType<typeof seedSheetGraph>>;
export type Input = ReturnType<typeof sheetInput>;

export async function seedSheetGraph(db: Database) {
  const root = await seedCastGraph(db);
  const target = await seedParents(db, root);
  const alternate = await seedAlternateLook(db, target);
  const other = await seedParents(db, root);
  const siblingTarget = await seedParents(db, root.sibling);
  const foreignTarget = await seedParents(db, root.foreign);
  const unlinked = await seedParents(db, root, false);
  return {
    ...root,
    target,
    alternate,
    other,
    siblingTarget,
    foreignTarget,
    unlinked,
  };
}

export function scopeFor(
  db: Database,
  graph: Graph,
  patch: Partial<StoryboardOwner> = {}
) {
  return createStoryboardSheetScope(db, graph.organizationId, {
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
    ...patch,
  });
}

export function sheetInput(graph: Graph, target: Parents = graph.target) {
  const versionId = generateId();
  const common = {
    versionId,
    claimed: true,
    ...MEDIA,
    bibleVersionId: generateId(),
    model: 'synthetic-model',
    workflowRunId: 'synthetic-child-' + generateId(),
  };
  const activity = {
    sequenceId: graph.sequenceId,
    actorId: null,
    summary: '合成参考："保留"\n第二行',
  };
  return {
    character: {
      ...common,
      characterId: target.characterId,
      lookId: target.lookId,
      lookVersionId: target.lookVersionId,
      inputHash: characterSheetInputHash('a'.repeat(64)),
      activity: {
        ...activity,
        targetType: 'character' as const,
        targetId: target.characterId,
      },
    },
    location: {
      ...common,
      locationId: target.locationId,
      inputHash: locationSheetInputHash('b'.repeat(64)),
      activity: {
        ...activity,
        targetType: 'location' as const,
        targetId: target.locationId,
      },
    },
  };
}

export function publish(
  db: Database,
  graph: Graph,
  kind: Kind,
  input: Input,
  scope?: StoryboardCastScope
) {
  return kind === 'character'
    ? createCharacterSheetVariantsMethods(
        db,
        graph.organizationId,
        scope
      ).promoteIfPending(input.character)
    : createLocationSheetVariantsMethods(
        db,
        graph.organizationId,
        scope
      ).promoteIfPending(input.location);
}

export function setClaim(
  db: Database,
  kind: Kind,
  target: Parents,
  versionId: string | null
) {
  return kind === 'character'
    ? db
        .update(characterLooks)
        .set({
          pendingPromoteSheetVersionId: versionId,
          sheetStatus: STATE.generating,
          sheetError: FAULT,
        })
        .where(eq(characterLooks.id, target.lookId))
    : db
        .update(locations)
        .set({
          pendingPromoteReferenceVersionId: versionId,
          referenceStatus: STATE.generating,
          referenceError: FAULT,
        })
        .where(eq(locations.id, target.locationId));
}

export async function state(db: Database, kind: Kind, target: Parents) {
  if (kind === 'character') {
    const [row] = await db
      .select()
      .from(characterLooks)
      .where(eq(characterLooks.id, target.lookId));
    if (!row) throw new Error('Missing synthetic look');
    return {
      selected: row.selectedSheetVersionId,
      claim: row.pendingPromoteSheetVersionId,
      status: row.sheetStatus,
      error: row.sheetError,
    };
  }
  const [row] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, target.locationId));
  if (!row) throw new Error('Missing synthetic location');
  return {
    selected: row.selectedReferenceVersionId,
    claim: row.pendingPromoteReferenceVersionId,
    status: row.referenceStatus,
    error: row.referenceError,
  };
}

export async function versions(db: Database, kind: Kind) {
  return kind === 'character'
    ? db
        .select()
        .from(characterSheetVariants)
        .orderBy(characterSheetVariants.id)
    : db.select().from(locationSheetVariants).orderBy(locationSheetVariants.id);
}

export async function snapshot(db: Database) {
  return {
    ...(await castSnapshot(db)),
    location_sheet_variants: await db
      .select()
      .from(locationSheetVariants)
      .orderBy(locationSheetVariants.id),
  };
}

export function events(db: Database, graph: Graph) {
  return db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.sequenceId, graph.sequenceId));
}

export function beforeBatch(db: Database, before: () => Promise<unknown>) {
  const batch = db.$client.batch.bind(db.$client);
  return vi
    .spyOn(db.$client, 'batch')
    .mockImplementationOnce(async (statements) => {
      await before();
      return batch(statements);
    });
}

export function trigger(
  db: Database,
  index: 0 | 1 | 2,
  on: string,
  body: string
) {
  return db.run(
    sql.raw(`CREATE TRIGGER ${TRIGGERS[index]} ${on} BEGIN ${body}; END`)
  );
}

export async function dropTriggers(db: Database) {
  for (const name of TRIGGERS)
    await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${name}`));
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
  throw new Error('Expected synthetic sheet publication to reject');
}

export function errorChain(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message + (error.cause ? '\n' + errorChain(error.cause) : '');
}
