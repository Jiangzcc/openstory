import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestDb } from '@/platform/server/db/test-d1';
import { eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  framePromptVersions,
  shotPromptVersions,
  shotSpecVersions,
  shots,
  styles,
  organization,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { localizeTemplateStyleConfig } from '@/look/localization/style-content';
import type { Locale } from '@/platform/i18n/locale';
import { SUPPORTED_LOCALES } from '@/platform/i18n/locale';
import type {
  CharacterBibleEntry,
  LocationBibleEntry,
  Scene,
} from '@/shots/scene-analysis.schema';
import { DEFAULT_ANALYSIS_MODEL } from '@/models/models.config';
import { createCastRecords } from '@/cast/server/workflows/cast-records';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { shotWorkItems } from '@/shots/server/shot-work-items';
import { persistShotSpec } from '@/shots/server/persist-shot-spec';

let closeDb: () => Promise<void>;
let db: Database;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');
const { computeGenerationPlan } = await import('./generation-plan');
const { computePlan } = await import('@/shots/server/update-stale-plan');

const character: CharacterBibleEntry = {
  characterId: 'maya',
  name: 'Maya',
  age: '30',
  gender: 'woman',
  ethnicity: '',
  physicalDescription: 'dark hair',
  standardClothing: 'yellow coat',
  looks: [],
  personality: '',
  movement: '',
  voiceDescription: '',
  voiceOnly: false,
  isPerson: true,
  rendering: 'Photoreal live action',
  consistencyTag: 'maya',
};
const location: LocationBibleEntry = {
  locationId: 'hall',
  name: 'Hall',
  type: 'interior',
  description: 'A stone hall',
  architecturalStyle: 'gothic',
  keyFeatures: 'stone arches',
  ambiance: 'quiet',
  rendering: 'Photoreal live action',
  consistencyTag: 'hall',
  firstMention: { sceneId: 'analysis-scene', text: 'Hall', lineNumber: 1 },
};
const scene: Scene = {
  sceneId: 'analysis-scene',
  sceneNumber: 1,
  originalScript: { extract: 'Maya crosses the hall.', dialogue: [] },
  metadata: {
    title: 'Hall',
    location: 'Hall',
    timeOfDay: 'day',
    storyBeat: '',
    durationSeconds: 6,
  },
  continuity: {
    characterTags: ['maya'],
    environmentTag: 'hall',
    colorPalette: '',
    lightingSetup: '',
    styleTag: '',
  },
  shots: [1, 2].map((shotNumber) => ({
    shotNumber,
    framing: {
      shotSize: 'wide',
      angle: 'eye level',
      composition: 'Maya in the hall',
      subjectStartState: 'standing',
    },
    action: 'Maya walks',
    cameraMovement: { move: 'static', pacing: 'slow' },
    direction: '',
    soundCue: '',
    dialogue: [],
    durationSeconds: 3,
  })),
};
beforeEach(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterEach(() => closeDb());

async function expectFreshLocalizedPlan(promptLocale: Locale) {
  const template = DEFAULT_STYLE_TEMPLATES[0];
  if (!template) throw new Error('Missing platform template');
  const styleConfig = localizeTemplateStyleConfig(template, promptLocale);
  const organizationId = generateId(),
    actorId = generateId(),
    sequenceId = generateId(),
    styleId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Organization',
    slug: organizationId,
  });
  await db
    .insert(user)
    .values({ id: actorId, name: 'User', email: 'persist@example.com' });
  await db.insert(styles).values({ ...template, id: styleId, organizationId });
  const scopedDb = createScopedDb(organizationId, actorId);
  await scopedDb.sequences.create({
    id: sequenceId,
    title: 'Sequence',
    styleId,
    resolvedStyleConfig: styleConfig,
    analysisModel: DEFAULT_ANALYSIS_MODEL,
    imageModel: 'nano_banana_2',
    videoModel: 'kling_v3_pro',
    aspectRatio: '16:9',
    generateStartFrames: true,
    generationStopAt: 'images',
  });
  await scopedDb.sequences.update({
    id: sequenceId,
    status: 'completed',
    includeMusic: false,
  });
  expect((await scopedDb.sequences.getById(sequenceId))?.styleConfig).toEqual(
    styleConfig
  );
  const narrative = {
    title: 'Hall',
    location: 'Hall',
    timeOfDay: 'day',
    storyBeat: '',
    continuity: scene.continuity ?? null,
  };
  const savedScene = await scopedDb.scenes.create(
    { sequenceId, orderIndex: 0 },
    narrative,
    { createdBy: actorId }
  );
  await scopedDb.sceneScriptVersions.write({
    sceneId: savedScene.id,
    content: scene.originalScript,
    narrative,
    source: 'split',
  });
  const mapping = [];
  for (const shotNumber of [1, 2]) {
    const shot = await scopedDb.shots.create({
      sequenceId,
      sceneId: savedScene.id,
      shotNumber,
      durationMs: 3000,
    });
    await scopedDb.shots.ensureAnchorFrames([shot]);
    const anchor = (await scopedDb.frames.getAnchorsByShots([shot.id])).get(
      shot.id
    );
    if (!anchor) throw new Error('Missing anchor');
    mapping.push({
      analysisSceneId: scene.sceneId,
      shotId: shot.id,
      frameId: anchor.id,
      shotNumber,
    });
  }
  await createCastRecords(toWorkflowScopedDb(scopedDb), {
    sequenceId,
    cast: [],
    characterBible: [character],
    locationBible: [location],
    elementBible: [],
    locationMatches: [],
    existingElements: [],
  });
  // Twice: a replayed step must not append a second spec or prompt.
  for (const _replay of [1, 2]) {
    for (const item of shotWorkItems([scene], mapping)) {
      const written = await persistShotSpec(
        toWorkflowScopedDb(scopedDb),
        item,
        {
          styleConfig,
          characterBible: [character],
          locationBible: [location],
          elementBible: [],
          aspectRatio: '16:9',
          analysisModel: DEFAULT_ANALYSIS_MODEL,
          referenceOnly: false,
          promptLocale,
        }
      );
      expect(written).toEqual({ stillPrompt: true });
    }
  }
  const specRows = await db.select().from(shotSpecVersions);
  expect(specRows).toHaveLength(2);
  // Key order is not identity: a reordered copy of the selected spec is a replay.
  const first = specRows[0];
  if (!first) throw new Error('Missing spec row');
  const reordered = {
    soundCue: first.spec.soundCue,
    direction: first.spec.direction,
    cameraMovement: first.spec.cameraMovement,
    action: first.spec.action,
    framing: first.spec.framing,
  };
  const replayed = await scopedDb.shotSpecVersions.write({
    shotId: first.shotId,
    spec: reordered,
    source: 'analysis',
    inputHash: first.inputHash,
    createdBy: null,
  });
  expect(replayed.id).toBe(first.id);
  // A changed spec appends a version and moves the pointer to it.
  const changed = await scopedDb.shotSpecVersions.write({
    shotId: first.shotId,
    spec: { ...first.spec, action: 'changed' },
    source: 'analysis',
    inputHash: first.inputHash,
    createdBy: null,
  });
  expect(changed.id).not.toBe(first.id);
  const [moved] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, first.shotId));
  expect(moved?.selectedSpecVersionId).toBe(changed.id);
  expect(
    (await computeGenerationPlan(scopedDb, sequenceId)).units.filter(
      (unit) => unit.kind.startsWith('prompt:') && unit.state === 'stale'
    )
  ).toHaveLength(2);
  // Restore so the assertions below still see the persisted spec selected.
  await db
    .update(shots)
    .set({ selectedSpecVersionId: first.id })
    .where(eq(shots.id, first.shotId));
  for (const m of mapping) {
    const [shot] = await db.select().from(shots).where(eq(shots.id, m.shotId));
    const spec = specRows.find((row) => row.shotId === m.shotId);
    expect(shot?.selectedSpecVersionId).toBe(spec?.id);
    const motion = await db
      .select()
      .from(shotPromptVersions)
      .where(eq(shotPromptVersions.shotId, m.shotId));
    expect(motion.map((row) => [row.source, row.specVersionId])).toEqual([
      ['derived', spec?.id],
    ]);
    expect(motion[0]?.text).toContain('Maya walks');
    expect(motion[0]?.text).toContain(
      promptLocale === 'zh-CN' ? '运镜:' : 'Camera:'
    );
    const still = await db
      .select()
      .from(framePromptVersions)
      .where(eq(framePromptVersions.frameId, m.frameId));
    expect(still.map((row) => [row.source, row.specVersionId])).toEqual([
      ['derived', spec?.id],
    ]);
    expect(still[0]?.text).toContain(styleConfig.look.artStyle);
    expect(still[0]?.text).toContain('Maya in the hall');
    expect(still[0]?.text).toContain('hall');
  }
  const { units } = await computeGenerationPlan(scopedDb, sequenceId);
  expect(
    units.filter((u) => u.kind.startsWith('prompt:')).map((u) => u.state)
  ).toEqual(['done', 'done', 'done', 'done']);
  expect(
    units.filter((u) => u.kind.startsWith('sheet:')).map((u) => u.state)
  ).toEqual(['missing', 'missing']);
  const plan = await computePlan({
    scopedDb,
    sequenceId,
    userId: actorId,
    units: mapping.map((m) => ({ kind: 'still', id: m.shotId })),
  });
  expect(plan.promptContext?.characterBible).toHaveLength(1);
  expect(plan.promptContext?.locationBible).toHaveLength(1);
  const cast = await scopedDb.characters.list(sequenceId);
  const places = await scopedDb.locations.list(sequenceId);
  expect(plan.targets[0]?.referenceIds).toHaveLength(2);
  expect(plan.targets[0]?.referenceIds).toEqual(
    expect.arrayContaining([cast[0]?.id, places[0]?.id])
  );
  expect(
    plan.targets.every((target) => !target.regenVisual && !target.regenMotion)
  ).toBe(true);
  await createCastRecords(toWorkflowScopedDb(scopedDb), {
    sequenceId,
    cast: [],
    characterBible: [{ ...character, standardClothing: 'red armor' }],
    locationBible: [location],
    elementBible: [],
    locationMatches: [],
    existingElements: [],
  });
  const { units: edited } = await computeGenerationPlan(scopedDb, sequenceId);
  expect(
    edited
      .filter((u) => u.kind.startsWith('prompt:'))
      .every((u) => u.state === 'stale')
  ).toBe(true);
  // Restore the bible first so the following assertion isolates a style edit.
  await createCastRecords(toWorkflowScopedDb(scopedDb), {
    sequenceId,
    cast: [],
    characterBible: [character],
    locationBible: [location],
    elementBible: [],
    locationMatches: [],
    existingElements: [],
  });
  expect(
    (await computeGenerationPlan(scopedDb, sequenceId)).units
      .filter((u) => u.kind.startsWith('prompt:'))
      .every((u) => u.state === 'done')
  ).toBe(true);
  await db
    .update(styles)
    .set({
      config: {
        ...styleConfig,
        look: { ...styleConfig.look, colorPalette: ['red'] },
      },
    })
    .where(eq(styles.id, styleId));
  expect(
    (await computeGenerationPlan(scopedDb, sequenceId)).units
      .filter((unit) => unit.kind.startsWith('prompt:'))
      .every((unit) => unit.state === 'done')
  ).toBe(true);
  expect((await scopedDb.sequences.getById(sequenceId))?.styleConfig).toEqual(
    styleConfig
  );
  await scopedDb.sequences.update({
    id: sequenceId,
    styleId,
    resolvedStyleConfig: {
      ...styleConfig,
      look: { ...styleConfig.look, colorPalette: ['red'] },
    },
  });
  const { units: changedStyle } = await computeGenerationPlan(
    scopedDb,
    sequenceId
  );
  expect(
    changedStyle
      .filter((u) => u.kind.startsWith('prompt:'))
      .every((u) => u.state === 'stale')
  ).toBe(true);
}

it.each(SUPPORTED_LOCALES)(
  'keeps %s snapshot-derived prompts current before sheets exist, while retaining edit staleness',
  expectFreshLocalizedPlan
);
