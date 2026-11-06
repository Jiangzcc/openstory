import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/d1';
import { routeD1 } from '@/platform/server/db/d1-session';
import { relations } from '@/platform/server/db/schema/relations';
import { asStub } from '@/test/as-stub';

// Mock replicas keep old in-memory snapshots until a bookmark advances them.
const METADATA_SCHEMA = `CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
)`;
const WRITE_SQL = /^\s*(insert|update|delete)/i;
const BOOKMARK_VERSION = /^mock-(\d+)$/;
type Cursor = { version: number; queried: boolean };

export class ConfigurationSessionMock {
  private primary = new DatabaseSync(':memory:');
  private snapshots: DatabaseSync[] = [];
  private batching = false;
  replicaVersion = 0;
  readonly db = drizzle(
    routeD1(() => this.binding),
    { relations }
  );

  constructor() {
    this.primary.exec(METADATA_SCHEMA);
    this.capture();
  }

  get binding(): D1Database {
    return asStub<D1Database>(this);
  }
  get head(): number {
    return this.snapshots.length - 1;
  }

  private capture() {
    const copy = new DatabaseSync(':memory:');
    copy.exec(METADATA_SCHEMA);
    const rows = this.primary
      .prepare('SELECT key, value, updated_at FROM app_metadata')
      .all();
    const insert = copy.prepare('INSERT INTO app_metadata VALUES (?, ?, ?)');
    for (const row of rows) insert.run(...Object.values(row));
    this.snapshots.push(copy);
  }

  private target(sql: string, cursor?: Cursor) {
    if (WRITE_SQL.test(sql) || !cursor) return this.primary;
    const snapshot = this.snapshots[cursor.version];
    if (!snapshot) throw new Error('Unknown mock D1 bookmark.');
    return snapshot;
  }

  private execute(
    sql: string,
    params: SQLInputValue[],
    cursor?: Cursor,
    arrays = false
  ) {
    const writes = WRITE_SQL.test(sql);
    const statement = this.target(sql, cursor).prepare(sql);
    statement.setReturnArrays(arrays);
    const results = statement.columns().length ? statement.all(...params) : [];
    const changes = statement.columns().length
      ? 0
      : Number(statement.run(...params).changes);
    if (writes && !this.batching) this.capture();
    if (cursor) {
      cursor.queried = true;
      if (writes) cursor.version = this.head;
    }
    return { results, success: true, meta: { changes, changed_db: writes } };
  }

  private statement(
    sql: string,
    cursor?: Cursor,
    params: SQLInputValue[] = []
  ) {
    return {
      bind: (...values: SQLInputValue[]) => this.statement(sql, cursor, values),
      raw: async () => this.execute(sql, params, cursor, true).results,
      all: async () => this.execute(sql, params, cursor),
      run: async () => this.execute(sql, params, cursor),
      first: async () => this.execute(sql, params, cursor).results[0] ?? null,
      executeBatch: () => this.execute(sql, params, cursor),
    };
  }

  prepare(sql: string) {
    return this.statement(sql);
  }

  async batch(
    statements: ReturnType<ConfigurationSessionMock['prepare']>[],
    cursor?: Cursor
  ) {
    this.primary.exec('BEGIN');
    this.batching = true;
    try {
      const result = statements.map((statement) => statement.executeBatch());
      this.primary.exec('COMMIT');
      this.capture();
      if (cursor) cursor.version = this.head;
      return result;
    } catch (error) {
      this.primary.exec('ROLLBACK');
      throw error;
    } finally {
      this.batching = false;
    }
  }

  withSession(start: string) {
    const version =
      start === 'first-primary'
        ? this.head
        : Math.max(
            this.replicaVersion,
            Number(start.match(BOOKMARK_VERSION)?.[1] ?? 0)
          );
    const cursor = { version, queried: false };
    return {
      prepare: (sql: string) => this.statement(sql, cursor),
      batch: (statements: ReturnType<ConfigurationSessionMock['prepare']>[]) =>
        this.batch(statements, cursor),
      getBookmark: () => (cursor.queried ? `mock-${cursor.version}` : null),
    };
  }

  close() {
    this.primary.close();
    for (const snapshot of this.snapshots) snapshot.close();
  }
}
