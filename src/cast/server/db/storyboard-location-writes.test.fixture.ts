import { eq, sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  locationBibleVersions,
  locationReferencePhotos,
  locations,
  locationSheetVariants,
  organization,
  sequenceEvents,
  sequenceLocationLinks,
  sequences,
  styles,
  user,
} from '@/platform/server/db/schema';
import { clearVersionRows } from '@/platform/server/test/clear-version-rows';
import { createStoryboardCastScope } from '@/sequences/server/db/storyboard-cast-scope';
import { checkedStoryboardContentWrite } from '@/sequences/server/db/storyboard-content-writes';
import { STORYBOARD_WORKFLOW_STATUS } from '@/sequences/server/db/storyboard-owner';
import { createLocationsMethods } from './locations';
import type { AnalysedLocation } from './locations';

export const RUN = {
  owner: 'synthetic-location-owner',
  replacement: 'synthetic-location-replacement',
  claim: 'synthetic-location-claim',
} as const;
export const ANALYSIS = { source: 'analysis', createdBy: null } as const;
export const SQL_TARGET = {
  identity: /^insert into "sequence_locations"/i,
  bible: /^insert into "location_bible_versions"/i,
  linkInsert: /^insert into "sequence_location_links"/i,
  linkUpdate: /^update "sequence_location_links"/i,
  linkDelete: /^delete from "sequence_location_links"/i,
  cleanup: /^update "sequence_locations" set "deleted_at" = \?, "updated_at"/i,
  precheck: /^select "id" from "sequences"/i,
} as const;
export const FIRST_LINE = 7;
export const D1_BIND_LIMIT = 100;
export const LOCATION_BATCH_COUNT = 12;
export const SQL_FAILURE = 'synthetic location SQL failure';

export async function seedLocationOwners(db: Database) {
  await clearVersionRows(db);
  await db.delete(sequenceEvents);
  await db.delete(locations);
  await db.delete(sequences);
  await db.delete(styles);
  await db.delete(organization);
  await db.delete(user);
  const graph = {
    organizationId: generateId(),
    foreignOrganizationId: generateId(),
    actorId: generateId(),
    sequenceId: generateId(),
    otherSequenceId: generateId(),
    foreignSequenceId: generateId(),
    styleId: generateId(),
    foreignStyleId: generateId(),
  };
  await db.insert(user).values({
    id: graph.actorId,
    name: 'Synthetic user',
    email: 'synthetic-locations@example.test',
  });
  await db.insert(organization).values([
    { id: graph.organizationId, name: 'Synthetic owner', slug: 'owner' },
    {
      id: graph.foreignOrganizationId,
      name: 'Synthetic foreign',
      slug: 'foreign',
    },
  ]);
  await seedLocationSequences(db, graph);
  return graph;
}

async function seedLocationSequences(db: Database, graph: LocationGraph) {
  const config = {
    mood: 'neutral',
    artStyle: 'cinematic',
    lighting: 'natural',
    colorPalette: ['#000', '#fff'],
    cameraWork: 'static',
    referenceFilms: [],
    colorGrading: 'neutral',
  };
  await db.insert(styles).values([
    {
      id: graph.styleId,
      organizationId: graph.organizationId,
      name: 'Synthetic style',
      config,
    },
    {
      id: graph.foreignStyleId,
      organizationId: graph.foreignOrganizationId,
      name: 'Synthetic foreign style',
      config,
    },
  ]);
  await db.insert(sequences).values([
    {
      id: graph.sequenceId,
      organizationId: graph.organizationId,
      title: 'Synthetic owner sequence',
      workflowRunId: RUN.owner,
      status: STORYBOARD_WORKFLOW_STATUS.processing,
      styleId: graph.styleId,
    },
    {
      id: graph.otherSequenceId,
      organizationId: graph.organizationId,
      title: 'Other',
      styleId: graph.styleId,
    },
    {
      id: graph.foreignSequenceId,
      organizationId: graph.foreignOrganizationId,
      title: 'Foreign',
      styleId: graph.foreignStyleId,
    },
  ]);
}

export type LocationGraph = Awaited<ReturnType<typeof seedLocationOwners>>;

export function locationEntry(
  graph: LocationGraph,
  scriptId = 'loc_synthetic',
  overrides: Partial<AnalysedLocation> = {}
): AnalysedLocation {
  return {
    sequenceId: graph.sequenceId,
    locationId: scriptId,
    name: `Synthetic ${scriptId}`,
    description: 'Synthetic first description',
    rendering: PHOTOREAL_RENDERING,
    keyFeatures: '合成窗户、柜台',
    consistencyTag: 'synthetic_tag',
    firstMentionText: 'Synthetic first mention',
    firstMentionLine: FIRST_LINE,
    boundTo: null,
    ...overrides,
  };
}

export function locationWriter(
  db: Database,
  graph: LocationGraph,
  bound = true
) {
  if (!bound)
    return createLocationsMethods(db, graph.organizationId).createBulk;
  const scope = createStoryboardCastScope(db, graph.organizationId, {
    id: graph.sequenceId,
    workflowRunId: RUN.owner,
    workflowClaimId: RUN.claim,
  });
  const methods = createLocationsMethods(db, graph.organizationId, scope);
  return checkedStoryboardContentWrite(scope, methods.createBulk);
}

export async function makeAnalysedLocation(
  db: Database,
  graph: LocationGraph,
  scriptId = 'loc_synthetic',
  overrides: Partial<AnalysedLocation> = {}
) {
  const [row] = await locationWriter(
    db,
    graph,
    false
  )([locationEntry(graph, scriptId, overrides)], ANALYSIS);
  if (!row) throw new Error('Synthetic location missing');
  return row;
}

export function makePickedLocation(
  db: Database,
  graph: LocationGraph,
  organizationId = graph.organizationId
) {
  return createLocationsMethods(db, organizationId).createForOrganization(
    {
      name: 'Synthetic picked location',
      description: 'Synthetic picked bible',
      consistencyTag: 'picked_tag',
      rendering: PHOTOREAL_RENDERING,
    },
    { createdBy: graph.actorId }
  );
}

export async function locationSnapshot(db: Database) {
  return {
    locations: await db.select().from(locations).orderBy(locations.id),
    links: await db
      .select()
      .from(sequenceLocationLinks)
      .orderBy(sequenceLocationLinks.id),
    bibles: await db
      .select()
      .from(locationBibleVersions)
      .orderBy(locationBibleVersions.id),
    sheets: await db
      .select()
      .from(locationSheetVariants)
      .orderBy(locationSheetVariants.id),
    photos: await db
      .select()
      .from(locationReferencePhotos)
      .orderBy(locationReferencePhotos.id),
    events: await db.select().from(sequenceEvents).orderBy(sequenceEvents.id),
  };
}

export const replaceLocationOwner = (db: Database, graph: LocationGraph) =>
  db
    .update(sequences)
    .set({ workflowRunId: RUN.replacement })
    .where(eq(sequences.id, graph.sequenceId));

type TimingState = {
  prechecked: boolean;
  fired: boolean;
  expected?: Awaited<ReturnType<typeof locationSnapshot>>;
};
type Execute = (query: string, run: () => Promise<unknown>) => Promise<unknown>;
type StatementQueries = WeakMap<D1PreparedStatement, string>;

// Only the transport is delayed; SQLite still executes the original statements.
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

type Timing = {
  match: RegExp;
  change: () => Promise<unknown>;
  moment?: 'before' | 'after';
  skip?: number;
};

// A matched batch member delays the whole atomic batch, never an inner statement.
export function interceptLocationSql(db: Database, timing: Timing) {
  const state: TimingState = { prechecked: false, fired: false };
  const queries: StatementQueries = new WeakMap();
  const prepare = db.$client.prepare.bind(db.$client);
  const batch = db.$client.batch.bind(db.$client);
  let matches = 0;
  const fire = async () => {
    if (state.fired || matches++ < (timing.skip ?? 0)) return;
    state.fired = true;
    await timing.change();
    state.expected = await locationSnapshot(db);
  };
  const execute: Execute = async (query, run) => {
    const matched = timing.match.test(query);
    if (matched && timing.moment !== 'after') await fire();
    const result = await run();
    if (
      SQL_TARGET.precheck.test(query) &&
      Array.isArray(result) &&
      result.length > 0
    )
      state.prechecked = true;
    if (matched && timing.moment === 'after') await fire();
    return result;
  };
  installLocationTiming(db, queries, prepare, batch, timing, execute, fire);
  return {
    state,
    assertUnchanged: async () => {
      expect(state.prechecked).toBe(true);
      expect(state.fired).toBe(true);
      expect(state.expected).toBeDefined();
      expect(await locationSnapshot(db)).toEqual(state.expected);
    },
  };
}

function installLocationTiming(
  db: Database,
  queries: StatementQueries,
  prepare: D1Database['prepare'],
  batch: D1Database['batch'],
  timing: Timing,
  execute: Execute,
  fire: () => Promise<void>
) {
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) =>
    timedStatement(prepare(query), query, execute, queries)
  );
  vi.spyOn(db.$client, 'batch').mockImplementation(async (statements) => {
    const matched = statements.some((statement) => {
      const query = queries.get(statement);
      return query !== undefined && timing.match.test(query);
    });
    if (matched && timing.moment !== 'after') await fire();
    const result = await batch(statements);
    if (matched && timing.moment === 'after') await fire();
    return result;
  });
}

export function failLocationInsert(db: Database) {
  return db.run(
    sql`CREATE TRIGGER synthetic_location_failure BEFORE INSERT ON sequence_locations BEGIN SELECT RAISE(ABORT, 'synthetic location SQL failure'); END`
  );
}

export function observeLocationBinds(db: Database) {
  const counts: number[] = [];
  const prepare = db.$client.prepare.bind(db.$client);
  vi.spyOn(db.$client, 'prepare').mockImplementation(
    (query) =>
      new Proxy(prepare(query), {
        get(target, key) {
          if (key === 'bind')
            return (...values: unknown[]) => {
              counts.push(values.length);
              return target.bind(...values);
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      })
  );
  return counts;
}
