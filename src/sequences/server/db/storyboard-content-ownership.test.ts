import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  frames,
  sceneScriptVersions,
  scenes,
  sequenceEvents,
  sequences,
  shotDialogueClaims,
  shots,
} from '@/platform/server/db/schema';
import { StoryboardContentOwnershipError } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';
import {
  CHANGED_DURATION_MS,
  CHANGED_LINES,
  DEFAULT_DURATION_MS,
  FIRST_SHOT,
  FIXTURE_DATE,
  INITIAL_LINES,
  MUTATIONS,
  NARRATIVE,
  ORDER,
  SCRIPT_FALLBACKS,
  SHOT_COUNT,
  SPLIT_CONTENT,
  SQL_FAILURE,
  SQL_FAULT,
  STATUS,
  ULID_PATTERN,
  eventInput,
  expectStoredShot,
  failAt,
  prepareScriptFallback,
  replaceOwnerBeforeWrite,
  seedGraph,
  seedSpace,
  shotInserts,
  snapshot,
  splitSeed,
} from './storyboard-content-ownership.test.fixture';
import type {
  Content,
  Graph,
} from './storyboard-content-ownership.test.fixture';

// Synthetic migrated Node SQLite D1 tests, not Cloudflare replay/provider acceptance.
let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  graph = await seedGraph(db, await seedSpace(db));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT));
});

function unbound(organizationId = graph.organizationId) {
  return createScopedDb(organizationId, generateId());
}

function owner(overrides: Partial<StoryboardOwner> = {}): StoryboardOwner {
  return {
    id: graph.sequenceId,
    workflowRunId: graph.workflowRunId,
    ...overrides,
  };
}

function content(overrides: Partial<StoryboardOwner> = {}) {
  return unbound().storyboardContent(owner(overrides));
}

const LOST_OWNERS = [
  { name: 'replaced run', status: STATUS.processing, replaced: true },
  { name: 'same owner failed', status: STATUS.failed, replaced: false },
  { name: 'same owner completed', status: STATUS.completed, replaced: false },
] as const;

async function loseOwner(loss: (typeof LOST_OWNERS)[number]) {
  await db
    .update(sequences)
    .set({
      status: loss.status,
      workflowRunId: loss.replaced
        ? 'synthetic-replacement-run'
        : graph.workflowRunId,
    })
    .where(eq(sequences.id, graph.sequenceId));
}

async function errorFrom(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

async function expectSqlFailure(promise: Promise<unknown>) {
  const error = await errorFrom(promise);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  expect(cause).toBeInstanceOf(Error);
  expect(cause).toHaveProperty('message', SQL_FAILURE);
}

it.each(MUTATIONS)(
  'allows $name for the active processing run',
  async ({ write }) => {
    const before = await snapshot(db);
    await write(content(), graph);
    expect(await snapshot(db)).not.toEqual(before);
  }
);

describe.each(LOST_OWNERS)('$name', (loss) => {
  it.each(MUTATIONS)(
    'rejects $name without changing any content',
    async ({ write }) => {
      const bound = content();
      await loseOwner(loss);
      const before = await snapshot(db);
      const error = await errorFrom(write(bound, graph));
      expect(await snapshot(db)).toEqual(before);
      expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
    }
  );
});

it.each(MUTATIONS)(
  'rejects $name when the owner changes after precheck',
  async ({ write }) => {
    const bound = content();
    const race = replaceOwnerBeforeWrite(db, graph);
    const error = await errorFrom(write(bound, graph));
    const observed = race.observed();
    expect(observed.handedOver).toBe(true);
    expect(observed.prechecked).toBe(true);
    expect(observed.expected).toBeDefined();
    expect(await snapshot(db)).toEqual(observed.expected);
    expect(error).toBeInstanceOf(Error);
  }
);

it.each(MUTATIONS)(
  'allows $name with an explicitly supplied raw workflow claim',
  async ({ write }) => {
    await db
      .update(sequences)
      .set({ workflowRunId: graph.rawClaimId })
      .where(eq(sequences.id, graph.sequenceId));
    const before = await snapshot(db);
    await write(content({ workflowClaimId: graph.rawClaimId }), graph);
    expect(await snapshot(db)).not.toEqual(before);
  }
);

it('does not guess a raw workflow claim from a prefixed instance id', async () => {
  await db
    .update(sequences)
    .set({ workflowRunId: graph.rawClaimId })
    .where(eq(sequences.id, graph.sequenceId));
  const before = await snapshot(db);
  const bound = content({ workflowRunId: 'storyboard-' + graph.rawClaimId });
  await expect(
    bound.sequences.updateTitle(graph.sequenceId, 'Stale')
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  expect(await snapshot(db)).toEqual(before);
});

describe.each(['same organization', 'foreign organization'] as const)(
  '%s target ids',
  (target) => {
    it.each(MUTATIONS)(
      'cannot mutate $name outside the bound sequence',
      async ({ write }) => {
        const space =
          target === 'same organization' ? graph : await seedSpace(db);
        const foreign = await seedGraph(db, space);
        const before = await snapshot(db);
        await errorFrom(write(content(), foreign));
        expect(await snapshot(db)).toEqual(before);
      }
    );
  }
);

it.each(MUTATIONS)(
  'rejects $name when the bound organization does not own the sequence',
  async ({ write }) => {
    const foreign = await seedSpace(db);
    const bound = unbound(foreign.organizationId).storyboardContent(owner());
    const before = await snapshot(db);
    const error = await errorFrom(write(bound, graph));
    expect(await snapshot(db)).toEqual(before);
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);
it('preserves ULIDs, JSON, dates, SQL defaults and anchors across more than five shots', async () => {
  const bound = content();
  const scene = await bound.scenes.upsert({
    sequenceId: graph.sequenceId,
    orderIndex: ORDER.next,
    createdAt: FIXTURE_DATE,
  });
  expect(scene).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    createdAt: FIXTURE_DATE,
    deletedAt: null,
    selectedScriptVersionId: null,
  });
  const rows = await bound.shots.bulkUpsert(
    shotInserts(graph).map((shot) => ({
      ...shot,
      sceneId: scene.id,
      createdAt: FIXTURE_DATE,
      useStartFrame: false,
      audioClips: [],
    }))
  );
  expect(rows).toHaveLength(SHOT_COUNT);
  for (const row of rows) {
    expect(row).toMatchObject({
      id: expect.stringMatching(ULID_PATTERN),
      sceneId: scene.id,
      durationMs: DEFAULT_DURATION_MS,
      useStartFrame: false,
      audioClips: [],
      createdAt: FIXTURE_DATE,
      deletedAt: null,
      anchorFrameId: expect.stringMatching(ULID_PATTERN),
    });
    await expectStoredShot(db, row);
  }
});

it('retains shot and anchor ids on a seven-shot replay and applies conflict updates', async () => {
  const bound = content();
  const before = await db.select().from(frames);
  const replay = await bound.shots.bulkUpsert(shotInserts(graph, true));
  expect(replay.map((shot) => shot.id).sort()).toEqual(
    [...graph.shotIds].sort()
  );
  expect(replay.every((shot) => shot.durationMs === CHANGED_DURATION_MS)).toBe(
    true
  );
  expect(await db.select().from(frames)).toEqual(before);
});

it('seeds split script JSON, application boolean defaults and selection in one batch', async () => {
  const bound = content();
  expect(
    await bound.sceneScriptVersions.seedSplitVersions([splitSeed(graph)])
  ).toBe(1);
  const [version] = await db
    .select()
    .from(sceneScriptVersions)
    .where(eq(sceneScriptVersions.id, graph.unseededId));
  const [scene] = await db
    .select()
    .from(scenes)
    .where(eq(scenes.id, graph.unseededId));
  expect(version).toMatchObject({
    id: graph.unseededId,
    sceneId: graph.unseededId,
    content: SPLIT_CONTENT,
    ...NARRATIVE,
    createdAt: FIXTURE_DATE,
    hasNarrative: true,
    narrativeBackfilled: false,
    source: 'split',
    createdBy: null,
  });
  expect(scene?.selectedScriptVersionId).toBe(version?.id);
  const before = await snapshot(db);
  expect(
    await bound.sceneScriptVersions.seedSplitVersions([splitSeed(graph)])
  ).toBe(0);
  expect(await snapshot(db)).toEqual(before);
});

it('seeds more than five split versions within the guarded parameter limit', async () => {
  const bound = content();
  const seeds = [];
  for (let index = 0; index < SHOT_COUNT; index++) {
    const scene = await bound.scenes.upsert({
      sequenceId: graph.sequenceId,
      orderIndex: ORDER.next + index,
    });
    seeds.push({ ...splitSeed(graph), sceneId: scene.id });
  }
  expect(await bound.sceneScriptVersions.seedSplitVersions(seeds)).toBe(
    SHOT_COUNT
  );
  for (const seed of seeds) {
    const [scene] = await db
      .select()
      .from(scenes)
      .where(eq(scenes.id, seed.sceneId));
    expect(scene?.selectedScriptVersionId).toBe(seed.sceneId);
  }
});

it.each(SCRIPT_FALLBACKS)(
  'preserves $name while adopting a split narrative',
  async (scenario) => {
    const { edited, input, expectedContent } = await prepareScriptFallback(
      unbound(),
      graph,
      scenario
    );
    expect(
      await content().sceneScriptVersions.updateSplitContent([input])
    ).toBe(1);
    const [scene] = await db
      .select()
      .from(scenes)
      .where(eq(scenes.id, input.sceneId));
    const [selected] = await db
      .select()
      .from(sceneScriptVersions)
      .where(eq(sceneScriptVersions.id, scene?.selectedScriptVersionId ?? ''));
    expect(selected).toMatchObject({
      content: expectedContent,
      ...input.narrative,
      source: 'split',
    });
    expect(selected?.id).not.toBe(edited.id);
    expect(selected?.id).toMatch(ULID_PATTERN);
    const before = await snapshot(db);
    expect(
      await content().sceneScriptVersions.updateSplitContent([input])
    ).toBe(1);
    expect(await snapshot(db)).toEqual(before);
  }
);

it.each(SCRIPT_FALLBACKS)(
  'fences the $name fallback batch after precheck',
  async (scenario) => {
    const { input } = await prepareScriptFallback(unbound(), graph, scenario);
    const race = replaceOwnerBeforeWrite(db, graph, /^\s*insert\b/i);
    const error = await errorFrom(
      content().sceneScriptVersions.updateSplitContent([input])
    );
    const observed = race.observed();
    expect(observed.prechecked).toBe(true);
    expect(observed.handedOver).toBe(true);
    expect(await snapshot(db)).toEqual(observed.expected);
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);

it('stops later shot chunks when ownership changes between inserts', async () => {
  const race = replaceOwnerBeforeWrite(db, graph, /^insert into "shots"/i, 1);
  const error = await errorFrom(content().shots.bulkUpsert(shotInserts(graph)));
  const observed = race.observed();
  expect(observed.handedOver).toBe(true);
  expect(observed.expected).toBeDefined();
  expect(await snapshot(db)).toEqual(observed.expected);
  expect(error).toBeInstanceOf(Error);
  const inserted = await db
    .select()
    .from(shots)
    .where(eq(shots.sceneId, graph.unseededId));
  expect(inserted.length).toBeGreaterThan(0);
  expect(inserted.length).toBeLessThan(SHOT_COUNT);
});

it('preserves an already cancelled dialogue claim when new authored lines land', async () => {
  await db
    .update(shotDialogueClaims)
    .set({ status: 'cancelled', pendingSourceKey: null })
    .where(eq(shotDialogueClaims.id, graph.claimId));
  const [before] = await db
    .select()
    .from(shotDialogueClaims)
    .where(eq(shotDialogueClaims.id, graph.claimId));
  const version = await content().shotDialogue.write(
    graph.shotId,
    CHANGED_LINES,
    'prompt'
  );
  expect(version?.lines).toEqual(CHANGED_LINES);
  const [after] = await db
    .select()
    .from(shotDialogueClaims)
    .where(eq(shotDialogueClaims.id, graph.claimId));
  expect(after).toEqual(before);
});

it('encodes explicit nulls and booleans and revives soft-deleted upsert slots', async () => {
  const bound = content();
  const [inserted] = await bound.shots.bulkUpsert([
    {
      sequenceId: graph.sequenceId,
      sceneId: graph.unseededId,
      shotNumber: FIRST_SHOT,
      durationMs: null,
      useStartFrame: true,
      audioClips: null,
      deletedAt: FIXTURE_DATE,
    },
  ]);
  expect(inserted).toMatchObject({
    durationMs: null,
    useStartFrame: true,
    audioClips: null,
    deletedAt: FIXTURE_DATE,
  });
  const [revived] = await bound.shots.bulkUpsert([
    {
      sequenceId: graph.sequenceId,
      sceneId: graph.unseededId,
      shotNumber: FIRST_SHOT,
    },
  ]);
  expect(revived).toMatchObject({
    id: inserted?.id,
    durationMs: DEFAULT_DURATION_MS,
    deletedAt: null,
  });
  await db
    .update(scenes)
    .set({ deletedAt: FIXTURE_DATE })
    .where(eq(scenes.id, graph.sceneId));
  const scene = await bound.scenes.upsert({
    sequenceId: graph.sequenceId,
    orderIndex: ORDER.main,
  });
  expect(scene).toMatchObject({ id: graph.sceneId, deletedAt: null });
});

it('writes dialogue JSON and selection while demoting the live speech claim', async () => {
  const bound = content();
  const version = await bound.shotDialogue.write(
    graph.shotId,
    CHANGED_LINES,
    'prompt'
  );
  expect(version).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    lines: CHANGED_LINES,
    source: 'prompt',
    createdBy: null,
  });
  expect(version?.selectedAt).toBeInstanceOf(Date);
  const selected = await unbound().shotDialogue.getSelected(graph.shotId);
  expect(selected?.id).toBe(version?.id);
  const [claim] = await db
    .select()
    .from(shotDialogueClaims)
    .where(eq(shotDialogueClaims.id, graph.claimId));
  expect(claim).toMatchObject({
    status: 'generating',
    pendingSourceKey: null,
  });
  const before = await snapshot(db);
  expect(
    await bound.shotDialogue.write(graph.shotId, CHANGED_LINES, 'prompt')
  ).toEqual(version);
  expect(await snapshot(db)).toEqual(before);
});

it('keeps recordOnce idempotent and preserves event JSON and nullable defaults', async () => {
  const bound = content();
  const event = eventInput(graph);
  await bound.sequenceEvents.recordOnce(event);
  const before = await snapshot(db);
  await bound.sequenceEvents.recordOnce(event);
  expect(await snapshot(db)).toEqual(before);
  const [stored] = await db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.id, event.id));
  expect(stored).toMatchObject(event);
  expect(stored?.createdAt).toBeInstanceOf(Date);
  const minimal = {
    ...event,
    id: generateId(),
    summary: undefined,
    data: undefined,
  };
  await bound.sequenceEvents.recordOnce(minimal);
  const [defaulted] = await db
    .select()
    .from(sequenceEvents)
    .where(eq(sequenceEvents.id, minimal.id));
  expect(defaulted).toMatchObject({
    actorId: null,
    data: null,
    summary: null,
  });
});

it('returns existing delete counts and element shapes for the active owner', async () => {
  const bound = content();
  expect(
    await bound.shots.deleteFromShotNumber(graph.sceneId, SHOT_COUNT)
  ).toBe(1);
  expect(await bound.shots.delete(graph.shotId)).toBe(true);
  expect(await bound.shots.delete(graph.shotId)).toBe(false);
  const element = await bound.sequenceElements.updateFirstMention(
    graph.elementId,
    {
      sceneId: graph.sceneId,
      text: '合成 LOGO',
      lineNumber: FIRST_SHOT,
    }
  );
  expect(element).toMatchObject({
    id: graph.elementId,
    firstMentionSceneId: graph.sceneId,
    firstMentionText: '合成 LOGO',
    firstMentionLine: FIRST_SHOT,
  });
  expect(
    await bound.scenes.deleteFromOrderIndex(graph.sequenceId, ORDER.empty)
  ).toBe(1);
});
it.each(['sequenceId', 'sceneId'] as const)(
  'cannot move an owned shot to a foreign $0',
  async (field) => {
    const foreign = await seedGraph(db, await seedSpace(db));
    const value = field === 'sequenceId' ? foreign.sequenceId : foreign.sceneId;
    const before = await snapshot(db);
    await errorFrom(content().shots.update(graph.shotId, { [field]: value }));
    expect(await snapshot(db)).toEqual(before);
  }
);

it('cannot insert owned-sequence shots pointing at a foreign scene', async () => {
  const foreign = await seedGraph(db, await seedSpace(db));
  const before = await snapshot(db);
  await errorFrom(
    content().shots.bulkUpsert([
      {
        sequenceId: graph.sequenceId,
        sceneId: foreign.sceneId,
        shotNumber: SHOT_COUNT + FIRST_SHOT,
      },
    ])
  );
  expect(await snapshot(db)).toEqual(before);
});

it('guards each row of a mixed owned and foreign shot chunk', async () => {
  const foreign = await seedGraph(db, graph);
  const before = await db
    .select()
    .from(shots)
    .where(eq(shots.sequenceId, foreign.sequenceId));
  await errorFrom(
    content().shots.bulkUpsert([
      { ...shotInserts(graph)[0], sequenceId: graph.sequenceId },
      { ...shotInserts(foreign)[0], sequenceId: foreign.sequenceId },
    ])
  );
  expect(
    await db
      .select()
      .from(shots)
      .where(eq(shots.sequenceId, foreign.sequenceId))
  ).toEqual(before);
  const foreignAnchors = await db
    .select()
    .from(frames)
    .where(eq(frames.sequenceId, foreign.sequenceId));
  expect(foreignAnchors).toHaveLength(SHOT_COUNT);
});

it('rolls back split version insertion when selecting the seeded script fails', async () => {
  const before = await snapshot(db);
  await failAt(db, 'scenes', 'UPDATE');
  await expectSqlFailure(
    content().sceneScriptVersions.seedSplitVersions([splitSeed(graph)])
  );
  expect(await snapshot(db)).toEqual(before);
  await db.run(sql.raw('DROP TRIGGER ' + SQL_FAULT));
  expect(
    await content().sceneScriptVersions.seedSplitVersions([splitSeed(graph)])
  ).toBe(1);
});

it('rolls back dialogue claim demotion and selection clearing when insertion fails', async () => {
  const before = await snapshot(db);
  await failAt(db, 'shot_dialogue_versions', 'INSERT');
  await expectSqlFailure(
    content().shotDialogue.write(graph.shotId, CHANGED_LINES, 'prompt')
  );
  expect(await snapshot(db)).toEqual(before);
  await db.run(sql.raw('DROP TRIGGER ' + SQL_FAULT));
  const retry = await content().shotDialogue.write(
    graph.shotId,
    CHANGED_LINES,
    'prompt'
  );
  expect(retry?.lines).toEqual(CHANGED_LINES);
});

it('rolls back a narrative-version append when script pointer promotion fails', async () => {
  await unbound().sceneScriptVersions.write({
    sceneId: graph.sceneId,
    content: { extract: 'Synthetic preserved edit', dialogue: [] },
    narrative: NARRATIVE,
    source: 'edit',
  });
  const [before] = await db
    .select()
    .from(scenes)
    .where(eq(scenes.id, graph.sceneId));
  await failAt(db, 'scenes', 'UPDATE');
  await expectSqlFailure(
    content().sceneScriptVersions.updateSplitContent([
      {
        ...splitSeed(graph),
        sceneId: graph.sceneId,
        narrative: { ...NARRATIVE, title: 'Synthetic changed narrative' },
      },
    ])
  );
  const [selected] = await db
    .select()
    .from(scenes)
    .where(eq(scenes.id, graph.sceneId));
  expect(selected?.selectedScriptVersionId).toBe(
    before?.selectedScriptVersionId
  );
  const after = await db
    .select()
    .from(sceneScriptVersions)
    .where(eq(sceneScriptVersions.sceneId, graph.sceneId));
  expect(after).toHaveLength(2);
});
const NOOPS: Array<{ name: string; write: (c: Content) => Promise<unknown> }> =
  [
    { name: 'empty shots', write: (c) => c.shots.bulkUpsert([]) },
    {
      name: 'empty split seeds',
      write: (c) => c.sceneScriptVersions.seedSplitVersions([]),
    },
    {
      name: 'empty split updates',
      write: (c) => c.sceneScriptVersions.updateSplitContent([]),
    },
    {
      name: 'unchanged dialogue',
      write: (c) => c.shotDialogue.write(graph.shotId, INITIAL_LINES, 'prompt'),
    },
  ];

it.each(NOOPS)(
  'still rejects $name after ownership is lost',
  async ({ write }) => {
    const bound = content();
    await db
      .update(sequences)
      .set({ status: STATUS.completed })
      .where(eq(sequences.id, graph.sequenceId));
    const before = await snapshot(db);
    await expect(write(bound)).rejects.toBeInstanceOf(
      StoryboardContentOwnershipError
    );
    expect(await snapshot(db)).toEqual(before);
  }
);

it('postchecks a successful SQL write and reports an owner lost before its reply', async () => {
  const bound = content();
  await db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT} AFTER UPDATE OF title ON sequences ` +
        `WHEN NEW.id = '${graph.sequenceId}' BEGIN UPDATE sequences ` +
        `SET workflow_run_id = 'synthetic-after-write-owner' WHERE id = NEW.id; END`
    )
  );
  await expect(
    bound.sequences.updateTitle(graph.sequenceId, 'Synthetic committed title')
  ).rejects.toBeInstanceOf(StoryboardContentOwnershipError);
  const [stored] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, graph.sequenceId));
  expect(stored).toMatchObject({
    title: 'Synthetic committed title',
    workflowRunId: 'synthetic-after-write-owner',
  });
});

it('keeps unbound standalone writers working after the storyboard run completes', async () => {
  const standalone = unbound();
  await db
    .update(sequences)
    .set({ status: STATUS.completed })
    .where(eq(sequences.id, graph.sequenceId));
  await standalone.sequences.updateTitle(
    graph.sequenceId,
    'Synthetic standalone title'
  );
  const scene = await standalone.scenes.upsert({
    sequenceId: graph.sequenceId,
    orderIndex: ORDER.next,
  });
  const written = await standalone.shots.bulkUpsert([
    {
      sequenceId: graph.sequenceId,
      sceneId: scene.id,
      shotNumber: FIRST_SHOT,
    },
  ]);
  const dialogue = await standalone.shotDialogue.write(
    graph.shotId,
    CHANGED_LINES,
    'prompt'
  );
  expect(scene.id).toMatch(ULID_PATTERN);
  expect(written).toHaveLength(1);
  expect(dialogue?.lines).toEqual(CHANGED_LINES);
  const [stored] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, graph.sequenceId));
  expect(stored?.title).toBe('Synthetic standalone title');
});
