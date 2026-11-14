import { eq, sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { placeholderAutoStyleDraft } from '@/look/auto-style';
import type { AutoStyleDraft } from '@/look/auto-style';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import {
  sequences,
  sequenceStyleVersions,
  styles,
  user,
} from '@/platform/server/db/schema';
import type { SequenceStatus } from '@/platform/server/db/schema/sequences';
import {
  FIXTURE_DATE,
  seedSpace,
} from './storyboard-content-ownership.test.fixture';

// Synthetic fixtures and SQL timing substitutes; every original D1 query executes.
export const COUNT = { none: 0, one: 1, two: 2 } as const;
export const SOURCE = { derived: 'derived', switched: 'switched' } as const;
const STATUS = {
  processing: 'processing',
  failed: 'failed',
  completed: 'completed',
  draft: 'draft',
  archived: 'archived',
} as const satisfies Record<string, SequenceStatus>;
export const REPLACEMENT_RUN = 'synthetic-auto-style-replacement';
export const SQL_FAULT = {
  trigger: 'synthetic_auto_style_fault',
  message: 'Synthetic auto-style SQL failure',
} as const;
export const MOMENT = { before: 'before', after: 'after' } as const;
export const SQL_TARGET = {
  style: /^\s*update "styles"\s/i,
  version: /^\s*insert into "sequence_style_versions"(?:\s|\()/i,
  pointer:
    /^\s*update "sequences" set\b[\s\S]*"selected_style_version_id"\s*=/i,
  precheck: /^\s*select "id" from "sequences" where\b/i,
  selection: /^\s*select "id" from "sequences" where\b[\s\S]*"style_id"/i,
  config: /^\s*select "config" from "styles" where\b/i,
} as const;

export const DRAFT: AutoStyleDraft = {
  ...placeholderAutoStyleDraft(),
  name: '合成风格："归途"',
  description: '合成配方\n引号 " 与反斜线 \\ 原样保存。',
  category: 'film',
  tags: ['合成', '"夜景"', 'line\nbreak'],
  config: {
    ...placeholderAutoStyleDraft().config,
    look: {
      ...placeholderAutoStyleDraft().config.look,
      mood: '合成夜景："回家"\n第二行',
      medium: '数码电影',
    },
    motion: { camera: '合成固定长镜头', pace: 'measured' },
    references: ['合成作品："夜归"', 'path\\reference'],
  },
};

type Surface = ReturnType<ScopedDb['storyboardAutoStyle']>;
export type Graph = Awaited<ReturnType<typeof seedAutoStyleGraph>>;
type RootState = Partial<
  Pick<typeof sequences.$inferInsert, 'status' | 'workflowRunId'>
>;
export const ROOT_LOSSES = [
  { name: 'replacement root', state: { workflowRunId: REPLACEMENT_RUN } },
  { name: 'failed root', state: { status: STATUS.failed } },
  { name: 'completed root', state: { status: STATUS.completed } },
  { name: 'draft root', state: { status: STATUS.draft } },
  { name: 'archived root', state: { status: STATUS.archived } },
  // SequenceStatus has no cancelled value; model only a cleared ownership slot.
  {
    name: 'cleared owner (synthetic cancellation)',
    state: { workflowRunId: null },
  },
] as const satisfies readonly { name: string; state: RootState }[];

type Mutation = {
  name: string;
  match: RegExp;
  write: (surface: Surface, graph: Graph) => Promise<boolean>;
};
export const MUTATIONS: Mutation[] = [
  {
    name: 'styles.setGeneratedForSequence',
    match: SQL_TARGET.style,
    write: (surface, graph) =>
      surface.styles.setGeneratedForSequence({
        sequenceId: graph.sequenceId,
        styleId: graph.styleId,
        draft: DRAFT,
      }),
  },
  {
    name: 'sequences.snapshotAutoStyle',
    match: SQL_TARGET.version,
    write: (surface, graph) =>
      surface.sequences.snapshotAutoStyle({
        id: graph.sequenceId,
        styleId: graph.styleId,
      }),
  },
];

export async function seedAutoStyleGraph(
  db: Database,
  space?: Awaited<ReturnType<typeof seedSpace>>
) {
  const { organizationId, styleId: libraryStyleId } =
    space ?? (await seedSpace(db));
  const userId = generateId();
  const sequenceId = generateId();
  const styleId = generateId();
  const rawClaimId = generateId();
  const workflowRunId = 'storyboard-' + rawClaimId;
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic auto-style user',
    email: userId + '@example.com',
  });
  await db.insert(styles).values({
    ...placeholderAutoStyleDraft(),
    id: styleId,
    organizationId,
    sequenceId,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
  });
  await db.insert(sequences).values({
    id: sequenceId,
    organizationId,
    styleId,
    title: 'Synthetic auto-style sequence',
    workflowRunId,
    status: STATUS.processing,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
  });
  return {
    organizationId,
    userId,
    sequenceId,
    styleId,
    libraryStyleId,
    rawClaimId,
    workflowRunId,
  };
}

export function setRoot(db: Database, graph: Graph, state: RootState) {
  return db
    .update(sequences)
    .set(state)
    .where(eq(sequences.id, graph.sequenceId));
}

export async function autoStyleSnapshot(db: Database) {
  const [styleRows, versions, sequenceRows] = await Promise.all([
    db.all<Record<string, unknown>>(sql`SELECT * FROM styles ORDER BY id`),
    db.all<Record<string, unknown>>(
      sql`SELECT * FROM sequence_style_versions ORDER BY id`
    ),
    db.all<Record<string, unknown>>(sql`SELECT * FROM sequences ORDER BY id`),
  ]);
  return { styles: styleRows, versions, sequences: sequenceRows };
}

export function versionsFor(db: Database, graph: Graph) {
  return db
    .select()
    .from(sequenceStyleVersions)
    .where(eq(sequenceStyleVersions.sequenceId, graph.sequenceId));
}

export async function sequenceFor(db: Database, graph: Graph) {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, graph.sequenceId));
  if (!row) throw new Error('Synthetic auto-style sequence missing');
  return row;
}

export async function styleFor(db: Database, graph: Graph) {
  const [row] = await db
    .select()
    .from(styles)
    .where(eq(styles.id, graph.styleId));
  if (!row) throw new Error('Synthetic automatic style missing');
  return row;
}

type Snapshot = Awaited<ReturnType<typeof autoStyleSnapshot>>;
type TimingState = {
  successfulPrecheck: boolean;
  fired: boolean;
  matchedSql?: string;
  expected?: Snapshot;
};
type Timing = {
  match: RegExp;
  moment: (typeof MOMENT)[keyof typeof MOMENT];
  change: () => Promise<unknown>;
};
type Execute = (query: string, run: () => Promise<unknown>) => Promise<unknown>;
type StatementQueries = WeakMap<D1PreparedStatement, string>;

function timedStatement(
  statement: D1PreparedStatement,
  query: string,
  execute: Execute,
  queries: StatementQueries
): D1PreparedStatement {
  const proxy = new Proxy(statement, {
    get(target, key) {
      if (key === 'bind')
        return (...values: unknown[]) =>
          timedStatement(target.bind(...values), query, execute, queries);
      if (key === 'raw') return () => execute(query, () => target.raw());
      if (key === 'all') return () => execute(query, () => target.all());
      if (key === 'run') return () => execute(query, () => target.run());
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  queries.set(proxy, query);
  return proxy;
}

async function assertTiming(db: Database, state: TimingState) {
  expect(state.successfulPrecheck).toBe(true);
  expect(state.fired).toBe(true);
  expect(state.matchedSql).toBeDefined();
  expect(state.expected).toBeDefined();
  expect(await autoStyleSnapshot(db)).toEqual(state.expected);
}

// A matching batch member delays the entire atomic batch, never its inner statements.
export function interceptAutoStyleSql(db: Database, timing: Timing) {
  const state: TimingState = { successfulPrecheck: false, fired: false };
  const queries: StatementQueries = new WeakMap();
  const prepare = db.$client.prepare.bind(db.$client);
  const batch = db.$client.batch.bind(db.$client);
  const fire = async (query: string) => {
    if (state.fired) return;
    state.fired = true;
    state.matchedSql = query;
    await timing.change();
    state.expected = await autoStyleSnapshot(db);
  };
  const execute: Execute = async (query, run) => {
    const matched = timing.match.test(query);
    if (matched && timing.moment === MOMENT.before) await fire(query);
    const result = await run();
    if (
      SQL_TARGET.precheck.test(query) &&
      Array.isArray(result) &&
      result.length > COUNT.none
    )
      state.successfulPrecheck = true;
    if (matched && timing.moment === MOMENT.after) await fire(query);
    return result;
  };
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) =>
    timedStatement(prepare(query), query, execute, queries)
  );
  vi.spyOn(db.$client, 'batch').mockImplementation(async (statements) => {
    const query = statements
      .map((statement) => queries.get(statement))
      .find(
        (candidate) => candidate !== undefined && timing.match.test(candidate)
      );
    if (query && timing.moment === MOMENT.before) await fire(query);
    return batch(statements);
  });
  return { state, assertUnchanged: () => assertTiming(db, state) };
}

export function failAutoStyleSql(
  db: Database,
  table: 'styles' | 'sequence_style_versions' | 'sequences',
  operation: 'UPDATE' | 'INSERT'
) {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT.trigger} BEFORE ${operation} ON "${table}" ` +
        `BEGIN SELECT RAISE(ABORT, '${SQL_FAULT.message}'); END`
    )
  );
}

export function failureFrom(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

export function expectSqlFailure(error: unknown) {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  expect(cause).toHaveProperty('message', SQL_FAULT.message);
}
