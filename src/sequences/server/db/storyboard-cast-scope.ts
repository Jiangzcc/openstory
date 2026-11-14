import { and, eq, exists, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database } from '@/platform/server/db/client';
import {
  characters,
  characterLooks,
  locations,
  sequenceCast,
  sequenceLocationLinks,
} from '@/platform/server/db/schema';
import { createStoryboardContentScope } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';

type Target = string | AnySQLiteColumn;
type ParentWhere = (target: Target) => SQL | undefined;

export function createStoryboardCastScope(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const base = createStoryboardContentScope(db, organizationId, owner);
  const active = base.sequence(owner.id);
  return {
    ...base,
    character: (target: Target) =>
      characterWhere(db, organizationId, base.sequence, target),
    look: (target: Target) =>
      lookWhere(db, organizationId, base.sequence, target),
    location: (target: Target) =>
      locationWhere(db, organizationId, base.sequence, target),
    organizationCharacter: (target: Target) =>
      organizationCharacterWhere(db, organizationId, active, target),
    organizationLocation: (target: Target) =>
      organizationLocationWhere(db, organizationId, active, target),
  };
}

function characterWhere(
  db: Database,
  organizationId: string,
  sequence: ParentWhere,
  target: Target
) {
  const row = alias(characters, 'storyboard_cast_character');
  const link = alias(sequenceCast, 'storyboard_cast_link');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .innerJoin(link, eq(link.characterId, row.id))
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(row.organizationId, organizationId),
          sequence(link.sequenceId)
        )
      )
  );
}

function lookWhere(
  db: Database,
  organizationId: string,
  sequence: ParentWhere,
  target: Target
) {
  const row = alias(characterLooks, 'storyboard_cast_look');
  const parent = alias(characters, 'storyboard_look_character');
  const link = alias(sequenceCast, 'storyboard_look_cast');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .innerJoin(parent, eq(parent.id, row.characterId))
      .innerJoin(link, eq(link.characterId, parent.id))
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(parent.organizationId, organizationId),
          sequence(link.sequenceId)
        )
      )
  );
}

function locationWhere(
  db: Database,
  organizationId: string,
  sequence: ParentWhere,
  target: Target
) {
  const row = alias(locations, 'storyboard_cast_location');
  const link = alias(sequenceLocationLinks, 'storyboard_location_link');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .innerJoin(link, eq(link.locationId, row.id))
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(row.organizationId, organizationId),
          sequence(link.sequenceId)
        )
      )
  );
}

function organizationCharacterWhere(
  db: Database,
  organizationId: string,
  active: SQL | undefined,
  target: Target
) {
  const row = alias(characters, 'storyboard_org_character');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(row.organizationId, organizationId),
          active
        )
      )
  );
}

function organizationLocationWhere(
  db: Database,
  organizationId: string,
  active: SQL | undefined,
  target: Target
) {
  const row = alias(locations, 'storyboard_org_location');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(row.organizationId, organizationId),
          active
        )
      )
  );
}

export type StoryboardCastScope = ReturnType<typeof createStoryboardCastScope>;
