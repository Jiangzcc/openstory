import { eq, sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import {
  framePromptVersions,
  frames,
  sequences,
  shotPromptVersions,
  shots,
  shotSpecVersions,
} from '@/platform/server/db/schema';
import type { StoredShotSpec } from '@/shots/shot-list.schema';
import {
  CHANGED_LINES,
  FIXTURE_DATE,
  NARRATIVE,
  ORDER,
  eventInput,
  replaceOwnerBeforeWrite,
  seedGraph,
  snapshot,
} from './storyboard-content-ownership.test.fixture';

// Synthetic migrated Node SQLite D1 fixtures; execution races substitute transport only.
export type Output = ReturnType<ScopedDb['storyboardAnalysisOutput']>;
export type Graph = Awaited<ReturnType<typeof seedOutputGraph>>;
export const DURATION_MS = 12500;
const REPLACEMENT_RUN = 'synthetic-replacement-run';
export const FAULT_TRIGGER = 'synthetic_analysis_output_fault';
const FAULT_MESSAGE = 'Synthetic analysis output SQL fault';
export const PROMPT_TEXT = '合成派生提示："回家"\n第二行。';
export const HASH = 'synthetic-analysis-output-hash';
export const MODEL = 'synthetic-analysis-model';
export const CONTINUITY = {
  ...NARRATIVE.continuity,
  characterTags: ['xiaolin'],
  characterLooks: {},
  environmentTag: 'synthetic-new-station',
  lightingSetup: '新的自然光',
  styleTag: 'synthetic-output',
};
export const SPEC: StoredShotSpec = {
  framing: {
    shotSize: '中景',
    angle: '平视',
    composition: '左侧 "小林"',
    subjectStartState: '等车\n抬头',
  },
  action: '回家',
  cameraMovement: { move: '推进，再跟随', pacing: '缓慢' },
  direction: '合成方向',
  soundCue: '车站铃声',
};
export const AUDIO = {
  ambientSound: '车站\n广播',
  soundEffects: ['铃声', '"脚步"'],
};
export const PARAMETERS = {
  durationSeconds: 3,
  fps: 24,
  motionAmount: 'low',
  cameraControl: { pan: 0, tilt: 0, zoom: 1, movement: '推进' },
} as const;
export const COMPONENTS = {
  sceneDescription: '车站\n清晨',
  subject: '小林',
  environment: '站台',
  lighting: '自然光',
  camera: '平视',
  composition: '左侧',
  style: '合成',
  technical: '清晰',
  atmosphere: '安静',
};

export function originalContinuity() {
  if (!NARRATIVE.continuity)
    throw new Error('Synthetic fixture needs continuity');
  return NARRATIVE.continuity;
}
const EXTRA_TABLES = [
  'shot_spec_versions',
  'frame_prompt_versions',
  'shot_prompt_versions',
] as const;

async function seedSpecs(db: Database, shotId: string, secondShotId: string) {
  const specId = generateId();
  const secondSpecId = generateId();
  await db.insert(shotSpecVersions).values([
    {
      id: specId,
      shotId,
      spec: SPEC,
      source: 'analysis',
      inputHash: 'initial',
    },
    {
      id: secondSpecId,
      shotId: secondShotId,
      spec: SPEC,
      source: 'analysis',
      inputHash: 'initial',
    },
  ]);
  await db
    .update(shots)
    .set({ selectedSpecVersionId: specId })
    .where(eq(shots.id, shotId));
  await db
    .update(shots)
    .set({ selectedSpecVersionId: secondSpecId })
    .where(eq(shots.id, secondShotId));
  return { specId, secondSpecId };
}

async function seedPrompts(db: Database, shotId: string, frameId: string) {
  const imageId = generateId();
  const motionId = generateId();
  const imageClaimId = generateId();
  const motionClaimId = generateId();
  const base = {
    text: 'Synthetic original prompt',
    source: 'user-edit' as const,
  };
  const pending = {
    text: '',
    source: 'regenerated' as const,
    status: 'generating' as const,
    pendingInputHash: HASH,
  };
  await db.insert(framePromptVersions).values([
    { id: imageId, frameId, ...base },
    { id: imageClaimId, frameId, ...pending },
  ]);
  await db.insert(shotPromptVersions).values([
    { id: motionId, shotId, promptType: 'motion', ...base },
    { id: motionClaimId, shotId, promptType: 'motion', ...pending },
  ]);
  await db
    .update(frames)
    .set({ selectedImagePromptVersionId: imageId })
    .where(eq(frames.id, frameId));
  await db
    .update(shots)
    .set({ selectedMotionPromptVersionId: motionId })
    .where(eq(shots.id, shotId));
  return { imageId, motionId, imageClaimId, motionClaimId };
}

export async function seedOutputGraph(
  db: Database,
  space: Parameters<typeof seedGraph>[1]
) {
  const graph = await seedGraph(db, space);
  const secondShotId = graph.shotIds[1];
  if (!secondShotId)
    throw new Error('Synthetic output fixture needs two shots');
  const [frame] = await db
    .select()
    .from(frames)
    .where(eq(frames.shotId, graph.shotId));
  const [secondFrame] = await db
    .select()
    .from(frames)
    .where(eq(frames.shotId, secondShotId));
  if (!frame || !secondFrame)
    throw new Error('Synthetic output fixture needs frames');
  const specs = await seedSpecs(db, graph.shotId, secondShotId);
  const prompts = await seedPrompts(db, graph.shotId, frame.id);
  return {
    ...graph,
    ...specs,
    ...prompts,
    frameId: frame.id,
    secondFrameId: secondFrame.id,
    secondShotId,
  };
}

export function specInput(graph: Graph) {
  return {
    shotId: graph.shotId,
    spec: { ...SPEC, action: '新的动作："回家"\n站起' },
    source: 'analysis' as const,
    inputHash: HASH,
    createdBy: null,
  };
}

export function frameInput(graph: Graph, select = true) {
  return {
    frameId: graph.frameId,
    text: PROMPT_TEXT,
    components: COMPONENTS,
    source: 'derived' as const,
    specVersionId: graph.specId,
    inputHash: HASH,
    analysisModel: MODEL,
    select,
  };
}

export function motionInput(graph: Graph, select = true) {
  return {
    shotId: graph.shotId,
    promptType: 'motion' as const,
    text: PROMPT_TEXT,
    audio: AUDIO,
    parameters: PARAMETERS,
    usesStartFrame: false,
    source: 'derived' as const,
    specVersionId: graph.specId,
    inputHash: HASH,
    analysisModel: MODEL,
    select,
  };
}

export type Mutation = {
  name: string;
  write: (output: Output, graph: Graph) => Promise<unknown>;
};
export const MUTATIONS: Mutation[] = [
  {
    name: 'scenes.upsert.insert',
    write: (o, g) =>
      o.scenes.upsert({
        sequenceId: g.sequenceId,
        orderIndex: ORDER.next,
        createdAt: FIXTURE_DATE,
      }),
  },
  {
    name: 'scenes.upsert.conflict',
    write: (o, g) =>
      o.scenes.upsert({ sequenceId: g.sequenceId, orderIndex: ORDER.main }),
  },
  {
    name: 'scenes.updateContinuity',
    write: (o, g) =>
      o.scenes.updateContinuity(g.sceneId, CONTINUITY, { actorId: null }),
  },
  {
    name: 'shotSpecVersions.write',
    write: (o, g) => o.shotSpecVersions.write(specInput(g)),
  },
  {
    name: 'framePromptVersions.write',
    write: (o, g) => o.framePromptVersions.write(frameInput(g)),
  },
  {
    name: 'shotPromptVersions.write',
    write: (o, g) => o.shotPromptVersions.write(motionInput(g)),
  },
  {
    name: 'framePromptVersions.history',
    write: (o, g) => o.framePromptVersions.write(frameInput(g, false)),
  },
  {
    name: 'shotPromptVersions.history',
    write: (o, g) => o.shotPromptVersions.write(motionInput(g, false)),
  },
  {
    name: 'sequences.updateAnalysisDurationMs',
    write: (o, g) =>
      o.sequences.updateAnalysisDurationMs(g.sequenceId, DURATION_MS),
  },
  {
    name: 'sequenceEvents.recordOnce',
    write: (o, g) => o.sequenceEvents.recordOnce(eventInput(g)),
  },
];

export async function outputSnapshot(db: Database) {
  const previous = await snapshot(db);
  const read = (table: (typeof EXTRA_TABLES)[number]) =>
    db.all<Record<string, unknown>>(
      sql.raw(`SELECT * FROM "${table}" ORDER BY id`)
    );
  const [specs, visual, motion] = await Promise.all([
    read('shot_spec_versions'),
    read('frame_prompt_versions'),
    read('shot_prompt_versions'),
  ]);
  return {
    ...previous,
    shot_spec_versions: specs,
    frame_prompt_versions: visual,
    shot_prompt_versions: motion,
  };
}

export async function errorFrom(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

export async function expectOriginalFault(promise: Promise<unknown>) {
  const error = await errorFrom(promise);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  expect(cause).toBeInstanceOf(Error);
  expect(cause).toHaveProperty('message', FAULT_MESSAGE);
}

export function failWrite(db: Database, table: string, operation = 'UPDATE') {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${FAULT_TRIGGER} BEFORE ${operation} ON "${table}" BEGIN SELECT RAISE(ABORT, '${FAULT_MESSAGE}'); END`
    )
  );
}

export async function outputRace(db: Database, graph: Graph, match?: RegExp) {
  const before = await outputSnapshot(db);
  const race = replaceOwnerBeforeWrite(db, graph, match);
  return {
    assert: async () => {
      const observed = race.observed();
      expect(observed.handedOver).toBe(true);
      expect(observed.prechecked).toBe(true);
      expect(observed.expected).toBeDefined();
      const extra = Object.fromEntries(
        EXTRA_TABLES.map((table) => [table, before[table]])
      );
      expect(await outputSnapshot(db)).toEqual({
        ...observed.expected,
        ...extra,
      });
    },
  };
}

export async function seedLegacy(db: Database, graph: Graph) {
  const id = generateId();
  await db.insert(shotPromptVersions).values({
    id,
    shotId: graph.secondShotId,
    promptType: 'motion',
    text: 'Synthetic legacy prompt',
    source: 'user-edit',
    dialogue: { presence: true, lines: CHANGED_LINES },
  });
  await db
    .update(shots)
    .set({ selectedMotionPromptVersionId: id })
    .where(eq(shots.id, graph.secondShotId));
  return {
    ...graph,
    shotId: graph.secondShotId,
    frameId: graph.secondFrameId,
    specId: graph.secondSpecId,
  };
}

export function replaceSequenceOwner(
  db: Database,
  graph: Graph,
  workflowRunId = REPLACEMENT_RUN
) {
  return db
    .update(sequences)
    .set({ workflowRunId })
    .where(eq(sequences.id, graph.sequenceId));
}

// Preserve every prepared query; substitute only the next batch's execution boundary.
export function replaceBeforeBatch(db: Database, graph: Graph) {
  let expected: Awaited<ReturnType<typeof outputSnapshot>> | undefined;
  const batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async (queries) => {
    await replaceSequenceOwner(db, graph);
    expected = await outputSnapshot(db);
    return batch(queries);
  });
  return async () => {
    expect(expected).toBeDefined();
    expect(await outputSnapshot(db)).toEqual(expected);
  };
}

function afterReadExecution(
  statement: D1PreparedStatement,
  after: () => Promise<void>
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, key) {
      if (key === 'bind')
        return (...values: unknown[]) =>
          afterReadExecution(target.bind(...values), after);
      if (key === 'raw')
        return async () => {
          const rows = await target.raw();
          await after();
          return rows;
        };
      if (key === 'all')
        return async () => {
          const rows = await target.all();
          await after();
          return rows;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Return the real no-op read, then replace the owner before the method can return it.
export function replaceAfterRead(db: Database, graph: Graph, match: RegExp) {
  let expected: Awaited<ReturnType<typeof outputSnapshot>> | undefined;
  let replaced = false;
  const prepare = db.$client.prepare.bind(db.$client);
  const handover = async () => {
    if (replaced) return;
    replaced = true;
    await replaceSequenceOwner(db, graph);
    expected = await outputSnapshot(db);
  };
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) => {
    const statement = prepare(query);
    return !replaced && match.test(query)
      ? afterReadExecution(statement, handover)
      : statement;
  });
  return async () => {
    expect(replaced).toBe(true);
    expect(expected).toBeDefined();
    expect(await outputSnapshot(db)).toEqual(expected);
  };
}
