import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { parseLeafPayload } from '@/platform/realtime/schema';
import {
  POSTER,
  checkpointStep,
  deduct,
  emit,
} from '../workflows/storyboard-poster.test.fixture';
import {
  OWNER_MODES,
  REPLACEMENT_RUN,
  beforePosterSql,
  posterOwner,
  posterSequence,
  seedPosterGraph,
  setRoot,
} from './storyboard-poster.test.fixture';
import type { Graph } from './storyboard-poster.test.fixture';

// Real scoped/workflow DB and publisher; engine, credit capture and channel are substitutes.
let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');
const { publishStoryboardPoster } =
  await import('../workflows/storyboard-poster');

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  vi.clearAllMocks();
  graph = await seedPosterGraph(db);
});
afterEach(() => vi.restoreAllMocks());

function args(rawClaim: boolean) {
  return {
    step: checkpointStep().step,
    scopedDb: toWorkflowScopedDb(
      createScopedDb(graph.organizationId, graph.userId)
    ),
    owner: posterOwner(graph, rawClaim),
    poster: POSTER,
    reservationId: 'synthetic-composition-reservation',
  };
}

it.each(OWNER_MODES)(
  'composes real scope, workflow DB and publication for $name',
  async ({ rawClaim }) => {
    if (rawClaim) await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    await expect(publishStoryboardPoster(args(rawClaim))).resolves.toBe(true);
    expect((await posterSequence(db, graph)).posterUrl).toBe(POSTER.url);
    expect(deduct).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: graph.workflowRunId + ':poster',
        reservationId: 'synthetic-composition-reservation',
      })
    );
    const payload = {
      posterUrl: POSTER.url,
      workflowOwner: {
        workflowRunId: graph.workflowRunId,
        ...(rawClaim ? { workflowClaimId: graph.rawClaimId } : {}),
      },
    };
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      'generation.poster:ready',
      payload
    );
    expect(
      parseLeafPayload(
        'generation.poster:ready',
        graph.sequenceId,
        JSON.parse(JSON.stringify(payload))
      )?.data
    ).toEqual(payload);
  }
);

it.each(OWNER_MODES)(
  'refuses a real composed publication after $name loses its SQL slot',
  async ({ rawClaim }) => {
    if (rawClaim) await setRoot(db, graph, { workflowRunId: graph.rawClaimId });
    const timing = beforePosterSql(db, () =>
      setRoot(db, graph, {
        workflowRunId: REPLACEMENT_RUN,
      })
    );
    const before = await posterSequence(db, graph);
    await expect(publishStoryboardPoster(args(rawClaim))).resolves.toBe(false);
    expect(timing.fired).toBe(true);
    expect(await posterSequence(db, graph)).toEqual({
      ...before,
      workflowRunId: REPLACEMENT_RUN,
      updatedAt: expect.any(Date),
    });
    expect(deduct).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  }
);
