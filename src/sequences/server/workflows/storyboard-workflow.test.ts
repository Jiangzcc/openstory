// Storyboard failure ownership, cleanup propagation, and generation orchestration.

import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/models/models';
import { DEFAULT_ANALYSIS_MODEL } from '@/models/models.config';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import { WorkflowLoggedError } from '@/platform/server/workflow/errors';
import { asStub } from '@/test/as-stub';
import { makeStoryboardRunImplDb as makeRunImplDb } from './storyboard-workflow.test.fixture';
import {
  createStoryboardLifecycleStub,
  makeStep,
  storyboardFailureInput,
} from './storyboard-workflow.test.fixture';

vi.doMock('@/platform/server/db/scoped', () => ({
  createScopedDb: vi.fn(),
}));
vi.doMock('@/models/server/fal-config', () => ({
  configureFalProxyFromEnv: vi.fn(),
}));
vi.doMock('@/stills/server/image-generation', () => ({
  generateImageWithProvider: vi.fn(),
}));

const storyboardOwner = (workflowClaimId?: string) => ({
  workflowRunId: 'storyboard_run_A',
  workflowClaimId,
});

const emit = vi.fn();
const getGenerationChannel = vi.fn(() => ({ emit }));
vi.doMock('@/platform/realtime', () => ({ getGenerationChannel }));

const spawnAndAwaitChild = vi.fn(async () => undefined);
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));

const notifySequenceReady = vi.fn(async () => 'sent');
vi.doMock('@/sequences/server/notify-sequence-ready', () => ({
  notifySequenceReady,
  sequenceScenesUrl: (id: string) =>
    `https://openstory.so/sequences/${id}/scenes`,
}));

const freezeFreshGenerationPlan = vi.fn(async () => ({
  plan: { targets: [], references: null, music: null },
  remainingCost: 0,
}));
vi.doMock('@/sequences/server/freeze-fresh-generation-plan', () => ({
  freezeFreshGenerationPlan,
}));
const gateStoryboardRenders = vi.fn(
  async (): Promise<{
    spawnRenders: boolean;
    neededMicros: number;
    remainingMicros: number;
  }> => ({ spawnRenders: true, neededMicros: 0, remainingMicros: 0 })
);
vi.doMock('@/billing/server/storyboard-render-gate', () => ({
  gateStoryboardRenders,
}));

// Dynamic import so the mocks above apply (vi.doMock is not hoisted).
const { StoryboardWorkflow } = await import('./storyboard-workflow');

/** Widens the protected hook so tests can invoke it directly. */
class TestableStoryboardWorkflow extends StoryboardWorkflow {
  invokeOnFailure(failure: {
    event: Readonly<WorkflowEvent<StoryboardWorkflowInput>>;
    error: string;
    scopedDb: WorkflowScopedDb;
  }): Promise<void> {
    return this.onFailure(failure);
  }

  invokeRunImpl(
    event: Readonly<WorkflowEvent<StoryboardWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ): Promise<void> {
    return this.runImpl(event, step, scopedDb);
  }
}

function makeWorkflow(): TestableStoryboardWorkflow {
  type Ctor = ConstructorParameters<typeof TestableStoryboardWorkflow>;
  // tests construct the entrypoint directly; onFailure never reads ctx
  const ctx = asStub<Ctor[0]>(undefined);
  // minimal env stub; onFailure never reads bindings
  const env = asStub<Ctor[1]>({});
  return new TestableStoryboardWorkflow(ctx, env);
}

function makeEvent(
  sequenceId: string | undefined,
  extras: Partial<
    Pick<
      StoryboardWorkflowInput,
      | 'notify'
      | 'stopAt'
      | 'resume'
      | 'userCountry'
      | 'plan'
      | 'reservationId'
      | 'workflowClaimId'
    >
  > = {}
): Readonly<WorkflowEvent<StoryboardWorkflowInput>> {
  const payload: StoryboardWorkflowInput = {
    promptLocale: 'en' as const,
    userId: 'u1',
    organizationId: 't1',
    includeMusic: true,
    sequenceId,
    title: 'The Long Walk',
    script: 'INT. HALLWAY — NIGHT',
    aspectRatio: '16:9',
    stopAt: 'music',
    musicPromptSource: 'ai-generated',
    styleConfig: migrateStyleConfigV1ToV2({
      mood: 'tense and hopeful',
      artStyle: 'photoreal cinematic',
      lighting: 'hard key, deep shadows',
      colorPalette: ['#101020', '#e0d0b0'],
      cameraWork: 'handheld, tight lenses',
      referenceFilms: ['Children of Men'],
      colorGrading: 'cool shadows, warm highlights',
    }),
    analysisModelId: DEFAULT_ANALYSIS_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    elementIds: [],
    cast: [],
    referenceOnly: false,
    ownerEmail: 'owner@example.com',
    sequenceUrl: 'https://openstory.so/sequences/seq_1/scenes',
    ...extras,
    options: {
      shotsPerScene: 3,
      generateThumbnails: true,
      generateDescriptions: true,
      aiProvider: 'openrouter',
      regenerateAll: true,
    },
  };
  // Minimal WorkflowEvent mock: failure ownership uses payload and instanceId.
  return {
    payload,
    instanceId: 'storyboard_run_A',
    workflowName: 'storyboard',
    timestamp: new Date(0),
  };
}

function makeScopedDb(updated = true) {
  const zeroReservation = vi.fn(async () => undefined);
  const methods = createStoryboardLifecycleStub();
  if (!updated) methods.failWorkflowIfCurrent.mockResolvedValue(false);
  const updateStatus = vi.fn();
  const getForUser = vi.fn(async () => ({ id: 'seq_1', status: 'processing' }));
  const stub = {
    models: DEFAULT_MODEL_CONFIGURATION,
    billing: { zeroReservation },
    sequences: methods,
    liveRead: { sequences: { getForUser } },
    sequence: vi.fn(() => ({ updateStatus })),
  };
  // Mock failure writes and retain legacy accessors to catch accidental use.
  const scopedDb = asStub<WorkflowScopedDb>(stub);
  return {
    scopedDb,
    ...methods,
    updateStatus,
    getForUser,
    zeroReservation,
  };
}

describe('StoryboardWorkflow.onFailure', () => {
  test.each([undefined, 'storyboard_claim_A'])(
    'marks the current sequence failed with workflow claim %s',
    async (workflowClaimId) => {
      emit.mockReset();
      getGenerationChannel.mockClear();
      const { scopedDb, failWorkflowIfCurrent } = makeScopedDb();
      const event = makeEvent(
        'seq_1',
        workflowClaimId === undefined ? {} : { workflowClaimId }
      );

      await makeWorkflow().invokeOnFailure({
        event,
        error: 'Child workflow analyze-script timed out',
        scopedDb,
      });

      expect(failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
        storyboardFailureInput(
          { id: 'seq_1', ...storyboardOwner(workflowClaimId) },
          'Child workflow analyze-script timed out'
        )
      );
      expect(getGenerationChannel).toHaveBeenCalledExactlyOnceWith('seq_1');
      expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
        workflowOwner: storyboardOwner(workflowClaimId),
        message: 'Child workflow analyze-script timed out',
      });
    }
  );

  test.each([false, true])(
    'preserves the guard error without sending an unpersisted failure (transport fails: %s)',
    async (notificationFails) => {
      emit.mockReset();
      const { scopedDb, failWorkflowIfCurrent } = makeScopedDb();
      const persistenceError = new Error('database down');
      failWorkflowIfCurrent.mockRejectedValueOnce(persistenceError);
      if (notificationFails)
        emit.mockRejectedValueOnce(new Error('channel unavailable'));

      await expect(
        makeWorkflow().invokeOnFailure({
          event: makeEvent('seq_1'),
          error: 'Child workflow analyze-script timed out',
          scopedDb,
        })
      ).rejects.toBe(persistenceError);

      expect(failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
        storyboardFailureInput(
          { id: 'seq_1', ...storyboardOwner() },
          'Child workflow analyze-script timed out'
        )
      );
      expect(emit).not.toHaveBeenCalled();
    }
  );

  test.each([undefined, 'storyboard_claim_A'])(
    'guard miss preserves terminal or newer runs with workflow claim %s',
    async (workflowClaimId) => {
      emit.mockReset();
      getGenerationChannel.mockClear();
      const { scopedDb, failWorkflowIfCurrent, updateStatus, zeroReservation } =
        makeScopedDb(false);

      await makeWorkflow().invokeOnFailure({
        event: makeEvent('seq_1', {
          reservationId: 'reservation-1',
          ...(workflowClaimId === undefined ? {} : { workflowClaimId }),
        }),
        error: 'Child workflow analyze-script… failed',
        scopedDb,
      });

      expect(zeroReservation).toHaveBeenCalledExactlyOnceWith('reservation-1');
      expect(failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
        storyboardFailureInput(
          { id: 'seq_1', ...storyboardOwner(workflowClaimId) },
          'Child workflow analyze-script… failed'
        )
      );
      expect(updateStatus).not.toHaveBeenCalled();
      expect(getGenerationChannel).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    }
  );

  test('missing sequenceId → no DB access', async () => {
    emit.mockReset();
    const {
      scopedDb,
      failWorkflowIfCurrent,
      updateStatus,
      getForUser,
      zeroReservation,
    } = makeScopedDb();

    await makeWorkflow().invokeOnFailure({
      event: makeEvent(undefined),
      error: 'boom',
      scopedDb,
    });

    expect(failWorkflowIfCurrent).not.toHaveBeenCalled();
    expect(getForUser).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(zeroReservation).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    'does not read mutable status when the guard returns %s',
    async (updated) => {
      emit.mockReset();
      const { scopedDb, failWorkflowIfCurrent, updateStatus, getForUser } =
        makeScopedDb(updated);
      getForUser.mockRejectedValueOnce(new Error('status read unavailable'));

      await expect(
        makeWorkflow().invokeOnFailure({
          event: makeEvent('seq_1'),
          error: 'trailing step failed',
          scopedDb,
        })
      ).resolves.toBeUndefined();

      expect(failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
        storyboardFailureInput(
          { id: 'seq_1', ...storyboardOwner() },
          'trailing step failed'
        )
      );
      expect(getForUser).not.toHaveBeenCalled();
      expect(updateStatus).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledTimes(updated ? 1 : 0);
    }
  );

  test('keeps reservation release best effort for ordinary errors', async () => {
    emit.mockReset();
    const { scopedDb, failWorkflowIfCurrent, zeroReservation } = makeScopedDb();
    zeroReservation.mockRejectedValueOnce(new Error('reservation unavailable'));

    await expect(
      makeWorkflow().invokeOnFailure({
        event: makeEvent('seq_1', { reservationId: 'reservation-1' }),
        error: 'boom',
        scopedDb,
      })
    ).resolves.toBeUndefined();

    expect(zeroReservation).toHaveBeenCalledExactlyOnceWith('reservation-1');
    expect(failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
      storyboardFailureInput({ id: 'seq_1', ...storyboardOwner() }, 'boom')
    );
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      workflowOwner: storyboardOwner(),
      message: 'boom',
    });
  });

  test.each(['zeroReservation', 'failWorkflowIfCurrent'] as const)(
    'stops later actions when %s aborts',
    async (phase) => {
      emit.mockReset();
      getGenerationChannel.mockClear();
      const db = makeScopedDb();
      const abort = new Error(
        'Durable Object reset because its code was updated'
      );
      db[phase].mockRejectedValueOnce(abort);

      await expect(
        makeWorkflow().invokeOnFailure({
          event: makeEvent('seq_1', { reservationId: 'reservation-1' }),
          error: 'boom',
          scopedDb: db.scopedDb,
        })
      ).rejects.toBe(abort);

      expect(db.zeroReservation).toHaveBeenCalledExactlyOnceWith(
        'reservation-1'
      );
      if (phase === 'zeroReservation')
        expect(db.failWorkflowIfCurrent).not.toHaveBeenCalled();
      else
        expect(db.failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
          storyboardFailureInput({ id: 'seq_1', ...storyboardOwner() }, 'boom')
        );
      expect(db.getForUser).not.toHaveBeenCalled();
      expect(db.updateStatus).not.toHaveBeenCalled();
      expect(getGenerationChannel).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    }
  );

  test.each([
    'channel unavailable',
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('propagates notification error: %s', async (message) => {
    emit.mockReset();
    const { scopedDb, failWorkflowIfCurrent } = makeScopedDb();
    const notificationError = new Error(message);
    emit.mockRejectedValueOnce(notificationError);

    await expect(
      makeWorkflow().invokeOnFailure({
        event: makeEvent('seq_1'),
        error: 'boom',
        scopedDb,
      })
    ).rejects.toBe(notificationError);
    expect(failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
      storyboardFailureInput({ id: 'seq_1', ...storyboardOwner() }, 'boom')
    );
  });
});

function expectCurrentCompletion(
  complete: ReturnType<typeof makeRunImplDb>['completeWorkflowIfCurrent']
) {
  expect(complete).toHaveBeenCalledWith({
    id: 'seq_1',
    ...storyboardOwner(),
    eventId: expect.any(String),
  });
}

describe('StoryboardWorkflow email-ready', () => {
  test('restores a legacy native poster checkpoint without generating or charging again', async () => {
    const { generateImageWithProvider } =
      await import('@/stills/server/image-generation');
    vi.mocked(generateImageWithProvider).mockClear();
    spawnAndAwaitChild.mockReset().mockResolvedValue(undefined);
    const poster = {
      url: '/r2/thumbnails/mock-legacy-poster.png',
      metadata: { endpointId: 'mock-native', usedOwnKey: false },
    };
    const { scopedDb, setPosterIfCurrent } = makeRunImplDb();
    const { step, names } = makeStep(
      new Map<string, unknown>([
        ['generate-poster', poster],
        ['record-fal-usage-poster', undefined],
        ['deduct-poster-credits', undefined],
      ])
    );

    await makeWorkflow().invokeRunImpl(makeEvent('seq_1'), step, scopedDb);

    expect(setPosterIfCurrent).toHaveBeenCalledWith({
      id: 'seq_1',
      ...storyboardOwner(),
      posterUrl: poster.url,
    });
    expect(generateImageWithProvider).not.toHaveBeenCalled();
    expect(names).toContain('generate-poster');
    expect(names).not.toContain('generate-poster:record');
  });

  test('uses the snapshotted poster model and inherits configuration in analysis', async () => {
    const { generateImageWithProvider } =
      await import('@/stills/server/image-generation');
    vi.mocked(generateImageWithProvider).mockClear();
    spawnAndAwaitChild.mockReset();
    spawnAndAwaitChild.mockResolvedValue(undefined);
    const { scopedDb } = makeRunImplDb();
    scopedDb.models = {
      ...DEFAULT_MODEL_CONFIGURATION,
      poster: 'nano_banana_2_lite',
    };
    await makeWorkflow().invokeRunImpl(
      makeEvent('seq_1'),
      makeStep().step,
      scopedDb
    );
    expect(generateImageWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({ model: scopedDb.models.poster }),
      expect.any(Object)
    );
    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ modelConfiguration: scopedDb.models })
    );
  });

  test('runs the email-ready step after emit-complete', async () => {
    notifySequenceReady.mockReset();
    notifySequenceReady.mockResolvedValue('sent');
    spawnAndAwaitChild.mockReset();
    spawnAndAwaitChild.mockResolvedValue(undefined);
    emit.mockReset();

    const { scopedDb, completeWorkflowIfCurrent } = makeRunImplDb();
    const { step, names } = makeStep();
    await makeWorkflow().invokeRunImpl(makeEvent('seq_1'), step, scopedDb);

    expect(names).toEqual(
      expect.arrayContaining(['mark-completed', 'emit-complete', 'email-ready'])
    );
    expect(names.indexOf('emit-complete')).toBeGreaterThan(
      names.indexOf('mark-completed')
    );
    expect(names.indexOf('email-ready')).toBeGreaterThan(
      names.indexOf('emit-complete')
    );
    expectCurrentCompletion(completeWorkflowIfCurrent);
    expect(notifySequenceReady).toHaveBeenCalledTimes(1);
    expect(notifySequenceReady).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceId: 'seq_1',
        ownerEmail: 'owner@example.com',
        userId: 'u1',
      })
    );
  });

  test('notify: false still runs the step; helper skips the send', async () => {
    notifySequenceReady.mockReset();
    notifySequenceReady.mockResolvedValue('skipped');
    spawnAndAwaitChild.mockReset();
    spawnAndAwaitChild.mockResolvedValue(undefined);

    const { scopedDb } = makeRunImplDb();
    const { step, names } = makeStep();

    await makeWorkflow().invokeRunImpl(
      makeEvent('seq_1', { notify: false }),
      step,
      scopedDb
    );

    expect(names).toContain('email-ready');
    expect(notifySequenceReady).toHaveBeenCalledWith(
      expect.objectContaining({ notify: false })
    );
  });

  test('a ready-email failure leaves the storyboard completed', async () => {
    notifySequenceReady.mockReset();
    notifySequenceReady.mockRejectedValue(new Error('smtp down'));
    spawnAndAwaitChild.mockReset();
    spawnAndAwaitChild.mockResolvedValue(undefined);
    const { scopedDb, completeWorkflowIfCurrent, failWorkflowIfCurrent } =
      makeRunImplDb();

    await expect(
      makeWorkflow().invokeRunImpl(
        makeEvent('seq_1'),
        makeStep().step,
        scopedDb
      )
    ).resolves.toBeUndefined();

    expectCurrentCompletion(completeWorkflowIfCurrent);
    expect(failWorkflowIfCurrent).not.toHaveBeenCalled();
  });

  test('an engine abort during the ready email still aborts', async () => {
    notifySequenceReady.mockReset();
    notifySequenceReady.mockRejectedValue(
      new Error('Aborting engine: Grace period complete')
    );
    spawnAndAwaitChild.mockReset();
    spawnAndAwaitChild.mockResolvedValue(undefined);
    const { scopedDb } = makeRunImplDb();

    await expect(
      makeWorkflow().invokeRunImpl(
        makeEvent('seq_1'),
        makeStep().step,
        scopedDb
      )
    ).rejects.toThrow('Aborting engine: Grace period complete');
  });
});

describe('StoryboardWorkflow stop-at + resume (#1408)', () => {
  const run = async (
    extras: Parameters<typeof makeEvent>[1],
    childResult: unknown = { failures: [] }
  ) => {
    notifySequenceReady.mockReset();
    notifySequenceReady.mockResolvedValue('sent');
    spawnAndAwaitChild.mockReset();
    // the mock's inferred return is undefined
    spawnAndAwaitChild.mockResolvedValue(asStub<undefined>(childResult));
    const db = makeRunImplDb();
    const { step, names } = makeStep();
    await makeWorkflow().invokeRunImpl(
      makeEvent('seq_1', extras),
      step,
      db.scopedDb
    );
    return { ...db, names };
  };

  test('a fresh run wipes shots', async () => {
    const { startWorkflowIfCurrent, deleteBySequence, names } = await run({
      stopAt: 'music',
    });

    expect(startWorkflowIfCurrent).toHaveBeenCalledWith({
      id: 'seq_1',
      ...storyboardOwner(),
      stopAt: 'music',
      resume: false,
    });
    expect(deleteBySequence).not.toHaveBeenCalled();
    expect(names).toContain('generate-poster');
  });

  test('passes captured country and root ownership to script analysis', async () => {
    await run({
      stopAt: 'script',
      userCountry: 'AU',
      workflowClaimId: 'storyboard_claim_A',
    });

    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spawnStepName: 'spawn-analyze-script',
        childPayload: expect.objectContaining({
          userCountry: 'AU',
          storyboardOwner: storyboardOwner('storyboard_claim_A'),
        }),
      })
    );
  });

  test('a resume keeps shots and poster', async () => {
    const { startWorkflowIfCurrent, deleteBySequence, names } = await run({
      stopAt: 'images',
      resume: true,
    });

    expect(deleteBySequence).not.toHaveBeenCalled();
    expect(startWorkflowIfCurrent).toHaveBeenCalledWith({
      id: 'seq_1',
      ...storyboardOwner(),
      stopAt: 'images',
      resume: true,
    });
    expect(names).not.toContain('generate-poster');
  });

  test('fresh analysis hands its frozen plan to the same executor as a continue', async () => {
    const freshPlan = {
      targets: [{ shotId: 'new-shot' }],
      references: null,
      music: null,
    };
    freezeFreshGenerationPlan.mockResolvedValueOnce({
      plan: asStub<never>(freshPlan),
      remainingCost: 0,
    });
    await run({ stopAt: 'motion', workflowClaimId: 'storyboard_claim_A' });
    expect(spawnAndAwaitChild).toHaveBeenCalledTimes(2);
    expect(spawnAndAwaitChild).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        spawnStepName: 'spawn-continue',
        childPayload: expect.objectContaining({
          plan: freshPlan,
          announcePhases: true,
          freshRun: true,
          storyboardOwner: storyboardOwner('storyboard_claim_A'),
        }),
      })
    );
    await run({
      stopAt: 'motion',
      resume: true,
      workflowClaimId: 'storyboard_claim_A',
      plan: asStub<never>(freshPlan),
    });
    expect(spawnAndAwaitChild).toHaveBeenCalledTimes(1);
    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spawnStepName: 'spawn-continue',
        childPayload: expect.objectContaining({
          plan: freshPlan,
          announcePhases: true,
          freshRun: false,
          storyboardOwner: storyboardOwner('storyboard_claim_A'),
        }),
      })
    );
  });

  test('a continue runs the plan through the unit executor, not the script run (#1818)', async () => {
    // the wrapper only forwards it
    const plan = asStub<NonNullable<StoryboardWorkflowInput['plan']>>({
      targets: [],
    });
    await run({ stopAt: 'music', resume: true, plan });

    expect(spawnAndAwaitChild).toHaveBeenCalledTimes(1);
    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spawnStepName: 'spawn-continue',
        childPayload: expect.objectContaining({ plan, announcePhases: true }),
      })
    );
  });

  test('a failed unit stays on the unit: the sequence completes and sends no ready email (#2104)', async () => {
    // the wrapper only forwards it
    const plan = asStub<NonNullable<StoryboardWorkflowInput['plan']>>({
      targets: [],
    });
    const { completeWorkflowIfCurrent, failWorkflowIfCurrent, names } =
      await run(
        { stopAt: 'motion', resume: true, plan },
        {
          failures: [
            { shotId: 'shot_1', stage: 'video', error: 'Insufficient credits' },
          ],
        }
      );

    expectCurrentCompletion(completeWorkflowIfCurrent);
    expect(failWorkflowIfCurrent).not.toHaveBeenCalled();
    expect(names).toContain('emit-complete');
    expect(names).not.toContain('email-ready');
  });

  test('an early stop completes without spending the ready email', async () => {
    const { completeWorkflowIfCurrent, names } = await run({
      stopAt: 'script',
    });

    expectCurrentCompletion(completeWorkflowIfCurrent);
    expect(names).toContain('emit-complete');
    expect(names).not.toContain('email-ready');
    expect(notifySequenceReady).not.toHaveBeenCalled();
  });

  test('a credits shortfall keeps the top-up sentence off the generic failure line', async () => {
    gateStoryboardRenders.mockResolvedValueOnce({
      spawnRenders: false,
      neededMicros: 5_000_000,
      remainingMicros: 0,
    });
    emit.mockReset();
    const { scopedDb, failWorkflowIfCurrent } = makeRunImplDb();
    const { step, names } = makeStep();

    await expect(
      makeWorkflow().invokeRunImpl(makeEvent('seq_1'), step, scopedDb)
    ).rejects.toBeInstanceOf(WorkflowLoggedError);

    expect(failWorkflowIfCurrent).toHaveBeenCalledWith({
      id: 'seq_1',
      ...storyboardOwner(),
      error: expect.stringMatching(/not enough credits to generate/i),
    });
    expect(names).toContain('mark-reservation-short');
    expect(names.indexOf('emit-reservation-short')).toBeGreaterThan(
      names.indexOf('mark-reservation-short')
    );
    expect(names).not.toContain('mark-completed');
    expect(names).not.toContain('email-ready');
  });
});
