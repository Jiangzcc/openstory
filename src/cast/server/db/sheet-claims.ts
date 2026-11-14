/**
 * Sheet claims (#1113): the pointer-claim contract for the four sheet
 * workflows. The trigger points a claim column on the parent row at the id the
 * run's result will carry; every write that changes a sheet input, or picks a
 * sheet, clears it; the run's completion promotes in one guarded batch and
 * parks its result as a divergent variant when the claim has moved.
 *
 * The demote builders here are statements, not calls, so a mutator puts them
 * in the SAME `db.batch` as its own write — the edit and the revocation land
 * together or not at all.
 */

import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type {
  AnySQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
  SQLiteUpdateSetSource,
} from 'drizzle-orm/sqlite-core';
import type { Database } from '@/platform/server/db/client';
import type { StoryboardCastScope } from '@/sequences/server/db/storyboard-cast-scope';
import { insertWithStoryboardGuard } from '@/sequences/server/db/storyboard-content-scope';
import { generateId } from '@/platform/id';
import {
  buildEventInsertIfPresent,
  eventNotLogged,
} from '@/sequences/server/db/sequence-events';
import type { SequenceEventTargetType } from '@/platform/server/db/schema';
import {
  characterLooks,
  characterSheetVariants,
  characters,
  locationSheetVariants,
  locations,
} from '@/platform/server/db/schema';
import type {
  CharacterSheetInputHash,
  LocationSheetInputHash,
} from '@/shots/input-hash';

/**
 * Clear the sheet claim of every look (#2015) of the characters matching
 * `where`, a condition on `characters`: the bible and the style feed all
 * of a character's sheets.
 */
export const demoteCharacterSheetClaims = (db: Database, where: SQL) =>
  db
    .update(characterLooks)
    .set({ pendingPromoteSheetVersionId: null })
    .where(
      and(
        isNotNull(characterLooks.pendingPromoteSheetVersionId),
        inArray(
          characterLooks.characterId,
          db.select({ id: characters.id }).from(characters).where(where)
        )
      )
    );

export type SheetLanding = 'promoted' | 'parked';

type LandArgs<H> = {
  /** The claim id the trigger minted; becomes the version row's id. */
  versionId: string;
  /**
   * False for a run queued before #1113: it holds no claim, so it lands only
   * while no newer run holds one, and parks rather than revoke that claim.
   */
  claimed: boolean;
  url: string;
  storagePath: string;
  inputHash: H | null;
  /** The bible version the run read (#1600); null when unknown. */
  bibleVersionId: string | null;
  model: string;
  workflowRunId: string;
  /** The history line. Null for a run started from no sequence. */
  activity: {
    sequenceId: string;
    actorId: string | null;
    targetType: Extract<SequenceEventTargetType, 'character' | 'location'>;
    targetId: string;
    summary: string;
  } | null;
};

/** What {@link landSheetVersion} needs from one sheet entity's tables. */
type SheetLandSpec<P extends SQLiteTable, V extends SQLiteTable> = {
  /** Named in the not-found error. */
  entity: string;
  parent: P;
  isParent: SQL;
  /** The selection pointer and its claim column on the parent. */
  selected: AnySQLiteColumn;
  claim: AnySQLiteColumn;
  isGenerating: SQL;
  /** Pointer to the version, claim cleared, status completed. */
  promote: SQLiteUpdateSetSource<P>;
  /** Status completed, error cleared. */
  settle: SQLiteUpdateSetSource<P>;
  variants: V;
  version: SQLiteInsertValue<V>;
  versionIdColumn: AnySQLiteColumn;
  divergedAt: AnySQLiteColumn;
  park: SQLiteUpdateSetSource<V>;
  /** An identical divergent twin already parked (the partial unique index allows one). */
  twinParked: SQLWrapper;
  publication?: { target: SQL | undefined; version: SQL | undefined };
};

const SHEET_PUBLICATION_UNAVAILABLE =
  'Generated reference sheet is unavailable';
const SINGLE_PUBLICATION = 1;

function sheetPublication<P extends SQLiteTable, V extends SQLiteTable>(
  db: Database,
  spec: SheetLandSpec<P, V>,
  versionId: string
) {
  if (!spec.publication) return undefined;
  const target = exists(
    db
      .select({ one: sql`1` })
      .from(spec.parent)
      .where(and(spec.isParent, spec.publication.target))
  );
  const version = (relation?: SQL) =>
    db
      .select({ one: sql`1` })
      .from(spec.variants)
      .where(and(eq(spec.versionIdColumn, versionId), relation));
  const ownedVersion = exists(version(spec.publication.version));
  return {
    insert: and(target, or(notExists(version()), ownedVersion)),
    mutation: and(target, ownedVersion),
  };
}

function sheetPublicationAvailability(
  db: Database,
  available: SQL | undefined
) {
  return db
    .select({
      // Invalid JSON aborts every write in the batch when the target was lost.
      available: sql<number>`case when ${available} then 1
        else json(${SHEET_PUBLICATION_UNAVAILABLE}) end`,
    })
    .from(sql`(select 1) as sheet_publication_result`)
    .limit(SINGLE_PUBLICATION);
}

function sheetActivityWhere(
  scope: StoryboardCastScope,
  activity: LandArgs<unknown>['activity'],
  targetId: string,
  targetType: 'character' | 'location'
) {
  if (!activity) return undefined;
  return and(
    scope.sequence(activity.sequenceId),
    sql`${activity.targetId} = ${targetId}`,
    sql`${activity.targetType} = ${targetType}`
  );
}

function sheetGeneratedActivity<P extends SQLiteTable, V extends SQLiteTable>(
  db: Database,
  spec: SheetLandSpec<P, V>,
  args: Pick<LandArgs<unknown>, 'versionId' | 'activity'>,
  publication?: SQL
) {
  const { activity, versionId } = args;
  if (!activity) return undefined;
  return buildEventInsertIfPresent(
    db,
    {
      id: generateId(),
      sequenceId: activity.sequenceId,
      actorId: activity.actorId,
      kind: 'sheet.generated',
      targetType: activity.targetType,
      targetId: activity.targetId,
      summary: activity.summary,
      data: { sheetVersionId: versionId },
    },
    spec.parent,
    and(
      spec.isParent,
      publication,
      eventNotLogged(
        db,
        activity.sequenceId,
        'sheet.generated',
        'sheetVersionId',
        versionId
      )
    )
  );
}

/**
 * The one sheet landing batch (#1113, #1865): append the version row under the
 * claimed id, then move the pointer ONLY while the claim still names it. A
 * missed claim parks the row as divergent (unless an identical divergent twin
 * is already parked). The status settles to `completed` only when no newer run
 * holds the pointer.
 *
 * Retry-safe: the insert is keyed on the claimed id, and the outcome is read
 * from the pointer, not from whether this attempt's UPDATE matched.
 */
async function landSheetVersion<P extends SQLiteTable, V extends SQLiteTable>(
  db: Database,
  spec: SheetLandSpec<P, V>,
  args: Pick<LandArgs<unknown>, 'versionId' | 'claimed' | 'activity'>
): Promise<SheetLanding> {
  const { versionId, claimed } = args;
  const publication = sheetPublication(db, spec, versionId);
  const insertVersion = insertWithStoryboardGuard(
    db,
    spec.variants,
    [spec.version],
    publication?.insert
  ).onConflictDoNothing();
  const promote = db
    .update(spec.parent)
    .set(spec.promote)
    .where(
      and(
        spec.isParent,
        publication?.mutation,
        claimed ? eq(spec.claim, versionId) : isNull(spec.claim)
      )
    );
  const park = db
    .update(spec.variants)
    .set(spec.park)
    .where(
      and(
        eq(spec.versionIdColumn, versionId),
        publication?.mutation,
        isNull(spec.divergedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(spec.parent)
            .where(and(spec.isParent, eq(spec.selected, versionId)))
        ),
        notExists(spec.twinParked)
      )
    );
  const settle = db
    .update(spec.parent)
    .set(spec.settle)
    .where(
      and(
        spec.isParent,
        publication?.mutation,
        isNull(spec.claim),
        spec.isGenerating
      )
    );
  const read = db
    .select({ selected: spec.selected })
    .from(spec.parent)
    .where(spec.isParent);
  const activity = sheetGeneratedActivity(
    db,
    spec,
    args,
    publication?.mutation
  );
  const results = await db.batch([
    insertVersion,
    promote,
    park,
    settle,
    read,
    ...(activity ? [activity] : []),
    ...(publication
      ? [sheetPublicationAvailability(db, publication.mutation)]
      : []),
  ]);
  const row = results[4][0];
  if (!row) throw new Error(`${spec.entity} not found`);
  return row.selected === versionId ? 'promoted' : 'parked';
}

/** The version row's columns both variant tables share. */
const versionRow = <H>(args: LandArgs<H>, now: Date) => ({
  id: args.versionId,
  model: args.model,
  url: args.url,
  storagePath: args.storagePath,
  status: 'completed' as const,
  workflowRunId: args.workflowRunId,
  generatedAt: now,
  inputHash: args.inputHash,
  bibleVersionId: args.bibleVersionId,
});

/**
 * Land a look's sheet run (#2015): {@link landSheetVersion}, with the look
 * as the parent — it holds the pointer and the claim. The caller makes sure
 * the look row exists (`requireLook`).
 */
export function landCharacterSheet(
  db: Database,
  args: LandArgs<CharacterSheetInputHash> & {
    characterId: string;
    lookId: string;
    /** The look version the run read; null when unknown. */
    lookVersionId: string | null;
  },
  scope?: StoryboardCastScope
): Promise<SheetLanding> {
  const { characterId, lookId, versionId } = args;
  const now = new Date();
  const twin = alias(characterSheetVariants, 'twin');
  return landSheetVersion(
    db,
    {
      entity: `Look ${lookId}`,
      parent: characterLooks,
      isParent: scope
        ? sql`${eq(characterLooks.id, lookId)} and ${eq(characterLooks.characterId, characterId)}`
        : eq(characterLooks.id, lookId),
      publication: scope && {
        target: and(
          scope.look(lookId),
          sheetActivityWhere(scope, args.activity, characterId, 'character')
        ),
        version: and(
          eq(characterSheetVariants.characterId, characterId),
          eq(characterSheetVariants.lookId, lookId)
        ),
      },
      selected: characterLooks.selectedSheetVersionId,
      claim: characterLooks.pendingPromoteSheetVersionId,
      isGenerating: eq(characterLooks.sheetStatus, 'generating'),
      promote: {
        selectedSheetVersionId: versionId,
        pendingPromoteSheetVersionId: null,
        sheetStatus: 'completed',
        sheetError: null,
        updatedAt: now,
      },
      settle: { sheetStatus: 'completed', sheetError: null, updatedAt: now },
      variants: characterSheetVariants,
      version: {
        ...versionRow(args, now),
        characterId,
        lookId,
        lookVersionId: args.lookVersionId,
      },
      versionIdColumn: characterSheetVariants.id,
      divergedAt: characterSheetVariants.divergedAt,
      park: { divergedAt: now, updatedAt: now },
      twinParked: db
        .select({ one: sql`1` })
        .from(twin)
        .where(
          and(
            eq(twin.lookId, lookId),
            eq(twin.model, args.model),
            eq(twin.inputHash, sql`${characterSheetVariants.inputHash}`),
            isNotNull(twin.divergedAt)
          )
        ),
    },
    args
  );
}

/** Land a location reference run's result: {@link landSheetVersion}. */
export function landLocationReference(
  db: Database,
  organizationId: string,
  args: LandArgs<LocationSheetInputHash> & { locationId: string },
  scope?: StoryboardCastScope
): Promise<SheetLanding> {
  const { locationId, versionId } = args;
  const now = new Date();
  const twin = alias(locationSheetVariants, 'twin');
  return landSheetVersion(
    db,
    {
      entity: `Location ${locationId}`,
      parent: locations,
      isParent: sql`${eq(locations.id, locationId)} and ${eq(locations.organizationId, organizationId)}`,
      publication: scope && {
        target: and(
          scope.location(locationId),
          sheetActivityWhere(scope, args.activity, locationId, 'location')
        ),
        version: eq(locationSheetVariants.locationId, locationId),
      },
      selected: locations.selectedReferenceVersionId,
      claim: locations.pendingPromoteReferenceVersionId,
      isGenerating: eq(locations.referenceStatus, 'generating'),
      promote: {
        selectedReferenceVersionId: versionId,
        pendingPromoteReferenceVersionId: null,
        referenceStatus: 'completed',
        referenceError: null,
        updatedAt: now,
      },
      settle: {
        referenceStatus: 'completed',
        referenceError: null,
        updatedAt: now,
      },
      variants: locationSheetVariants,
      version: {
        ...versionRow(args, now),
        locationId,
      },
      versionIdColumn: locationSheetVariants.id,
      divergedAt: locationSheetVariants.divergedAt,
      park: { divergedAt: now, updatedAt: now },
      twinParked: db
        .select({ one: sql`1` })
        .from(twin)
        .where(
          and(
            eq(twin.locationId, locationId),
            eq(twin.model, args.model),
            eq(twin.inputHash, sql`${locationSheetVariants.inputHash}`),
            isNotNull(twin.divergedAt)
          )
        ),
    },
    args
  );
}
