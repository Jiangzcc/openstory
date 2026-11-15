import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { StyleConfig } from '@/look/style-config';
import type {
  StoryboardTriggerInput,
  StoryboardWorkflowInput,
} from '@/platform/server/workflow/types';
import type { triggerWorkflow } from '@/platform/server/workflow/client';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { generateId } from '@/platform/id';
import {
  organization,
  sequences,
  sequenceEvents,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from './db/sequences';
import { createSequenceEventsMethods } from './db/sequence-events';

const WORKFLOW_RUN = 'synthetic-created-storyboard';
const PRIOR_ERROR = 'Synthetic previous failure';
const MODES = ['fresh', 'continue'] as const;
const STATUS = { failed: 'failed', processing: 'processing' } as const;
const CONFIGURATION: ModelRuntimeConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  sceneSplit: 'z-ai/glm-5.3-flash',
};
const STYLE_CONFIG: StyleConfig = {
  version: 2,
  look: {
    mood: 'neutral',
    artStyle: 'cinematic',
    lighting: 'natural',
    colorPalette: ['#000', '#fff'],
    colorGrading: 'neutral',
  },
  motion: { camera: 'static' },
  references: [],
};

// Workflows is substituted; sequence claims and status use real test D1.
const trigger = vi.fn(
  async (
    _path: string,
    _payload: StoryboardWorkflowInput,
    _options?: Parameters<typeof triggerWorkflow>[2]
  ) => WORKFLOW_RUN
);
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: trigger,
}));
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: vi.fn(async () => 'failed'),
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn(() => undefined),
}));
const { triggerStoryboard, triggerContinue } = await import('./launchers');
const { withContinueSwitches } = await import('./continue-plan');

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedSequence>>;
beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  vi.restoreAllMocks();
  trigger.mockReset().mockResolvedValue(WORKFLOW_RUN);
  fixture = await seedSequence();
});

async function seedSequence() {
  const organizationId = generateId();
  const actorId = generateId();
  const previousRun = 'synthetic-previous-' + generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Launcher owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Launcher writer',
    email: actorId + '@example.invalid',
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Launcher test', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Missing test style');
  const methods = createSequencesMethods(db, organizationId, actorId);
  const sequence = await methods.create({
    title: 'Launcher test',
    styleId: style.id,
    generationStopAt: 'images',
  });
  await db
    .update(sequences)
    .set({
      script: 'INT. SYNTHETIC TEST — DAY',
      status: STATUS.failed,
      statusError: PRIOR_ERROR,
      workflowRunId: previousRun,
    })
    .where(eq(sequences.id, sequence.id));
  return { organizationId, actorId, sequence, methods, previousRun };
}

function makeScopedDb() {
  return asStub<ScopedDb>({
    sequences: fixture.methods,
    sequence: (id: string) => createSequenceMethods(db, id),
    sequenceEvents: createSequenceEventsMethods(db),
    sequenceElements: { list: async () => [] },
    characters: { list: async () => [] },
    locations: { list: async () => [], getCurrentByIds: async () => [] },
    organizationManagement: {
      getMemberEmail: async () => 'writer@example.invalid',
    },
  });
}

function input(): StoryboardTriggerInput {
  return {
    promptLocale: 'en',
    userId: fixture.actorId,
    organizationId: fixture.organizationId,
    sequenceId: fixture.sequence.id,
    options: {
      shotsPerScene: 3,
      generateThumbnails: true,
      generateDescriptions: true,
      aiProvider: 'openrouter',
      regenerateAll: true,
    },
  };
}

async function stored() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  if (!row) throw new Error('Missing test sequence');
  return row;
}

function launch(mode: (typeof MODES)[number]) {
  const scopedDb = makeScopedDb();
  if (mode === 'fresh')
    return triggerStoryboard(scopedDb, input(), CONFIGURATION);
  return triggerContinue(scopedDb, {
    ...input(),
    sequence: fixture.sequence,
    // The substituted workflow never executes this plan.
    plan: asStub<UpdateStalePlan>({}),
    stopAt: 'images',
    modelConfiguration: CONFIGURATION,
  });
}

it.each(MODES)(
  '%s uses its raw claim as the dispatch deduplication ID',
  async (mode) => {
    trigger.mockImplementationOnce(async (path, payload, options) => {
      const row = await stored();
      expect(row).toMatchObject({
        status: STATUS.processing,
        statusError: null,
      });
      expect(row.workflowRunId).not.toBe(fixture.previousRun);
      expect(path).toBe('/storyboard');
      expect(payload).toMatchObject({
        promptLocale: 'en',
        userId: fixture.actorId,
        organizationId: fixture.organizationId,
        sequenceId: fixture.sequence.id,
      });
      expect(payload.resume).toBe(mode === 'continue' ? true : undefined);
      expect(options).toEqual({
        deduplicationId: row.workflowRunId,
        modelConfiguration: CONFIGURATION,
      });
      return WORKFLOW_RUN;
    });
    await expect(launch(mode)).resolves.toEqual({
      workflowRunId: WORKFLOW_RUN,
    });
    expect(await stored()).toMatchObject({
      workflowRunId: WORKFLOW_RUN,
      status: STATUS.processing,
    });
    expect(trigger).toHaveBeenCalledOnce();
  }
);

it.each(MODES)(
  '%s marks trigger failure and rethrows the original error',
  async (mode) => {
    const failure = new Error('Synthetic trigger failure');
    trigger.mockRejectedValueOnce(failure);
    await expect(launch(mode)).rejects.toBe(failure);
    expect(await stored()).toMatchObject({
      status: STATUS.failed,
      statusError: failure.message,
    });
    const events = await db
      .select()
      .from(sequenceEvents)
      .where(eq(sequenceEvents.sequenceId, fixture.sequence.id));
    expect(events.map((event) => event.kind)).toContain('run.failed');
  }
);

it('preserves a winning owner when a stale request loses the raw claim CAS', async () => {
  const winner = 'synthetic-winning-' + generateId();
  const claim = fixture.methods.claimWorkflowSlot;
  vi.spyOn(fixture.methods, 'claimWorkflowSlot').mockImplementationOnce(
    async (args) => {
      await db
        .update(sequences)
        .set({ workflowRunId: winner })
        .where(eq(sequences.id, fixture.sequence.id));
      return claim(args);
    }
  );
  await expect(launch('fresh')).rejects.toMatchObject({
    name: 'GenerationInProgressError',
  });
  expect(await stored()).toMatchObject({
    workflowRunId: winner,
    status: STATUS.failed,
    statusError: PRIOR_ERROR,
  });
  expect(trigger).not.toHaveBeenCalled();
});

it('restores Continue settings after an ordinary trigger failure', async () => {
  const before = {
    generationStopAt: 'references',
    generateStartFrames: true,
    generateVoices: true,
    draftMotion: false,
  } as const;
  await fixture.methods.update({ id: fixture.sequence.id, ...before });
  const sequence = await fixture.methods.getForUser({
    sequenceId: fixture.sequence.id,
  });
  const settings = {
    generationStopAt: 'images',
    generateStartFrames: false,
    generateVoices: false,
    draftMotion: true,
  } as const;
  const original = new Error('Synthetic launch refusal');
  trigger.mockImplementationOnce(async () => {
    expect(await stored()).toMatchObject(settings);
    throw original;
  });
  await expect(
    withContinueSwitches(makeScopedDb(), sequence, settings, () =>
      launch('continue')
    )
  ).rejects.toBe(original);
  expect(await stored()).toMatchObject(before);
});
