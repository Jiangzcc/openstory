import { and, eq, exists, isNull, sql } from 'drizzle-orm';
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
import type { StoryboardContentScope } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';

type Target = string | AnySQLiteColumn;

export function createStoryboardSheetScope(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const base = createStoryboardContentScope(db, organizationId, owner);
  const character = (target: Target) =>
    liveCharacter(db, organizationId, base, target);
  const location = (target: Target) =>
    liveLocation(db, organizationId, base, target);
  return {
    ...base,
    character,
    location,
    look: (target: Target) => liveLook(db, character, target),
    organizationCharacter: character,
    organizationLocation: location,
  };
}

function liveCharacter(
  db: Database,
  organizationId: string,
  scope: StoryboardContentScope,
  target: Target
) {
  const row = alias(characters, 'storyboard_sheet_character');
  const link = alias(sequenceCast, 'storyboard_sheet_cast');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .innerJoin(link, eq(link.characterId, row.id))
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(row.organizationId, organizationId),
          isNull(row.deletedAt),
          isNull(link.removedAt),
          scope.sequence(link.sequenceId)
        )
      )
  );
}

function liveLook(
  db: Database,
  character: (target: Target) => ReturnType<typeof exists>,
  target: Target
) {
  const row = alias(characterLooks, 'storyboard_sheet_look');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .where(
        and(
          sql`${row.id} = ${target}`,
          isNull(row.deletedAt),
          character(row.characterId)
        )
      )
  );
}

function liveLocation(
  db: Database,
  organizationId: string,
  scope: StoryboardContentScope,
  target: Target
) {
  const row = alias(locations, 'storyboard_sheet_location');
  const link = alias(sequenceLocationLinks, 'storyboard_sheet_location_link');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .innerJoin(link, eq(link.locationId, row.id))
      .where(
        and(
          sql`${row.id} = ${target}`,
          eq(row.organizationId, organizationId),
          isNull(row.deletedAt),
          isNull(link.removedAt),
          scope.sequence(link.sequenceId)
        )
      )
  );
}
