import { eq, sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { sequences, user } from '@/platform/server/db/schema';
import { SEQUENCE_STATUSES } from '@/platform/server/db/schema/sequences';
import {
  FIXTURE_DATE,
  seedSpace,
} from './storyboard-content-ownership.test.fixture';
import { STORYBOARD_WORKFLOW_STATUS } from './storyboard-owner';
import type { StoryboardOwner } from './storyboard-owner';

// Synthetic data and SQL timing substitutes; original D1 statements still execute.
export const COUNT = { none: 0, one: 1 } as const;
export const POSTER = {
  original: '/r2/synthetic-original-poster.png',
  published: '/r2/synthetic-storyboard-poster.png',
  replacement: '/r2/synthetic-replacement-poster.png',
} as const;
export const PUBLISHED_AT = new Date('2026-11-14T06:00:00.000Z');
export const REPLAYED_AT = new Date('2026-11-14T06:01:00.000Z');
export const REPLACEMENT_RUN = 'synthetic-poster-replacement-run';
export const SQL_FAULT = {
  trigger: 'synthetic_storyboard_poster_fault',
  message: 'Synthetic storyboard poster SQL failure',
} as const;
export const OWNER_MODES = [
  { name: 'current run', rawClaim: false },
  { name: 'explicit raw claim', rawClaim: true },
] as const;
const ROOT_LOSSES = [
  { name: 'replacement run', state: { workflowRunId: REPLACEMENT_RUN } },
  { name: 'cleared owner', state: { workflowRunId: null } },
  ...SEQUENCE_STATUSES.filter(
    (status) => status !== STORYBOARD_WORKFLOW_STATUS.processing
  ).map((status) => ({ name: status, state: { status } })),
];
export const LOSS_CASES = OWNER_MODES.flatMap((mode) =>
  ROOT_LOSSES.map((loss) => ({ ...mode, loss: loss.name, state: loss.state }))
);
const POSTER_UPDATE = /^\s*update "sequences" set\b[^;]*"poster_url"\s*=/i;

export type Graph = Awaited<ReturnType<typeof seedPosterGraph>>;
type RootState = Partial<
  Pick<
    typeof sequences.$inferInsert,
    'status' | 'workflowRunId' | 'organizationId'
  >
>;

export async function seedPosterGraph(
  db: Database,
  space?: { organizationId: string; styleId: string }
) {
  const { organizationId, styleId } = space ?? (await seedSpace(db));
  const userId = generateId();
  const sequenceId = generateId();
  const rawClaimId = generateId();
  const workflowRunId = 'storyboard-' + rawClaimId;
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic poster user',
    email: userId + '@example.com',
  });
  await db.insert(sequences).values({
    id: sequenceId,
    organizationId,
    styleId,
    title: 'Synthetic poster sequence',
    script: 'Synthetic script retained during poster publication.',
    status: STORYBOARD_WORKFLOW_STATUS.processing,
    workflowRunId,
    statusError: 'Synthetic retained status detail',
    posterUrl: POSTER.original,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    createdBy: userId,
    updatedBy: userId,
  });
  return {
    organizationId,
    styleId,
    userId,
    sequenceId,
    rawClaimId,
    workflowRunId,
  };
}

export function posterOwner(graph: Graph, rawClaim = false): StoryboardOwner {
  return {
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
    ...(rawClaim ? { workflowClaimId: graph.rawClaimId } : {}),
  };
}

export function setRoot(db: Database, graph: Graph, state: RootState) {
  return db
    .update(sequences)
    .set(state)
    .where(eq(sequences.id, graph.sequenceId));
}

export async function posterSnapshot(db: Database) {
  const rows = await db.select().from(sequences).orderBy(sequences.id);
  const [changes] = await db.all<{ count: number }>(
    sql`SELECT total_changes() AS count`
  );
  if (!changes) throw new Error('Synthetic poster change counter missing');
  return { rows, changes: changes.count };
}

export async function posterSequence(db: Database, graph: Graph) {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, graph.sequenceId));
  if (!row) throw new Error('Synthetic poster sequence missing');
  return row;
}

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

export function beforePosterSql(db: Database, change: () => Promise<unknown>) {
  const state: {
    fired: boolean;
    query?: string;
    expected?: Awaited<ReturnType<typeof posterSnapshot>>;
  } = { fired: false };
  const prepare = db.$client.prepare.bind(db.$client);
  const before = async () => {
    if (state.fired) return;
    state.fired = true;
    await change();
    state.expected = await posterSnapshot(db);
  };
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) => {
    const statement = prepare(query);
    if (!POSTER_UPDATE.test(query)) return statement;
    state.query = query;
    return beforeExecution(statement, before);
  });
  return state;
}

export function failPosterSql(db: Database) {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT.trigger} BEFORE UPDATE OF poster_url ON sequences ` +
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
