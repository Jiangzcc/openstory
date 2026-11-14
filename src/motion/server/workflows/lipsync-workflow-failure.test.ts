import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { LipsyncWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import { DEFAULT_VIDEO_MODEL } from '@/models/models';

const emit = vi.fn(async () => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));

const { LipsyncWorkflow } = await import('./lipsync-workflow');

class Probe extends LipsyncWorkflow {
  failBody(
    event: Readonly<WorkflowEvent<LipsyncWorkflowInput>>,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error: 'boom', scopedDb });
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function makeEvent(): WorkflowEvent<LipsyncWorkflowInput> {
  return asStub({
    instanceId: 'run-1',
    payload: {
      promptLocale: 'en',
      userId: 'user-1',
      organizationId: 'organization-1',
      sequenceId: 'sequence-1',
      shotId: 'shot-1',
      videoModel: DEFAULT_VIDEO_MODEL,
    },
  });
}

function makeDb(renderSegmentId: string | null = null) {
  const getShot = vi.fn(async () => ({
    renderSegmentId,
    sequenceId: 'sequence-1',
  }));
  const getSegment = vi.fn(async () => ({
    pendingPromoteVersionId: 'pending-1',
  }));
  const getPending = vi.fn(async () => ({
    id: 'pending-1',
    workflowRunId: 'run-1',
  }));
  const clearPending = vi.fn(async () => undefined);
  const markFailedByWorkflowRun = vi.fn(async () => 1);
  const appendVersion = vi.fn(async () => ({}));
  const scopedDb = asStub<WorkflowScopedDb>({
    liveRead: {
      shots: { getById: getShot },
      renderSegments: { getById: getSegment },
    },
    claims: { videoVariants: { getById: getPending } },
    renderSegments: { clearPendingPromoteVersionIdIf: clearPending },
    videoVariants: { markFailedByWorkflowRun, appendVersion },
  });
  return {
    scopedDb,
    getShot,
    getSegment,
    getPending,
    clearPending,
    markFailedByWorkflowRun,
    appendVersion,
  };
}

describe('LipsyncWorkflow failure notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockResolvedValue(undefined);
  });

  it('still emits failure when video failure persistence cannot be written', async () => {
    const { scopedDb, markFailedByWorkflowRun } = makeDb();
    const persistenceError = new Error('database down');
    markFailedByWorkflowRun.mockRejectedValueOnce(persistenceError);

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      persistenceError
    );
    expect(emit).toHaveBeenCalledWith(
      'generation.video:progress',
      expect.objectContaining({
        shotId: 'shot-1',
        status: 'failed',
        error: 'boom',
      })
    );
  });

  it('uses the payload sequence when the shot lookup fails and skips dependent writes', async () => {
    const { scopedDb, getShot, markFailedByWorkflowRun } = makeDb();
    const readError = new Error('database down');
    getShot.mockRejectedValueOnce(readError);

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      readError
    );
    expect(markFailedByWorkflowRun).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'generation.video:progress',
      expect.objectContaining({
        shotId: 'shot-1',
        status: 'failed',
      })
    );
  });

  it.each(['promotion clear', 'variant append'] as const)(
    'still notifies when %s fails',
    async (phase) => {
      const db = makeDb('segment-1');
      const persistenceError = new Error('database down');
      if (phase === 'variant append')
        db.markFailedByWorkflowRun.mockResolvedValueOnce(0);
      const operation =
        phase === 'promotion clear' ? db.clearPending : db.appendVersion;
      operation.mockRejectedValueOnce(persistenceError);

      await expect(
        makeWorkflow().failBody(makeEvent(), db.scopedDb)
      ).rejects.toBe(persistenceError);
      if (phase === 'promotion clear')
        expect(db.markFailedByWorkflowRun).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledOnce();
    }
  );

  it.each(['shot lookup', 'promotion clear', 'variant write'] as const)(
    'stops later actions when %s aborts',
    async (phase) => {
      const db = makeDb('segment-1');
      const abort = new Error('Aborting engine: Grace period complete');
      const operation = {
        'shot lookup': db.getShot,
        'promotion clear': db.clearPending,
        'variant write': db.markFailedByWorkflowRun,
      }[phase];
      operation.mockRejectedValueOnce(abort);

      await expect(
        makeWorkflow().failBody(makeEvent(), db.scopedDb)
      ).rejects.toBe(abort);
      if (phase !== 'variant write')
        expect(db.markFailedByWorkflowRun).not.toHaveBeenCalled();
      expect(db.appendVersion).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    }
  );

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('preserves engine abort identity: %s', async (message) => {
    const { scopedDb, getShot } = makeDb();
    const abort = new Error(message);
    getShot.mockRejectedValueOnce(abort);

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      abort
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('propagates notification engine abort: %s', async (message) => {
    const { scopedDb, markFailedByWorkflowRun } = makeDb();
    const notificationError = new Error(message);
    emit.mockRejectedValueOnce(notificationError);

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      notificationError
    );
    expect(markFailedByWorkflowRun).toHaveBeenCalledExactlyOnceWith(
      'run-1',
      'boom'
    );
  });

  it('keeps ordinary notification errors best effort', async () => {
    const { scopedDb, markFailedByWorkflowRun } = makeDb();
    const notificationError = new Error('channel unavailable');
    emit.mockRejectedValueOnce(notificationError);

    await expect(
      makeWorkflow().failBody(makeEvent(), scopedDb)
    ).resolves.toBeUndefined();
    expect(markFailedByWorkflowRun).toHaveBeenCalledExactlyOnceWith(
      'run-1',
      'boom'
    );
  });
});
