import { and, eq, exists, getTableColumns, is, SQL, sql } from 'drizzle-orm';
import type {
  AnySQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
} from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database } from '@/platform/server/db/client';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import { scenes, sequences, shots } from '@/platform/server/db/schema';
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
  return { sequence, scene, shot, assert };
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
export const STORYBOARD_CONTENT_INSERT_BATCH = 3;

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
