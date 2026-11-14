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
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  organization,
  sequences,
  styles,
  shots,
  frames,
  framePromptVersions,
  frameVariants,
  sequenceEvents,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import type { ShotEditContext } from './shot-context';
import { createArtifactCancellationMethods } from './db/artifact-cancellations';

// Termination is observed without calling a workflow binding; all cancellation data uses migrated D1.
const terminate = vi.fn(async (_runId: string | null) => false);
vi.doMock('@/platform/server/workflow/run-outcome', () => ({
  terminateSingleArtifactRun: terminate,
}));
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');
const { cancelPendingArtifact } = await import('./shot-content-edit');
const [template] = DEFAULT_STYLE_TEMPLATES;
if (!template) throw new Error('Synthetic cancellation test requires a style');
const STYLE_CONFIG = template.config;
const STATUS = { pending: 'pending', cancelled: 'cancelled' } as const;
const SQL_FAULT = 'synthetic_artifact_cancellation_fault';
const SQL_FAILURE = 'Synthetic cancellation write failure';
let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  terminate.mockReset().mockResolvedValue(false);
  fixture = await seed();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT));
});

async function seedFrameGraph() {
  const organizationId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic organization',
    slug: organizationId,
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Synthetic style', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Expected a synthetic style');
  const [sequence] = await db
    .insert(sequences)
    .values({ organizationId, title: 'Synthetic sequence', styleId: style.id })
    .returning();
  if (!sequence) throw new Error('Expected a synthetic sequence');
  const [shot] = await db
    .insert(shots)
    .values({ sequenceId: sequence.id, shotNumber: 1 })
    .returning();
  if (!shot) throw new Error('Expected a synthetic shot');
  const [frame] = await db
    .insert(frames)
    .values({
      sequenceId: sequence.id,
      shotId: shot.id,
      role: 'first',
      orderIndex: 0,
    })
    .returning();
  if (!frame) throw new Error('Expected a synthetic frame');
  return { organizationId, sequence, shot, frame };
}

async function seed() {
  const { organizationId, sequence, shot, frame } = await seedFrameGraph();
  const scopedDb = createScopedDb(organizationId, generateId());
  const prompts = scopedDb.framePromptVersions;
  const images = scopedDb.frameVariants;
  const frameMethods = scopedDb.frames;
  const prompt = await prompts.createPending({
    frameId: frame.id,
    pendingInputHash: 'synthetic-prompt',
    workflowRunId: 'synthetic-prompt-run',
  });
  const image = await images.createPendingClaim({
    isPrimary: true,
    frameId: frame.id,
    sequenceId: sequence.id,
    model: 'nano_banana_2',
    dependsOnVersionId: prompt.id,
    actorId: null,
    workflowRunId: 'synthetic-image-run',
  });
  await frameMethods.setPendingPromoteVersionId(frame.id, image.id);
  const context: Pick<ShotEditContext, 'scopedDb' | 'frame' | 'shot'> = {
    scopedDb,
    frame,
    shot,
  };
  return { organizationId, sequence, frame, shot, prompt, image, context };
}
async function stored() {
  const [prompt] = await db
    .select()
    .from(framePromptVersions)
    .where(eq(framePromptVersions.id, fixture.prompt.id));
  const [image] = await db
    .select()
    .from(frameVariants)
    .where(eq(frameVariants.id, fixture.image.id));
  const [frame] = await db
    .select()
    .from(frames)
    .where(eq(frames.id, fixture.frame.id));
  return { prompt, image, frame };
}
function cancel(artifact: 'visual-prompt' | 'image') {
  return cancelPendingArtifact(fixture.context, {
    artifact,
    versionId: artifact === 'image' ? fixture.image.id : fixture.prompt.id,
  });
}
async function expectWriteFailure(artifact: 'visual-prompt' | 'image') {
  const thrown: unknown = await cancel(artifact).catch(
    (error: unknown) => error
  );
  const cause =
    thrown instanceof Error && thrown.cause instanceof Error
      ? thrown.cause
      : thrown;
  expect(cause).toBeInstanceOf(Error);
  expect(cause).toHaveProperty('message', SQL_FAILURE);
}

function failAt(table: 'frame_variants' | 'frames') {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT} BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${SQL_FAILURE}'); END`
    )
  );
}

describe('Atomic pending-artifact cancellation', () => {
  it('refuses a late image claim from an already-cancelled visual dependency', async () => {
    await cancel('visual-prompt');
    const late =
      await fixture.context.scopedDb.frameVariants.createPendingClaim({
        isPrimary: true,
        frameId: fixture.frame.id,
        sequenceId: fixture.sequence.id,
        model: 'nano_banana_2',
        dependsOnVersionId: fixture.prompt.id,
        actorId: null,
      });
    expect(late.status).toBe(STATUS.cancelled);
    expect(
      await db
        .select()
        .from(sequenceEvents)
        .where(eq(sequenceEvents.id, late.id))
    ).toEqual([]);
    expect(
      await fixture.context.scopedDb.frameVariants.claimForGeneration(late.id, {
        workflowRunId: 'synthetic-late-run',
        model: 'nano_banana_2',
        pendingInputHash: 'synthetic-late-hash',
      })
    ).toBeNull();
  });

  it('rolls back prompt cancellation when dependent image cancellation fails, allowing a complete retry', async () => {
    await failAt('frame_variants');
    await expectWriteFailure('visual-prompt');
    const state = await stored();
    expect(state.prompt?.status).toBe(STATUS.pending);
    expect(state.image?.status).toBe(STATUS.pending);
    expect(state.frame?.pendingPromoteVersionId).toBe(fixture.image.id);
    expect(terminate).not.toHaveBeenCalled();
    await db.run(sql.raw('DROP TRIGGER ' + SQL_FAULT));
    expect(await cancel('visual-prompt')).toEqual({ cancelled: true });
    const after = await stored();
    expect(after.prompt?.status).toBe(STATUS.cancelled);
    expect(after.image?.status).toBe(STATUS.cancelled);
    expect(after.frame?.pendingPromoteVersionId).toBeNull();
  });

  it('rolls back the whole dependent chain when exact promote-claim clearing fails', async () => {
    await failAt('frames');
    await expectWriteFailure('visual-prompt');
    const state = await stored();
    expect(state.prompt?.status).toBe(STATUS.pending);
    expect(state.image?.status).toBe(STATUS.pending);
    expect(state.frame?.pendingPromoteVersionId).toBe(fixture.image.id);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('rolls back a direct image cancellation when exact promote-claim clearing fails', async () => {
    await failAt('frames');
    await expectWriteFailure('image');
    const state = await stored();
    expect(state.image?.status).toBe(STATUS.pending);
    expect(state.frame?.pendingPromoteVersionId).toBe(fixture.image.id);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('settles the full chain before trying any best-effort termination and is idempotent', async () => {
    terminate.mockImplementation(async () => {
      const state = await stored();
      expect(state.prompt?.status).toBe(STATUS.cancelled);
      expect(state.image?.status).toBe(STATUS.cancelled);
      expect(state.frame?.pendingPromoteVersionId).toBeNull();
      return false;
    });
    expect(await cancel('visual-prompt')).toEqual({ cancelled: true });
    expect(terminate.mock.calls.map(([id]) => id)).toEqual([
      'synthetic-image-run',
      'synthetic-prompt-run',
    ]);
    expect(await cancel('visual-prompt')).toEqual({ cancelled: false });
    expect(terminate).toHaveBeenCalledTimes(2);
  });

  it('preserves a newer image promote claim while retiring only the cancelled dependency', async () => {
    const newer =
      await fixture.context.scopedDb.frameVariants.createPendingClaim({
        isPrimary: true,
        frameId: fixture.frame.id,
        sequenceId: fixture.sequence.id,
        model: 'nano_banana_2',
        pendingInputHash: 'synthetic-newer-hash',
        actorId: null,
        workflowRunId: 'synthetic-newer-run',
      });
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      fixture.frame.id,
      newer.id
    );
    expect(await cancel('visual-prompt')).toEqual({ cancelled: true });
    expect((await stored()).frame?.pendingPromoteVersionId).toBe(newer.id);
    expect(
      (
        await db
          .select()
          .from(frameVariants)
          .where(eq(frameVariants.id, newer.id))
      )[0]?.status
    ).toBe(STATUS.pending);
    expect(terminate).not.toHaveBeenCalledWith('synthetic-newer-run');
  });

  it('retains a prompt completion that won before the cancellation write', async () => {
    const methods = fixture.context.scopedDb.framePromptVersions;
    const read = methods.getByIdForFrame.bind(methods);
    vi.spyOn(methods, 'getByIdForFrame').mockImplementationOnce(
      async (...args) => {
        const snapshot = await read(...args);
        await db
          .update(framePromptVersions)
          .set({ status: 'completed' })
          .where(eq(framePromptVersions.id, fixture.prompt.id));
        return snapshot;
      }
    );
    expect(await cancel('visual-prompt')).toEqual({ cancelled: false });
    expect((await stored()).prompt?.status).toBe('completed');
    expect((await stored()).image?.status).toBe(STATUS.pending);
    expect((await stored()).frame?.pendingPromoteVersionId).toBe(
      fixture.image.id
    );
    expect(terminate).not.toHaveBeenCalled();
  });

  it('does not let a racing image completion resurrect a cancelled claim', async () => {
    expect(await cancel('image')).toEqual({ cancelled: true });
    expect(
      await fixture.context.scopedDb.frameVariants.completeIfLive(
        fixture.image.id,
        {
          url: 'https://example.invalid/synthetic-late-image.png',
          storagePath: 'synthetic-late-image.png',
          inputHash: 'synthetic-hash',
        }
      )
    ).toBeNull();
    expect((await stored()).image?.status).toBe(STATUS.cancelled);
    expect((await stored()).frame?.pendingPromoteVersionId).toBeNull();
    expect((await stored()).prompt?.status).toBe(STATUS.pending);
  });

  it('preserves an image completion that won before cancellation', async () => {
    await fixture.context.scopedDb.frameVariants.completeIfLive(
      fixture.image.id,
      {
        url: 'https://example.invalid/synthetic-complete.png',
        storagePath: 'synthetic-complete.png',
        inputHash: 'synthetic-complete-hash',
      }
    );
    const before = await stored();
    expect(await cancel('image')).toEqual({ cancelled: false });
    expect(await stored()).toEqual(before);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('keeps committed cancellation correct when the batch reply is lost', async () => {
    const batch = db.batch.bind(db);
    const lost = new Error('Synthetic committed batch reply lost');
    vi.spyOn(db, 'batch').mockImplementationOnce(async (queries) => {
      await batch(queries);
      throw lost;
    });
    await expect(cancel('visual-prompt')).rejects.toBe(lost);
    const state = await stored();
    expect(state.prompt?.status).toBe(STATUS.cancelled);
    expect(state.image?.status).toBe(STATUS.cancelled);
    expect(state.frame?.pendingPromoteVersionId).toBeNull();
    expect(terminate).not.toHaveBeenCalled();
    expect(await cancel('visual-prompt')).toEqual({ cancelled: false });
  });

  it('repairs legacy prompt-only cancellation without reporting a second source transition', async () => {
    await fixture.context.scopedDb.framePromptVersions.markTerminal(
      fixture.prompt.id,
      STATUS.cancelled
    );
    expect(await cancel('visual-prompt')).toEqual({ cancelled: false });
    expect((await stored()).image?.status).toBe(STATUS.cancelled);
    expect((await stored()).frame?.pendingPromoteVersionId).toBeNull();
    expect(terminate).toHaveBeenCalledExactlyOnceWith('synthetic-image-run');
  });

  it('repairs a legacy cancelled image that still holds its promote claim', async () => {
    await fixture.context.scopedDb.frameVariants.markTerminal(
      fixture.image.id,
      STATUS.cancelled
    );
    expect(await cancel('image')).toEqual({ cancelled: false });
    expect((await stored()).frame?.pendingPromoteVersionId).toBeNull();
    expect((await stored()).prompt?.status).toBe(STATUS.pending);
  });

  it.each(['cancelVisualPrompt', 'cancelImage'] as const)(
    'refuses another organization in %s',
    async (method) => {
      const foreign = createArtifactCancellationMethods(db, generateId());
      const before = await stored();
      const versionId =
        method === 'cancelImage' ? fixture.image.id : fixture.prompt.id;
      expect(
        await foreign[method]({ versionId, frameId: fixture.frame.id })
      ).toEqual({ cancelled: false, workflowRunIds: [] });
      expect(await stored()).toEqual(before);
    }
  );

  it.each(['cancelVisualPrompt', 'cancelImage'] as const)(
    'refuses the wrong frame in %s',
    async (method) => {
      const before = await stored();
      const versionId =
        method === 'cancelImage' ? fixture.image.id : fixture.prompt.id;
      expect(
        await fixture.context.scopedDb.artifactCancellations[method]({
          versionId,
          frameId: generateId(),
        })
      ).toEqual({ cancelled: false, workflowRunIds: [] });
      expect(await stored()).toEqual(before);
    }
  );

  it('cancels eligible dependents on their exact frames', async () => {
    const [otherFrame] = await db
      .insert(frames)
      .values({
        sequenceId: fixture.sequence.id,
        shotId: fixture.shot.id,
        role: 'last',
        orderIndex: 1,
      })
      .returning();
    if (!otherFrame) throw new Error('Expected another synthetic frame');
    const otherImage =
      await fixture.context.scopedDb.frameVariants.createPendingClaim({
        isPrimary: true,
        frameId: otherFrame.id,
        sequenceId: fixture.sequence.id,
        model: 'nano_banana_2',
        dependsOnVersionId: fixture.prompt.id,
        actorId: null,
        workflowRunId: 'synthetic-other-image-run',
      });
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      otherFrame.id,
      otherImage.id
    );
    expect(await cancel('visual-prompt')).toEqual({ cancelled: true });
    expect(
      (
        await db
          .select()
          .from(frameVariants)
          .where(eq(frameVariants.id, otherImage.id))
      )[0]?.status
    ).toBe(STATUS.cancelled);
    expect(
      (await db.select().from(frames).where(eq(frames.id, otherFrame.id)))[0]
        ?.pendingPromoteVersionId
    ).toBeNull();
  });

  it('does not clear an unrelated frame that points at another frame’s cancelled version', async () => {
    const [other] = await db
      .insert(frames)
      .values({
        sequenceId: fixture.sequence.id,
        shotId: fixture.shot.id,
        role: 'last',
        orderIndex: 1,
      })
      .returning();
    if (!other) throw new Error('Expected another synthetic frame');
    // Deliberately inconsistent soft pointer: cancellation must still match the version's owning frame.
    await db
      .update(frames)
      .set({ pendingPromoteVersionId: fixture.image.id })
      .where(eq(frames.id, other.id));
    await cancel('visual-prompt');
    expect((await stored()).frame?.pendingPromoteVersionId).toBeNull();
    expect(
      (await db.select().from(frames).where(eq(frames.id, other.id)))[0]
        ?.pendingPromoteVersionId
    ).toBe(fixture.image.id);
  });

  it('does not cancel a foreign organization’s dependent claim', async () => {
    const foreign = await seedFrameGraph();
    const image =
      await fixture.context.scopedDb.frameVariants.createPendingClaim({
        isPrimary: true,
        frameId: foreign.frame.id,
        sequenceId: foreign.sequence.id,
        model: 'nano_banana_2',
        dependsOnVersionId: fixture.prompt.id,
        actorId: null,
        workflowRunId: 'synthetic-foreign-run',
      });
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      foreign.frame.id,
      image.id
    );
    await cancel('visual-prompt');
    expect(
      (
        await db
          .select()
          .from(frameVariants)
          .where(eq(frameVariants.id, image.id))
      )[0]?.status
    ).toBe(STATUS.pending);
    expect(
      (await db.select().from(frames).where(eq(frames.id, foreign.frame.id)))[0]
        ?.pendingPromoteVersionId
    ).toBe(image.id);
    expect(terminate).not.toHaveBeenCalledWith('synthetic-foreign-run');
  });

  it('keeps a newer active image visible when an older cancelled dependency admits a late claim', async () => {
    await cancel('visual-prompt');
    const images = fixture.context.scopedDb.frameVariants;
    const newer = await images.createPendingClaim({
      isPrimary: true,
      frameId: fixture.frame.id,
      sequenceId: fixture.sequence.id,
      model: 'nano_banana_2',
      pendingInputHash: 'synthetic-current-run-hash',
      actorId: null,
      workflowRunId: 'synthetic-current-run',
    });
    await images.claimForGeneration(newer.id, {
      workflowRunId: 'synthetic-current-run',
      model: 'nano_banana_2',
      pendingInputHash: 'synthetic-current-run-hash',
    });
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      fixture.frame.id,
      newer.id
    );
    const late = await images.createPendingClaim({
      isPrimary: true,
      frameId: fixture.frame.id,
      sequenceId: fixture.sequence.id,
      model: 'nano_banana_2',
      dependsOnVersionId: fixture.prompt.id,
      actorId: null,
      workflowRunId: 'synthetic-old-run',
    });
    expect(
      (await images.getPrimaryByFrameIds([fixture.frame.id])).get(
        fixture.frame.id
      )?.id
    ).toBe(newer.id);
    expect(late.status).toBe(STATUS.cancelled);
    expect(late.isPrimary).toBe(false);
    expect((await stored()).frame?.pendingPromoteVersionId).toBe(newer.id);
  });

  it('blocks a delayed claim setter from resurrecting a cancelled image promote pointer', async () => {
    await cancel('image');
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      fixture.frame.id,
      fixture.image.id
    );
    expect((await stored()).frame?.pendingPromoteVersionId).toBeNull();
  });

  it('blocks a delayed cancelled claim setter from replacing a newer promote owner', async () => {
    await cancel('image');
    const newer =
      await fixture.context.scopedDb.frameVariants.createPendingClaim({
        isPrimary: true,
        frameId: fixture.frame.id,
        sequenceId: fixture.sequence.id,
        model: 'nano_banana_2',
        pendingInputHash: 'synthetic-new-setter',
        actorId: null,
      });
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      fixture.frame.id,
      newer.id
    );
    await fixture.context.scopedDb.frames.setPendingPromoteVersionId(
      fixture.frame.id,
      fixture.image.id
    );
    expect((await stored()).frame?.pendingPromoteVersionId).toBe(newer.id);
  });

  it('blocks a delayed claim handover into a cancelled replacement image', async () => {
    const replacement =
      await fixture.context.scopedDb.frameVariants.createPendingClaim({
        isPrimary: true,
        frameId: fixture.frame.id,
        sequenceId: fixture.sequence.id,
        model: 'nano_banana_2',
        pendingInputHash: 'synthetic-replacement',
        actorId: null,
      });
    await cancelPendingArtifact(fixture.context, {
      artifact: 'image',
      versionId: replacement.id,
    });
    expect(
      await fixture.context.scopedDb.frames.movePendingPromoteVersionIdIf(
        fixture.frame.id,
        fixture.image.id,
        replacement.id
      )
    ).toBe(false);
    expect((await stored()).frame?.pendingPromoteVersionId).toBe(
      fixture.image.id
    );
  });

  it('does not let another organization’s cancelled prompt control a late image claim', async () => {
    await cancel('visual-prompt');
    const foreign = await seedFrameGraph();
    const foreignDb = createScopedDb(foreign.organizationId, generateId());
    const image = await foreignDb.frameVariants.createPendingClaim({
      isPrimary: true,
      frameId: foreign.frame.id,
      sequenceId: foreign.sequence.id,
      model: 'nano_banana_2',
      dependsOnVersionId: fixture.prompt.id,
      actorId: null,
    });
    expect(image.status).toBe(STATUS.pending);
    expect(image.isPrimary).toBe(true);
    expect(image.error).toBeNull();
    expect(
      await db
        .select()
        .from(sequenceEvents)
        .where(eq(sequenceEvents.id, image.id))
    ).toHaveLength(1);
    expect((await stored()).prompt?.status).toBe(STATUS.cancelled);
  });
});
