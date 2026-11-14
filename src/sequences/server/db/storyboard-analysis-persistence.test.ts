import { NonRetryableError } from 'cloudflare:workflows';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  framePromptVersions,
  frames,
  shotPromptVersions,
  shots,
  shotSpecVersions,
} from '@/platform/server/db/schema';
import type { Scene } from '@/shots/scene-analysis.schema';
import { persistShotSpec } from '@/shots/server/persist-shot-spec';
import type { ShotWorkItem } from '@/shots/server/shot-work-items';
import { bindAnalyzeScriptOutput } from '../workflows/analyze-script-output';
import { StoryboardContentOwnershipError } from './storyboard-content-scope';
import {
  FIRST_SHOT,
  ORDER,
  seedSpace,
} from './storyboard-content-ownership.test.fixture';
import {
  MODEL,
  SPEC,
  errorFrom,
  outputSnapshot,
  originalContinuity,
  replaceSequenceOwner,
  seedOutputGraph,
} from './storyboard-analysis-output.test.fixture';
import type { Graph } from './storyboard-analysis-output.test.fixture';

// Real DB/binder/derivation/hash composition; Node D1 and the repository CF-error alias.
const SHOT_SECONDS = 3;
const SEEDED_SPEC_COUNT = 1;
const SEEDED_PROMPT_COUNT = 2;
const NEW_VERSION_COUNT = 1;
const SHA256 = /^[0-9a-f]{64}$/;
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
afterEach(() => {
  vi.restoreAllMocks();
});

function boundDb() {
  const scoped = createScopedDb(graph.organizationId, generateId());
  return bindAnalyzeScriptOutput(toWorkflowScopedDb(scoped), graph.sequenceId, {
    workflowRunId: graph.workflowRunId,
  });
}

function persistenceScene(): Scene {
  return {
    sceneId: graph.sceneId,
    sceneNumber: FIRST_SHOT,
    originalScript: { extract: '合成剧本：小林等车。', dialogue: [] },
    metadata: {
      title: '合成车站',
      location: '车站',
      timeOfDay: '清晨',
      storyBeat: '回家',
      durationSeconds: SHOT_SECONDS,
    },
    continuity: {
      ...originalContinuity(),
      characterTags: [],
      elementTags: [],
      environmentTag: '',
    },
    shots: [
      {
        ...SPEC,
        shotNumber: FIRST_SHOT,
        durationSeconds: SHOT_SECONDS,
        dialogue: [],
      },
    ],
  };
}

function workItem(referenceOnly: boolean): ShotWorkItem {
  return {
    scene: persistenceScene(),
    sceneIndex: ORDER.main,
    mapping: {
      analysisSceneId: graph.sceneId,
      shotId: graph.shotId,
      frameId: referenceOnly ? null : graph.frameId,
      shotNumber: FIRST_SHOT,
    },
    isSceneHead: true,
    hasSiblingShots: false,
  };
}

function context(
  referenceOnly: boolean
): Parameters<typeof persistShotSpec>[2] {
  const [template] = DEFAULT_STYLE_TEMPLATES;
  if (!template) throw new Error('Synthetic persistence fixture needs a style');
  return {
    styleConfig: template.config,
    characterBible: [],
    locationBible: [],
    elementBible: [],
    aspectRatio: '16:9',
    analysisModel: MODEL,
    referenceOnly,
    promptLocale: 'zh-CN',
  };
}

async function selectedVersions() {
  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, graph.shotId));
  const [frame] = await db
    .select()
    .from(frames)
    .where(eq(frames.id, graph.frameId));
  if (!shot || !frame) throw new Error('Synthetic persistence parents missing');
  const specRows = await db
    .select()
    .from(shotSpecVersions)
    .where(eq(shotSpecVersions.shotId, shot.id));
  const imageRows = await db
    .select()
    .from(framePromptVersions)
    .where(eq(framePromptVersions.frameId, frame.id));
  const motionRows = await db
    .select()
    .from(shotPromptVersions)
    .where(eq(shotPromptVersions.shotId, shot.id));
  return { shot, frame, specRows, imageRows, motionRows };
}

type Stored = Awaited<ReturnType<typeof selectedVersions>>;

function expectProvenance(stored: Stored, referenceOnly: boolean) {
  const { shot, frame, specRows, imageRows, motionRows } = stored;
  const spec = specRows.find((row) => row.id === shot.selectedSpecVersionId);
  expect(spec).toMatchObject({
    shotId: graph.shotId,
    spec: SPEC,
    source: 'analysis',
  });
  expect(spec?.inputHash).toMatch(SHA256);
  expect(spec?.id).not.toBe(graph.specId);
  expect(specRows).toHaveLength(SEEDED_SPEC_COUNT + NEW_VERSION_COUNT);
  const motion = motionRows.find(
    (row) => row.id === shot.selectedMotionPromptVersionId
  );
  expect(motion).toMatchObject({
    shotId: graph.shotId,
    source: 'derived',
    specVersionId: spec?.id,
    analysisModel: MODEL,
    usesStartFrame: !referenceOnly,
  });
  expect(motion?.inputHash).toMatch(SHA256);
  expect(motionRows).toHaveLength(SEEDED_PROMPT_COUNT + NEW_VERSION_COUNT);
  if (referenceOnly) {
    expect(frame.selectedImagePromptVersionId).toBe(graph.imageId);
    expect(imageRows).toHaveLength(SEEDED_PROMPT_COUNT);
    return;
  }
  const image = imageRows.find(
    (row) => row.id === frame.selectedImagePromptVersionId
  );
  expect(image).toMatchObject({
    frameId: graph.frameId,
    source: 'derived',
    specVersionId: spec?.id,
    analysisModel: MODEL,
  });
  expect(image?.inputHash).toMatch(SHA256);
  expect(imageRows).toHaveLength(SEEDED_PROMPT_COUNT + NEW_VERSION_COUNT);
}

it.each([false, true])(
  'persists real spec/prompt composition and idempotent replay, referenceOnly=%s',
  async (referenceOnly) => {
    const bound = boundDb();
    const item = workItem(referenceOnly);
    const input = context(referenceOnly);
    await expect(persistShotSpec(bound, item, input)).resolves.toEqual({
      stillPrompt: !referenceOnly,
    });
    const first = await selectedVersions();
    expectProvenance(first, referenceOnly);
    await expect(persistShotSpec(bound, item, input)).resolves.toEqual({
      stillPrompt: !referenceOnly,
    });
    const replay = await selectedVersions();
    expectProvenance(replay, referenceOnly);
    expect(replay.specRows).toEqual(first.specRows);
    expect(replay.imageRows).toEqual(first.imageRows);
    expect(replay.motionRows).toEqual(first.motionRows);
    expect(replay.shot.selectedSpecVersionId).toBe(
      first.shot.selectedSpecVersionId
    );
    expect(replay.shot.selectedMotionPromptVersionId).toBe(
      first.shot.selectedMotionPromptVersionId
    );
    expect(replay.frame.selectedImagePromptVersionId).toBe(
      first.frame.selectedImagePromptVersionId
    );
  }
);

it('keeps the authorized spec but rejects late prompts after takeover with NonRetryableError', async () => {
  const bound = boundDb();
  const write = bound.shotSpecVersions.write.bind(bound.shotSpecVersions);
  let committed: Awaited<ReturnType<typeof outputSnapshot>> | undefined;
  // Timing substitute only: commit the real spec, then replace its root before prompts.
  vi.spyOn(bound.shotSpecVersions, 'write').mockImplementationOnce(
    async (input) => {
      const version = await write(input);
      await replaceSequenceOwner(db, graph);
      committed = await outputSnapshot(db);
      return version;
    }
  );
  const error = await errorFrom(
    persistShotSpec(bound, workItem(false), context(false))
  );
  expect(error).toBeInstanceOf(NonRetryableError);
  expect(error).toHaveProperty(
    'cause',
    expect.any(StoryboardContentOwnershipError)
  );
  expect(committed).toBeDefined();
  expect(await outputSnapshot(db)).toEqual(committed);
  const stored = await selectedVersions();
  expect(stored.shot.selectedSpecVersionId).not.toBe(graph.specId);
  expect(stored.specRows).toHaveLength(SEEDED_SPEC_COUNT + NEW_VERSION_COUNT);
  expect(stored.frame.selectedImagePromptVersionId).toBe(graph.imageId);
  expect(stored.shot.selectedMotionPromptVersionId).toBe(graph.motionId);
  expect(stored.imageRows).toHaveLength(SEEDED_PROMPT_COUNT);
  expect(stored.motionRows).toHaveLength(SEEDED_PROMPT_COUNT);
});
