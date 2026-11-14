import { eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { sequences, user } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import type {
  CharacterBibleEntry,
  ElementBibleEntry,
  LocationBibleEntry,
} from '@/shots/scene-analysis.schema';
import { seedSpace } from '@/sequences/server/db/storyboard-content-ownership.test.fixture';
import { STORYBOARD_WORKFLOW_STATUS } from '@/sequences/server/db/storyboard-owner';

// Synthetic migrated D1 graph; all supplied prose and model results are synthetic.
export const COUNT = { none: 0, one: 1, two: 2 } as const;
export const NEXT_ROOT = 'synthetic-cast-replacement-root';
export const CHARACTER: CharacterBibleEntry = {
  characterId: 'char_1',
  name: '合成角色小林',
  age: '30s',
  gender: 'female',
  ethnicity: '',
  physicalDescription: '合成测试角色',
  standardClothing: '合成外套',
  looks: [
    {
      lookId: 'char_1:default',
      name: 'Default',
      clothing: '合成外套',
      styling: '',
    },
    { lookId: 'char_1:rain', name: '雨衣', clothing: '合成雨衣', styling: '' },
  ],
  personality: '',
  movement: '',
  voiceDescription: '合成声音描述',
  voiceOnly: false,
  isPerson: true,
  rendering: PHOTOREAL_RENDERING,
  consistencyTag: 'synthetic-character',
};
export const ELEMENT: ElementBibleEntry = {
  token: 'SIGN',
  description: '合成招牌\n"测试"',
  consistencyTag: 'synthetic-sign',
  firstMention: {
    sceneId: 'synthetic-scene',
    text: '招牌',
    lineNumber: COUNT.one,
  },
};
const LOCATION: LocationBibleEntry = {
  locationId: 'loc_1',
  name: '合成车站',
  type: 'interior',
  description: '合成站厅',
  architecturalStyle: '',
  keyFeatures: '',
  ambiance: '',
  rendering: PHOTOREAL_RENDERING,
  consistencyTag: 'synthetic-station',
  firstMention: ELEMENT.firstMention,
};

export async function seedCastSequence(db: Database) {
  const { organizationId, styleId } = await seedSpace(db);
  const userId = generateId();
  const sequenceId = generateId();
  const rawClaimId = generateId();
  const workflowRunId = 'synthetic-storyboard-' + rawClaimId;
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic cast user',
    email: userId + '@example.com',
  });
  await db.insert(sequences).values({
    id: sequenceId,
    organizationId,
    title: 'Synthetic cast sequence',
    styleId,
    status: STORYBOARD_WORKFLOW_STATUS.processing,
    workflowRunId,
  });
  return { organizationId, userId, sequenceId, rawClaimId, workflowRunId };
}

export type Graph = Awaited<ReturnType<typeof seedCastSequence>>;

export function castInput(graph: Graph) {
  return {
    sequenceId: graph.sequenceId,
    storyboardOwner: { workflowRunId: graph.workflowRunId },
    cast: [],
    characterBible: [CHARACTER],
    locationBible: [LOCATION],
    locationMatches: [],
    elementBible: [ELEMENT],
    existingElements: [],
  };
}

export function replaceCastOwner(db: Database, graph: Graph) {
  return db
    .update(sequences)
    .set({ workflowRunId: NEXT_ROOT })
    .where(eq(sequences.id, graph.sequenceId));
}
