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
  framePromptVersions,
  frames,
  sceneScriptVersions,
  scenes,
  sequences,
  shotDialogueVersions,
  shotPromptVersions,
  shots,
  shotSpecVersions,
} from '@/platform/server/db/schema';
import { StoryboardContentOwnershipError } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';
import {
  CHANGED_LINES,
  FIXTURE_DATE,
  NARRATIVE,
  ORDER,
  STATUS,
  ULID_PATTERN,
  eventInput,
  seedSpace,
} from './storyboard-content-ownership.test.fixture';
import {
  AUDIO,
  COMPONENTS,
  CONTINUITY,
  DURATION_MS,
  FAULT_TRIGGER,
  HASH,
  MODEL,
  MUTATIONS,
  PARAMETERS,
  PROMPT_TEXT,
  SPEC,
  errorFrom,
  expectOriginalFault,
  failWrite,
  frameInput,
  motionInput,
  outputRace,
  outputSnapshot,
  originalContinuity,
  replaceAfterRead,
  replaceBeforeBatch,
  replaceSequenceOwner,
  seedLegacy,
  seedOutputGraph,
  specInput,
} from './storyboard-analysis-output.test.fixture';
import type { Graph, Output } from './storyboard-analysis-output.test.fixture';

// Synthetic migrated Node SQLite D1 evidence, not Workerd/provider/restart acceptance.
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
  graph = await seedOutputGraph(db, await seedSpace(db));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + FAULT_TRIGGER));
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
function output(overrides: Partial<StoryboardOwner> = {}) {
  return unbound().storyboardAnalysisOutput(owner(overrides));
}
const LOST_OWNERS = [
  { name: 'replaced run', status: STATUS.processing, replaced: true },
  { name: 'failed run', status: STATUS.failed, replaced: false },
  { name: 'completed run', status: STATUS.completed, replaced: false },
] as const;

async function loseOwner(loss: (typeof LOST_OWNERS)[number]) {
  await db
    .update(sequences)
    .set({ status: loss.status })
    .where(eq(sequences.id, graph.sequenceId));
  if (loss.replaced) await replaceSequenceOwner(db, graph);
}

it.each(MUTATIONS)(
  'allows $name for the active processing root',
  async ({ write }) => {
    const before = await outputSnapshot(db);
    await write(output(), graph);
    expect(await outputSnapshot(db)).not.toEqual(before);
  }
);

it.each(MUTATIONS)(
  'allows $name through its explicit raw claim',
  async ({ write }) => {
    await replaceSequenceOwner(db, graph, graph.rawClaimId);
    const before = await outputSnapshot(db);
    await write(output({ workflowClaimId: graph.rawClaimId }), graph);
    expect(await outputSnapshot(db)).not.toEqual(before);
  }
);

describe.each(LOST_OWNERS)('$name', (loss) => {
  it.each(MUTATIONS)(
    'rejects $name without any output changes',
    async ({ write }) => {
      const bound = output();
      await loseOwner(loss);
      const before = await outputSnapshot(db);
      const error = await errorFrom(write(bound, graph));
      expect(await outputSnapshot(db)).toEqual(before);
      expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
    }
  );
});

it.each(MUTATIONS)(
  'fences $name in SQL AFTER a successful precheck',
  async ({ write }) => {
    const bound = output();
    const race = await outputRace(db, graph);
    const error = await errorFrom(write(bound, graph));
    await race.assert();
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);

it.each(MUTATIONS)(
  'does not infer a raw claim for $name from a prefixed id',
  async ({ write }) => {
    await replaceSequenceOwner(db, graph, graph.rawClaimId);
    const before = await outputSnapshot(db);
    const error = await errorFrom(
      write(output({ workflowRunId: 'storyboard-' + graph.rawClaimId }), graph)
    );
    expect(await outputSnapshot(db)).toEqual(before);
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);

it.each(MUTATIONS)(
  'rejects $name from a foreign organization scope',
  async ({ write }) => {
    const space = await seedSpace(db);
    const bound = unbound(space.organizationId).storyboardAnalysisOutput(
      owner()
    );
    const before = await outputSnapshot(db);
    const error = await errorFrom(write(bound, graph));
    expect(await outputSnapshot(db)).toEqual(before);
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);

describe.each(['same organization', 'foreign organization'] as const)(
  '%s targets',
  (kind) => {
    it.each(MUTATIONS)(
      'cannot change $name outside its bound sequence',
      async ({ write }) => {
        const space =
          kind === 'same organization' ? graph : await seedSpace(db);
        const foreign = await seedOutputGraph(db, space);
        const before = await outputSnapshot(db);
        await errorFrom(write(output(), foreign));
        expect(await outputSnapshot(db)).toEqual(before);
      }
    );
  }
);

it.each(MUTATIONS)(
  'keeps standalone $name usable without a storyboard owner',
  async ({ write }) => {
    await loseOwner(LOST_OWNERS[1]);
    const before = await outputSnapshot(db);
    await write(unbound(), graph);
    expect(await outputSnapshot(db)).not.toEqual(before);
  }
);

it('preserves scene ids, revival, SQL defaults, dates and no-op continuity', async () => {
  const bound = output();
  const inserted = await bound.scenes.upsert({
    sequenceId: graph.sequenceId,
    orderIndex: ORDER.next,
    createdAt: FIXTURE_DATE,
  });
  expect(inserted).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    createdAt: FIXTURE_DATE,
    deletedAt: null,
  });
  await db
    .update(scenes)
    .set({ deletedAt: FIXTURE_DATE })
    .where(eq(scenes.id, graph.sceneId));
  const revived = await bound.scenes.upsert({
    sequenceId: graph.sequenceId,
    orderIndex: ORDER.main,
  });
  expect(revived).toMatchObject({ id: graph.sceneId, deletedAt: null });
  const before = await outputSnapshot(db);
  await expect(
    bound.scenes.updateContinuity(graph.sceneId, originalContinuity(), {
      actorId: null,
    })
  ).resolves.toBeUndefined();
  expect(await outputSnapshot(db)).toEqual(before);
});

it('versions continuity while preserving selected script, dialogue and narrative', async () => {
  const [original] = await db
    .select()
    .from(sceneScriptVersions)
    .where(eq(sceneScriptVersions.id, graph.sceneId));
  await output().scenes.updateContinuity(graph.sceneId, CONTINUITY, {
    actorId: null,
  });
  const scene = await unbound().scenes.getById(graph.sceneId);
  expect(scene?.selectedScriptVersionId).not.toBe(graph.sceneId);
  if (!scene?.selectedScriptVersionId)
    throw new Error('Synthetic continuity write needs a selected script');
  const [version] = await db
    .select()
    .from(sceneScriptVersions)
    .where(eq(sceneScriptVersions.id, scene.selectedScriptVersionId));
  expect(version).toMatchObject({
    ...NARRATIVE,
    content: original?.content,
    continuity: CONTINUITY,
    source: 'edit',
    hasNarrative: true,
  });
  expect(version?.createdAt).toBeInstanceOf(Date);
});

it('replays same-content specs with a stable id and decodes their JSON/date defaults', async () => {
  const bound = output();
  const rewriteClaimId = generateId();
  await db
    .update(shots)
    .set({ pendingSpecVersionId: rewriteClaimId })
    .where(eq(shots.id, graph.shotId));
  const first = await bound.shotSpecVersions.write(specInput(graph));
  const replay = await bound.shotSpecVersions.write(specInput(graph));
  expect(replay).toEqual(first);
  expect(first).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    spec: specInput(graph).spec,
    inputHash: HASH,
    createdBy: null,
  });
  expect(first.createdAt).toBeInstanceOf(Date);
  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, graph.shotId));
  expect(shot?.selectedSpecVersionId).toBe(first.id);
  expect(shot?.pendingSpecVersionId).toBe(rewriteClaimId);
});

it('does not reuse a selected spec that actually belongs to another shot', async () => {
  await db
    .update(shots)
    .set({ selectedSpecVersionId: graph.secondSpecId })
    .where(eq(shots.id, graph.shotId));
  const version = await output().shotSpecVersions.write({
    ...specInput(graph),
    spec: SPEC,
    inputHash: 'initial',
  });
  expect(version).toMatchObject({ shotId: graph.shotId, spec: SPEC });
  expect(version.id).not.toBe(graph.secondSpecId);
  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, graph.shotId));
  expect(shot?.selectedSpecVersionId).toBe(version.id);
});

it('stores derived visual codecs and selects/demotes only its own frame', async () => {
  const version = await output().framePromptVersions.write(frameInput(graph));
  expect(version).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    text: PROMPT_TEXT,
    components: COMPONENTS,
    source: 'derived',
    specVersionId: graph.specId,
    status: STATUS.completed,
    createdBy: null,
  });
  expect(version.createdAt).toBeInstanceOf(Date);
  expect(
    await unbound().framePromptVersions.getSelected(graph.frameId)
  ).toEqual(version);
  const [claim] = await db
    .select()
    .from(framePromptVersions)
    .where(eq(framePromptVersions.id, graph.imageClaimId));
  expect(claim).toMatchObject({ status: 'generating', pendingInputHash: null });
});

it('stores derived motion JSON, false booleans and null dialogue with selection/demotion', async () => {
  const version = await output().shotPromptVersions.write(motionInput(graph));
  expect(version).toMatchObject({
    id: expect.stringMatching(ULID_PATTERN),
    text: PROMPT_TEXT,
    audio: AUDIO,
    parameters: PARAMETERS,
    usesStartFrame: false,
    dialogue: null,
    source: 'derived',
    specVersionId: graph.specId,
    createdBy: null,
    status: STATUS.completed,
  });
  expect(version.createdAt).toBeInstanceOf(Date);
  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, graph.shotId));
  const [claim] = await db
    .select()
    .from(shotPromptVersions)
    .where(eq(shotPromptVersions.id, graph.motionClaimId));
  expect(shot?.selectedMotionPromptVersionId).toBe(version.id);
  expect(claim).toMatchObject({ status: 'generating', pendingInputHash: null });
});

const CHANNELS = ['visual', 'motion'] as const;
type Channel = (typeof CHANNELS)[number];
function writePrompt(
  bound: Output,
  target: Graph,
  channel: Channel,
  select = true
) {
  return channel === 'visual'
    ? bound.framePromptVersions.write(frameInput(target, select))
    : bound.shotPromptVersions.write(motionInput(target, select));
}

it.each(CHANNELS)(
  '%s select=false retains history, pointer and live claim',
  async (channel) => {
    const before = await outputSnapshot(db);
    const bound = output();
    const first = await writePrompt(bound, graph, channel, false);
    const replay = await writePrompt(bound, graph, channel, false);
    expect(replay.id).toBe(first.id);
    const after = await outputSnapshot(db);
    const table =
      channel === 'visual' ? 'frame_prompt_versions' : 'shot_prompt_versions';
    const rows = after[table];
    expect(Array.isArray(rows)).toBe(true);
    const appended = rows.filter((row) => row.id === first.id);
    expect(appended).toHaveLength(1);
    expect({
      ...after,
      [table]: rows.filter((row) => row.id !== first.id),
    }).toEqual(before);
  }
);

it.each(CHANNELS)(
  '%s fences selection/demotion after its independent append',
  async (channel) => {
    const bound = output();
    const assertUnchanged = replaceBeforeBatch(db, graph);
    const error = await errorFrom(writePrompt(bound, graph, channel));
    await assertUnchanged();
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);

it.each(CHANNELS)(
  '%s rejects a stale history-only dedupe return after its real read',
  async (channel) => {
    const bound = output();
    await writePrompt(bound, graph, channel, false);
    const match =
      channel === 'visual'
        ? /from "frame_prompt_versions"/i
        : /from "shot_prompt_versions" where/i;
    const assertUnchanged = replaceAfterRead(db, graph, match);
    const error = await errorFrom(writePrompt(bound, graph, channel, false));
    await assertUnchanged();
    expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
  }
);

it('rejects a stale same-content spec return after the selected-version read', async () => {
  const bound = output();
  const assertUnchanged = replaceAfterRead(
    db,
    graph,
    /from "shots" inner join "shot_spec_versions"/i
  );
  const error = await errorFrom(
    bound.shotSpecVersions.write({
      ...specInput(graph),
      spec: SPEC,
      inputHash: 'initial',
    })
  );
  await assertUnchanged();
  expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
});

it('rejects a stale unchanged-continuity return after its scene read', async () => {
  const bound = output();
  const assertUnchanged = replaceAfterRead(db, graph, /from "scenes"/i);
  const error = await errorFrom(
    bound.scenes.updateContinuity(graph.sceneId, originalContinuity(), {
      actorId: null,
    })
  );
  await assertUnchanged();
  expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
});

it.each(CHANNELS)(
  '%s identical hash/text replays dedupe and changed text appends',
  async (channel) => {
    const bound = output();
    const first = await writePrompt(bound, graph, channel);
    const replay = await writePrompt(bound, graph, channel);
    expect(replay.id).toBe(first.id);
    const next =
      channel === 'visual'
        ? await bound.framePromptVersions.write({
            ...frameInput(graph),
            text: PROMPT_TEXT + '改',
          })
        : await bound.shotPromptVersions.write({
            ...motionInput(graph),
            text: PROMPT_TEXT + '改',
          });
    expect(next.id).not.toBe(first.id);
  }
);

it('preserves audio-sensitive motion dedupe at unchanged text/hash', async () => {
  const bound = output();
  const first = await bound.shotPromptVersions.write(motionInput(graph));
  const next = await bound.shotPromptVersions.write({
    ...motionInput(graph),
    audio: { ...AUDIO, ambientSound: '不同环境声' },
  });
  expect(next.id).not.toBe(first.id);
});

describe.each(CHANNELS)('%s derived provenance', (channel) => {
  it.each(['different source', 'different spec'] as const)(
    'does not reuse %s with matching hash/text',
    async (kind) => {
      const prior = await seedProvenance(channel, kind);
      const version = await writePrompt(output(), graph, channel);
      expect(version.id).not.toBe(prior);
      expect(version).toMatchObject({
        source: 'derived',
        specVersionId: graph.specId,
        text: PROMPT_TEXT,
        inputHash: HASH,
      });
      const selected =
        channel === 'visual'
          ? (
              await db.select().from(frames).where(eq(frames.id, graph.frameId))
            )[0]?.selectedImagePromptVersionId
          : (await db.select().from(shots).where(eq(shots.id, graph.shotId)))[0]
              ?.selectedMotionPromptVersionId;
      expect(selected).toBe(version.id);
    }
  );
  it('preserves ordinary standalone cross-source dedupe', async () => {
    const prior = await seedProvenance(channel, 'different source');
    const version = await writePrompt(unbound(), graph, channel);
    expect(version.id).toBe(prior);
    expect(version.source).toBe('user-edit');
  });
});

async function seedProvenance(
  channel: Channel,
  kind: 'different source' | 'different spec'
) {
  const id = generateId();
  const otherSpecId = generateId();
  await db.insert(shotSpecVersions).values({
    id: otherSpecId,
    shotId: graph.shotId,
    spec: SPEC,
    source: 'analysis',
  });
  const base = {
    id,
    text: PROMPT_TEXT,
    source:
      kind === 'different source'
        ? ('user-edit' as const)
        : ('derived' as const),
    specVersionId: kind === 'different source' ? null : otherSpecId,
    inputHash: HASH,
    analysisModel: MODEL,
  };
  if (channel === 'visual')
    await db
      .insert(framePromptVersions)
      .values({ ...base, frameId: graph.frameId });
  else
    await db.insert(shotPromptVersions).values({
      ...base,
      shotId: graph.shotId,
      promptType: 'motion',
      audio: AUDIO,
    });
  return id;
}

describe.each(CHANNELS)('%s derived target admission', (channel) => {
  it.each([
    'other shot',
    'other sequence',
    'foreign organization',
    'missing',
  ] as const)('rejects a spec from $0', async (kind) => {
    const specId = await invalidSpecId(kind);
    const before = await outputSnapshot(db);
    const promise =
      channel === 'visual'
        ? output().framePromptVersions.write({
            ...frameInput(graph),
            specVersionId: specId,
          })
        : output().shotPromptVersions.write({
            ...motionInput(graph),
            specVersionId: specId,
          });
    expect(await errorFrom(promise)).toBeInstanceOf(Error);
    expect(await outputSnapshot(db)).toEqual(before);
  });
});

async function invalidSpecId(
  kind: 'other shot' | 'other sequence' | 'foreign organization' | 'missing'
) {
  if (kind === 'other shot') return graph.secondSpecId;
  if (kind === 'missing') return generateId();
  const space = kind === 'other sequence' ? graph : await seedSpace(db);
  return (await seedOutputGraph(db, space)).specId;
}

it.each(['wrong sequence', 'wrong shot'] as const)(
  'rejects frames with a denormalized %s for all prompt sources',
  async (kind) => {
    const foreign = await seedOutputGraph(db, graph);
    const patch =
      kind === 'wrong sequence'
        ? { sequenceId: foreign.sequenceId }
        : { shotId: foreign.shotId, orderIndex: ORDER.next };
    await db.update(frames).set(patch).where(eq(frames.id, graph.frameId));
    const before = await outputSnapshot(db);
    await expect(
      output().framePromptVersions.write(frameInput(graph))
    ).rejects.toBeInstanceOf(Error);
    await expect(
      output().framePromptVersions.write({
        ...frameInput(graph),
        source: 'user-edit',
      })
    ).rejects.toBeInstanceOf(Error);
    expect(await outputSnapshot(db)).toEqual(before);
  }
);

it('migrates selected legacy dialogue before a valid motion repoint exactly once', async () => {
  const legacy = await seedLegacy(db, graph);
  const bound = output();
  const version = await bound.shotPromptVersions.write(motionInput(legacy));
  await bound.shotPromptVersions.write(motionInput(legacy));
  const rows = await db
    .select()
    .from(shotDialogueVersions)
    .where(eq(shotDialogueVersions.shotId, legacy.shotId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ lines: CHANGED_LINES, source: 'prompt' });
  expect(rows[0]?.selectedAt).toBeInstanceOf(Date);
  expect(version.dialogue).toBeNull();
});

it.each([
  'other shot',
  'other sequence',
  'foreign organization',
  'missing',
] as const)(
  'does not migrate legacy dialogue when derived spec is %s',
  async (kind) => {
    const legacy = await seedLegacy(db, graph);
    const specId =
      kind === 'other shot' ? graph.specId : await invalidSpecId(kind);
    const before = await outputSnapshot(db);
    const error = await errorFrom(
      output().shotPromptVersions.write({
        ...motionInput(legacy),
        specVersionId: specId,
      })
    );
    expect(error).toBeInstanceOf(Error);
    expect(await outputSnapshot(db)).toEqual(before);
  }
);

it('fences legacy dialogue migration itself after precheck and before its INSERT', async () => {
  const legacy = await seedLegacy(db, graph);
  const race = await outputRace(
    db,
    graph,
    /^\s*insert into "shot_dialogue_versions"/i
  );
  const error = await errorFrom(
    output().shotPromptVersions.write(motionInput(legacy))
  );
  await race.assert();
  expect(error).toBeInstanceOf(StoryboardContentOwnershipError);
});

it('keeps original spec insert/selection batch rollback and original SQL cause', async () => {
  const before = await outputSnapshot(db);
  await failWrite(db, 'shots');
  await expectOriginalFault(output().shotSpecVersions.write(specInput(graph)));
  expect(await outputSnapshot(db)).toEqual(before);
});

it('keeps continuity version/selection batch rollback and original SQL cause', async () => {
  const before = await outputSnapshot(db);
  await failWrite(db, 'scenes');
  await expectOriginalFault(
    output().scenes.updateContinuity(graph.sceneId, CONTINUITY, {
      actorId: null,
    })
  );
  expect(await outputSnapshot(db)).toEqual(before);
});

it.each(CHANNELS)(
  '%s rolls back selection/demotion together while keeping the independent append',
  async (channel) => {
    const before = await outputSnapshot(db);
    const table =
      channel === 'visual' ? 'frame_prompt_versions' : 'shot_prompt_versions';
    await failWrite(db, table);
    await expectOriginalFault(writePrompt(output(), graph, channel));
    const after = await outputSnapshot(db);
    const appended = after[table].filter(
      (row) =>
        row.text === PROMPT_TEXT &&
        (channel === 'visual'
          ? row.frame_id === graph.frameId
          : row.shot_id === graph.shotId)
    );
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      source: 'derived',
      spec_version_id: graph.specId,
    });
    expect({
      ...after,
      [table]: after[table].filter((row) => row.id !== appended[0]?.id),
    }).toEqual(before);
  }
);

it('preserves a real legacy migration SQL error without appending/repointing a prompt', async () => {
  const legacy = await seedLegacy(db, graph);
  const before = await outputSnapshot(db);
  await failWrite(db, 'shot_dialogue_versions', 'INSERT');
  await expectOriginalFault(
    output().shotPromptVersions.write(motionInput(legacy))
  );
  expect(await outputSnapshot(db)).toEqual(before);
});

it('retains recordOnce dedupe, void return and typed analysis duration updates', async () => {
  const bound = output();
  const event = eventInput(graph);
  await expect(bound.sequenceEvents.recordOnce(event)).resolves.toBeUndefined();
  const before = await outputSnapshot(db);
  await expect(bound.sequenceEvents.recordOnce(event)).resolves.toBeUndefined();
  expect(await outputSnapshot(db)).toEqual(before);
  await expect(
    bound.sequences.updateAnalysisDurationMs(graph.sequenceId, DURATION_MS)
  ).resolves.toBeUndefined();
  const [sequence] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, graph.sequenceId));
  expect(sequence?.analysisDurationMs).toBe(DURATION_MS);
});
