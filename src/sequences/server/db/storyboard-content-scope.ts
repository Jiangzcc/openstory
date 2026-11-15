import { and, eq, exists, getTableColumns, is, SQL, sql } from 'drizzle-orm';
import type {
  AnySQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
} from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database } from '@/platform/server/db/client';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import {
  frames,
  scenes,
  sequences,
  shots,
  shotSpecVersions,
} from '@/platform/server/db/schema';
import {
  storyboardOwnerWhere,
  STORYBOARD_WORKFLOW_STATUS,
} from './storyboard-owner';
import type { StoryboardOwner } from './storyboard-owner';

const STORYBOARD_CONTENT_OWNERSHIP_ERROR = 'StoryboardContentOwnershipError';
const STORYBOARD_CONTENT_OWNERSHIP_CHECK_ERROR =
  'StoryboardContentOwnershipCheckError';

export class StoryboardContentOwnershipError extends Error {
  constructor(options?: ErrorOptions) {
    super('Storyboard no longer owns sequence content', options);
    this.name = STORYBOARD_CONTENT_OWNERSHIP_ERROR;
  }
}

export class StoryboardContentOwnershipCheckError extends Error {
  constructor(cause: unknown) {
    super('Storyboard content ownership could not be verified', { cause });
    this.name = STORYBOARD_CONTENT_OWNERSHIP_CHECK_ERROR;
  }
}

export function isStoryboardContentOwnershipError(
  error: unknown
): error is Pick<Error, 'name' | 'message'> {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === STORYBOARD_CONTENT_OWNERSHIP_ERROR &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

export function isStoryboardContentOwnershipFailure(error: unknown): boolean {
  return (
    isStoryboardContentOwnershipError(error) ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === STORYBOARD_CONTENT_OWNERSHIP_CHECK_ERROR)
  );
}

export function createStoryboardContentScope(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const active = () =>
    and(
      storyboardOwnerWhere(organizationId, owner),
      eq(sequences.status, STORYBOARD_WORKFLOW_STATUS.processing)
    );
  const sequence = (target: string | AnySQLiteColumn) =>
    and(
      sql`${target} = ${owner.id}`,
      exists(db.select({ id: sequences.id }).from(sequences).where(active()))
    );
  const scene = (target: string | AnySQLiteColumn) => {
    const row = alias(scenes, 'storyboard_content_scene');
    return exists(
      db
        .select({ id: row.id })
        .from(row)
        .where(and(sql`${row.id} = ${target}`, sequence(row.sequenceId)))
    );
  };
  const shot = (target: string | AnySQLiteColumn) => {
    const row = alias(shots, 'storyboard_content_shot');
    return exists(
      db
        .select({ id: row.id })
        .from(row)
        .where(and(sql`${row.id} = ${target}`, sequence(row.sequenceId)))
    );
  };
  const assert = () => assertStoryboardOwner(db, active());
  const frame = (target: Target) => frameWhere(db, sequence, shot, target);
  const specForShot = (specId: string, target: Target) =>
    specShotWhere(db, shot, specId, target);
  const specForFrame = (specId: string, target: Target) =>
    specFrameWhere(db, sequence, specForShot, specId, target);
  return { sequence, scene, shot, frame, specForShot, specForFrame, assert };
}

type Target = string | AnySQLiteColumn;
type ParentWhere = (target: Target) => SQL | undefined;

function frameWhere(
  db: Database,
  sequence: ParentWhere,
  shot: ParentWhere,
  target: Target
) {
  const row = alias(frames, 'storyboard_content_frame');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .where(
        and(
          sql`${row.id} = ${target}`,
          sequence(row.sequenceId),
          shot(row.shotId)
        )
      )
  );
}

function specShotWhere(
  db: Database,
  shot: ParentWhere,
  specId: string,
  target: Target
) {
  const row = alias(shotSpecVersions, 'storyboard_content_spec');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .where(
        and(
          eq(row.id, specId),
          sql`${row.shotId} = ${target}`,
          shot(row.shotId)
        )
      )
  );
}

function specFrameWhere(
  db: Database,
  sequence: ParentWhere,
  specForShot: (specId: string, target: Target) => SQL,
  specId: string,
  target: Target
) {
  const row = alias(frames, 'storyboard_spec_frame');
  return exists(
    db
      .select({ id: row.id })
      .from(row)
      .where(
        and(
          sql`${row.id} = ${target}`,
          sequence(row.sequenceId),
          specForShot(specId, row.shotId)
        )
      )
  );
}

async function assertStoryboardOwner(db: Database, where: SQL | undefined) {
  const [current] = await db
    .select({ id: sequences.id })
    .from(sequences)
    .where(where)
    .catch((error: unknown) => {
      if (isEngineAbortError(error)) throw error;
      throw new StoryboardContentOwnershipCheckError(error);
    });
  if (!current) throw new StoryboardContentOwnershipError();
}

export type StoryboardContentScope = ReturnType<
  typeof createStoryboardContentScope
>;

function insertValue(column: AnySQLiteColumn, supplied: unknown): SQL {
  let value = supplied;
  if (value === undefined) {
    value = column.defaultFn ? column.defaultFn() : column.default;
    if (value == null) value = column.onUpdateFn?.() ?? null;
    if (value === null) return sql`null`;
  }
  return is(value, SQL) ? value : sql`${sql.param(value, column)}`;
}

// Keep schema defaults and encoders when a conditional INSERT must replace VALUES.
export function insertWithStoryboardGuard<T extends SQLiteTable>(
  db: Database,
  table: T,
  values: SQLiteInsertValue<T>[],
  guard?: SQL | SQL[]
) {
  const insert = db.insert(table);
  if (!guard) return insert.values(values);
  const columns = Object.entries(getTableColumns(table)).filter(
    ([, column]) => !column.generated
  );
  if (Array.isArray(guard) && guard.length !== values.length) {
    throw new Error(
      'Each storyboard insert requires its own ownership predicate'
    );
  }
  const selections = values.map((row, index) => {
    const supplied = new Map<string, unknown>(Object.entries(row));
    return sql`select ${sql.join(
      columns.map(([key, column]) => insertValue(column, supplied.get(key))),
      sql`, `
    )} where ${Array.isArray(guard) ? guard[index] : guard}`;
  });
  return insert.select(sql.join(selections, sql` union all `));
}
