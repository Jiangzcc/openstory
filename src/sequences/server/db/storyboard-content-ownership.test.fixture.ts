import { eq, sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import {
  frames,
  organization,
  sceneScriptVersions,
  scenes,
  sequenceElements,
  sequences,
  shotDialogueClaims,
  shotDialogueSections,
  shotDialogueVersions,
  shots,
  styles,
} from '@/platform/server/db/schema';
import type {
  NewShot,
  SceneNarrative,
  ShotDialogueLine,
} from '@/platform/server/db/schema';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { dbSceneId } from '@/shots/scene-id';

// Synthetic fixtures; real migrated SQL through the Node SQLite D1 adapter only.
export const STATUS = {
  processing: 'processing',
  failed: 'failed',
  completed: 'completed',
} as const;
export const FIXTURE_DATE = new Date('2026-11-01T08:00:00.000Z');
export const SHOT_COUNT = 7;
export const DEFAULT_DURATION_MS = 3000;
export const CHANGED_DURATION_MS = 6500;
export const FIRST_SHOT = 1;
export const ORDER = { main: 0, unseeded: 1, empty: 2, next: 3 } as const;
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const SQL_FAULT = 'synthetic_storyboard_content_fault';
export const SQL_FAILURE = 'Synthetic storyboard content write failure';
export const INITIAL_LINES: ShotDialogueLine[] = [
  { character: '小林', line: '原对白。', tone: '平静' },
];
export const CHANGED_LINES: ShotDialogueLine[] = [
  {
    character: '小林',
    line: '新对白："回家"\n第二行。',
    tone: '坚定',
    voiceToken: 'DIALOGUE',
  },
];
export const SPLIT_CONTENT = {
  extract: '合成剧本："你好"\n第二行。',
  dialogue: [{ character: '小林', line: '你好。', tone: '平静' }],
};
export const NARRATIVE: SceneNarrative = {
  title: '合成场景',
  location: '车站',
  timeOfDay: '清晨',
  storyBeat: '回家',
  continuity: {
    characterTags: ['xiaolin'],
    characterLooks: {},
    environmentTag: 'station',
    elementTags: ['LOGO'],
    lightingSetup: '自然光',
    styleTag: 'synthetic',
  },
};
const SNAPSHOT_TABLES = [
  'sequences',
  'scenes',
  'shots',
  'frames',
  'scene_script_versions',
  'shot_dialogue_versions',
  'shot_dialogue_claims',
  'shot_dialogue_sections',
  'dialogue_speeches',
  'sequence_elements',
  'sequence_events',
] as const;

export type Content = ReturnType<ScopedDb['storyboardContent']>;
export type Graph = Awaited<ReturnType<typeof seedGraph>>;
export type Mutation = {
  name: string;
  write: (content: Content, graph: Graph) => Promise<unknown>;
};
export const SCRIPT_FALLBACKS = [
  {
    name: 'manual nonempty script',
    hasSplit: false,
    extract: 'Synthetic user edit',
  },
  { name: 'manual empty script', hasSplit: false, extract: '' },
  {
    name: 'edited selection with split',
    hasSplit: true,
    extract: 'Synthetic user edit',
  },
] as const;

export async function prepareScriptFallback(
  scoped: ScopedDb,
  graph: Graph,
  scenario: (typeof SCRIPT_FALLBACKS)[number]
) {
  const sceneId = scenario.hasSplit ? graph.sceneId : graph.unseededId;
  const edited = await scoped.sceneScriptVersions.write({
    sceneId,
    content: { extract: scenario.extract, dialogue: [] },
    narrative: NARRATIVE,
    source: 'edit',
  });
  return {
    edited,
    input: {
      sceneId,
      content: SPLIT_CONTENT,
      narrative: { ...NARRATIVE, title: '新的合成标题' },
    },
    expectedContent: scenario.extract ? edited.content : SPLIT_CONTENT,
  };
}

export async function seedSpace(db: Database) {
  const organizationId = generateId();
  const [template] = DEFAULT_STYLE_TEMPLATES;
  if (!template) throw new Error('Synthetic storyboard fixture needs a style');
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic storyboard organization',
    slug: organizationId,
  });
  const [style] = await db
    .insert(styles)
    .values({
      organizationId,
      name: 'Synthetic storyboard style',
      config: template.config,
    })
    .returning();
  if (!style) throw new Error('Synthetic style insert failed');
  return { organizationId, styleId: style.id };
}

async function seedStructure(db: Database, sequenceId: string) {
  const sceneId = dbSceneId(generateId());
  const unseededId = dbSceneId(generateId());
  const emptyId = dbSceneId(generateId());
  await db.insert(scenes).values([
    {
      id: sceneId,
      sequenceId,
      orderIndex: ORDER.main,
      updatedAt: FIXTURE_DATE,
    },
    { id: unseededId, sequenceId, orderIndex: ORDER.unseeded },
    { id: emptyId, sequenceId, orderIndex: ORDER.empty },
  ]);
  const shotIds: string[] = [];
  for (let index = 0; index < SHOT_COUNT; index++) {
    const id = generateId();
    await db.insert(shots).values({
      id,
      sequenceId,
      sceneId,
      shotNumber: index + FIRST_SHOT,
      updatedAt: FIXTURE_DATE,
    });
    await db.insert(frames).values({
      sequenceId,
      shotId: id,
      role: 'first',
      orderIndex: ORDER.main,
    });
    shotIds.push(id);
  }
  const [shotId] = shotIds;
  if (!shotId) throw new Error('Synthetic storyboard fixture needs a shot');
  return { sceneId, unseededId, emptyId, shotId, shotIds };
}

async function seedDialogue(
  db: Database,
  shotId: string,
  workflowRunId: string
) {
  const dialogueId = generateId();
  const claimId = generateId();
  const sectionId = generateId();
  await db.insert(shotDialogueVersions).values({
    id: dialogueId,
    shotId,
    lines: INITIAL_LINES,
    source: 'prompt',
    selectedAt: FIXTURE_DATE,
  });
  await db.insert(shotDialogueClaims).values({
    id: claimId,
    shotId,
    sourceKey: 'synthetic-words',
    pendingSourceKey: 'synthetic-words',
    status: 'generating',
    workflowRunId,
  });
  await db.insert(shotDialogueSections).values({
    id: sectionId,
    shotId,
    speechId: generateId(),
    fromSeconds: 0,
    toSeconds: 1,
    sourceKey: 'synthetic-words',
    source: 'generated',
    selectedAt: FIXTURE_DATE,
  });
  return { dialogueId, claimId, sectionId };
}

export async function seedGraph(
  db: Database,
  space: Awaited<ReturnType<typeof seedSpace>>
) {
  const sequenceId = generateId();
  const workflowRunId = 'synthetic-storyboard-' + generateId();
  const rawClaimId = generateId();
  await db.insert(sequences).values({
    id: sequenceId,
    ...space,
    title: 'Synthetic original title',
    status: STATUS.processing,
    workflowRunId,
    updatedAt: FIXTURE_DATE,
  });
  const structure = await seedStructure(db, sequenceId);
  await db.insert(sceneScriptVersions).values({
    id: structure.sceneId,
    sceneId: structure.sceneId,
    content: { extract: 'Synthetic original split', dialogue: [] },
    ...NARRATIVE,
    source: 'split',
    createdAt: FIXTURE_DATE,
  });
  await db
    .update(scenes)
    .set({ selectedScriptVersionId: structure.sceneId })
    .where(eq(scenes.id, structure.sceneId));
  const dialogue = await seedDialogue(db, structure.shotId, workflowRunId);
  const elementId = generateId();
  await db.insert(sequenceElements).values({
    id: elementId,
    sequenceId,
    uploadedFilename: 'synthetic-logo.png',
    token: 'LOGO',
    updatedAt: FIXTURE_DATE,
  });
  return {
    ...space,
    ...structure,
    ...dialogue,
    sequenceId,
    workflowRunId,
    rawClaimId,
    elementId,
    eventId: generateId(),
  };
}

export function splitSeed(graph: Graph) {
  return {
    sceneId: graph.unseededId,
    content: SPLIT_CONTENT,
    narrative: NARRATIVE,
    createdAt: FIXTURE_DATE,
  };
}

export function shotInserts(graph: Graph, conflict = false): NewShot[] {
  return Array.from({ length: SHOT_COUNT }, (_, index) => ({
    sequenceId: graph.sequenceId,
    sceneId: conflict ? graph.sceneId : graph.unseededId,
    shotNumber: index + FIRST_SHOT,
    ...(conflict ? { durationMs: CHANGED_DURATION_MS } : {}),
  }));
}

export async function expectStoredShot(
  db: Database,
  row: Awaited<ReturnType<Content['shots']['bulkUpsert']>>[number]
) {
  const { anchorFrameId, ...record } = row;
  const [stored] = await db.select().from(shots).where(eq(shots.id, row.id));
  expect(stored).toEqual(record);
  const [anchor] = await db
    .select()
    .from(frames)
    .where(eq(frames.id, anchorFrameId));
  expect(anchor).toMatchObject({
    shotId: row.id,
    role: 'first',
    orderIndex: ORDER.main,
  });
  expect(anchor?.createdAt).toBeInstanceOf(Date);
}

export function eventInput(graph: Graph) {
  return {
    id: graph.eventId,
    sequenceId: graph.sequenceId,
    actorId: null,
    kind: 'synthetic.storyboard.content',
    targetType: 'sequence' as const,
    targetId: graph.sequenceId,
    summary: '合成分镜完成',
    data: { shotIds: graph.shotIds },
  };
}

export const MUTATIONS: Mutation[] = [
  {
    name: 'scenes.upsert.insert',
    write: (c, g) =>
      c.scenes.upsert({
        sequenceId: g.sequenceId,
        orderIndex: ORDER.next,
      }),
  },
  {
    name: 'scenes.upsert.conflict',
    write: (c, g) =>
      c.scenes.upsert({
        sequenceId: g.sequenceId,
        orderIndex: ORDER.main,
      }),
  },
  {
    name: 'scenes.deleteFromOrderIndex',
    write: (c, g) => c.scenes.deleteFromOrderIndex(g.sequenceId, ORDER.empty),
  },
  {
    name: 'shots.bulkUpsert.insert',
    write: (c, g) => c.shots.bulkUpsert(shotInserts(g)),
  },
  {
    name: 'shots.bulkUpsert.conflict',
    write: (c, g) => c.shots.bulkUpsert(shotInserts(g, true)),
  },
  {
    name: 'shots.update',
    write: (c, g) =>
      c.shots.update(g.shotId, {
        durationMs: CHANGED_DURATION_MS,
      }),
  },
  { name: 'shots.delete', write: (c, g) => c.shots.delete(g.shotId) },
  {
    name: 'shots.deleteFromShotNumber',
    write: (c, g) => c.shots.deleteFromShotNumber(g.sceneId, FIRST_SHOT),
  },
  {
    name: 'shots.deleteByScenesFromOrderIndex',
    write: (c, g) =>
      c.shots.deleteByScenesFromOrderIndex(g.sequenceId, ORDER.main),
  },
  {
    name: 'sceneScriptVersions.seedSplitVersions',
    write: (c, g) => c.sceneScriptVersions.seedSplitVersions([splitSeed(g)]),
  },
  {
    name: 'sceneScriptVersions.updateSplitContent',
    write: (c, g) =>
      c.sceneScriptVersions.updateSplitContent([
        {
          ...splitSeed(g),
          sceneId: g.sceneId,
        },
      ]),
  },
  {
    name: 'shotDialogue.write',
    write: (c, g) => c.shotDialogue.write(g.shotId, CHANGED_LINES, 'prompt'),
  },
  {
    name: 'sequences.updateTitle',
    write: (c, g) =>
      c.sequences.updateTitle(g.sequenceId, 'Synthetic new title'),
  },
  {
    name: 'sequences.updateWorkflow',
    write: (c, g) =>
      c.sequences.updateWorkflow(g.sequenceId, 'Synthetic new workflow'),
  },
  {
    name: 'sequenceElements.updateFirstMention',
    write: (c, g) =>
      c.sequenceElements.updateFirstMention(g.elementId, {
        sceneId: g.sceneId,
        text: '合成 LOGO 首次出现',
        lineNumber: FIRST_SHOT,
      }),
  },
  {
    name: 'sequenceEvents.recordOnce',
    write: (c, g) => c.sequenceEvents.recordOnce(eventInput(g)),
  },
];

export async function snapshot(db: Database) {
  const rows = await Promise.all(
    SNAPSHOT_TABLES.map((table) =>
      db.all(sql.raw(`SELECT * FROM "${table}" ORDER BY id`))
    )
  );
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table, index) => [table, rows[index]])
  );
}

// Delay only transport execution; every original prepared SQL statement still runs.
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

export function replaceOwnerBeforeWrite(
  db: Database,
  graph: Graph,
  match = /^\s*(insert|update|delete)\b/i,
  skipMatches = 0
) {
  let handedOver = false;
  let prechecked = false;
  let matches = 0;
  let expected: Awaited<ReturnType<typeof snapshot>> | undefined;
  const prepare = db.$client.prepare.bind(db.$client);
  const batch = db.batch.bind(db);
  const handover = async () => {
    if (handedOver) return;
    handedOver = true;
    await db
      .update(sequences)
      .set({ workflowRunId: 'synthetic-replacement-run' })
      .where(eq(sequences.id, graph.sequenceId));
    expected = await snapshot(db);
  };
  vi.spyOn(db.$client, 'prepare').mockImplementation((query) => {
    if (!handedOver && /^select "id" from "sequences"/i.test(query)) {
      prechecked = true;
    }
    const statement = prepare(query);
    return match.test(query) && ++matches > skipMatches
      ? beforeExecution(statement, handover)
      : statement;
  });
  vi.spyOn(db, 'batch').mockImplementationOnce(async (queries) => {
    await handover();
    return batch(queries);
  });
  return { observed: () => ({ handedOver, prechecked, expected }) };
}

export function failAt(
  db: Database,
  table: 'scenes' | 'shot_dialogue_versions',
  operation: 'UPDATE' | 'INSERT'
) {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT} BEFORE ${operation} ON ${table} ` +
        `BEGIN SELECT RAISE(ABORT, '${SQL_FAILURE}'); END`
    )
  );
}
