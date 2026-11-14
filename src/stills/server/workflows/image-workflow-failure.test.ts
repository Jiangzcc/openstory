/**
 * A failed image run's rows are the shot's status (#1942): `onFailure` fails
 * what the run opened, and records a failed row only when it opened none.
 */

import { decodeTime } from 'ulid';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ImageWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';

const emit = vi.fn((_event: string, _data: unknown) => Promise.resolve());
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));

const { ImageWorkflow } = await import('./image-workflow');

class Probe extends ImageWorkflow {
  fail(
    event: Readonly<WorkflowEvent<ImageWorkflowInput>>,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error: 'boom', scopedDb });
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  // onFailure never reads ctx
  const ctx = asStub<Ctor[0]>(undefined);
  // onFailure never reads bindings
  const env = asStub<Ctor[1]>({});
  return new Probe(ctx, env);
}

const CLICKED_AT = new Date('2026-09-01T00:00:00Z');

function makeDb(marked: number) {
  const frameVariants = {
    markTerminal: vi.fn(() => Promise.resolve(null)),
    markFailedByWorkflowRun: vi.fn(() => Promise.resolve(marked)),
    appendVersion: vi.fn(() => Promise.resolve({})),
  };
  const db = {
    frameVariants,
    frames: { clearPendingPromoteVersionIdIf: vi.fn() },
    claims: { frameVariants: { getById: vi.fn() } },
    liveRead: {
      frames: {
        getById: vi.fn(() =>
          Promise.resolve({
            id: 'frame_1',
            sequenceId: 'seq_1',
            pendingPromoteVersionId: null,
          })
        ),
      },
    },
  };
  // stub of the surface onFailure touches
  return { ...db, scopedDb: asStub<WorkflowScopedDb>(db) };
}

function fail(
  overrides: Partial<ImageWorkflowInput>,
  scopedDb: WorkflowScopedDb
) {
  const payload: ImageWorkflowInput = {
    promptLocale: 'en',
    userId: 'u1',
    organizationId: 't1',
    variantOnly: false,
    sequenceId: 'seq_1',
    prompt: 'p',
    shotId: 'shot_1',
    frameId: 'frame_1',
    ...overrides,
  };
  return makeWorkflow().fail(
    {
      payload,
      instanceId: 'run_1',
      workflowName: 'image',
      timestamp: CLICKED_AT,
    },
    scopedDb
  );
}

describe('ImageWorkflow onFailure (#1942)', () => {
  beforeEach(() => {
    emit.mockReset();
    emit.mockResolvedValue(undefined);
  });
  it('records a failed primary row, sorted at the click, for a rowless run', async () => {
    const { frameVariants, scopedDb } = makeDb(0);
    await fail({}, scopedDb);
    expect(frameVariants.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        frameId: 'frame_1',
        status: 'failed',
        error: 'boom',
        workflowRunId: 'run_1',
        isPrimary: true,
      })
    );
    const call: unknown[] = frameVariants.appendVersion.mock.calls[0] ?? [];
    const row: unknown = call[0];
    const id =
      row && typeof row === 'object' && 'id' in row ? String(row.id) : '';
    expect(decodeTime(id)).toBe(CLICKED_AT.getTime());
  });

  it('records a rowless added-model failure outside the race', async () => {
    const { frameVariants, scopedDb } = makeDb(0);
    await fail({ variantOnly: true }, scopedDb);
    expect(frameVariants.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', isPrimary: false })
    );
  });

  it('records nothing when the run already opened a row', async () => {
    const { frameVariants, scopedDb } = makeDb(1);
    await fail({}, scopedDb);
    expect(frameVariants.markFailedByWorkflowRun).toHaveBeenCalledWith(
      'run_1',
      'boom'
    );
    expect(frameVariants.appendVersion).not.toHaveBeenCalled();
  });

  it('fails the trigger claim by id and records nothing else', async () => {
    const { frameVariants, scopedDb } = makeDb(0);
    await fail({ targetVariantId: 'claim_1' }, scopedDb);
    expect(frameVariants.markTerminal).toHaveBeenCalledWith(
      'claim_1',
      'failed',
      'boom'
    );
    expect(frameVariants.appendVersion).not.toHaveBeenCalled();
  });

  it('still emits failure when persistence of the failed row cannot be written', async () => {
    const { frameVariants, scopedDb } = makeDb(1);
    const persistenceError = new Error('database down');
    frameVariants.markFailedByWorkflowRun.mockRejectedValueOnce(
      persistenceError
    );
    emit.mockClear();

    await expect(fail({}, scopedDb)).rejects.toBe(persistenceError);

    expect(emit).toHaveBeenCalledWith(
      'generation.image:progress',
      expect.objectContaining({
        shotId: 'shot_1',
        status: 'failed',
        error: 'boom',
      })
    );
  });
  it('skips dependent writes after an anchor read failure and still notifies', async () => {
    const { frameVariants, liveRead, scopedDb } = makeDb(0);
    const readError = new Error('anchor unavailable');
    liveRead.frames.getById.mockRejectedValueOnce(readError);

    await expect(fail({}, scopedDb)).rejects.toBe(readError);
    expect(frameVariants.markFailedByWorkflowRun).not.toHaveBeenCalled();
    expect(frameVariants.appendVersion).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledOnce();
  });

  it('keeps preview persistence best effort and still notifies', async () => {
    const { frameVariants, scopedDb } = makeDb(0);
    const persistenceError = new Error('preview row unavailable');
    frameVariants.markFailedByWorkflowRun.mockRejectedValueOnce(
      persistenceError
    );

    await expect(
      fail({ skipStorage: true }, scopedDb)
    ).resolves.toBeUndefined();
    expect(emit).toHaveBeenCalledWith(
      'generation.image:progress',
      expect.objectContaining({ error: 'boom' })
    );
  });

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('stops a primary cleanup on engine abort: %s', async (message) => {
    const { frameVariants, liveRead, scopedDb } = makeDb(0);
    const abort = new Error(message);
    liveRead.frames.getById.mockRejectedValueOnce(abort);

    await expect(fail({}, scopedDb)).rejects.toBe(abort);
    expect(frameVariants.markFailedByWorkflowRun).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('stops a preview cleanup on engine abort: %s', async (message) => {
    const { frameVariants, scopedDb } = makeDb(0);
    const abort = new Error(message);
    frameVariants.markFailedByWorkflowRun.mockRejectedValueOnce(abort);

    await expect(fail({ skipStorage: true }, scopedDb)).rejects.toBe(abort);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('propagates notification engine abort: %s', async (message) => {
    const { frameVariants, scopedDb } = makeDb(1);
    const notificationError = new Error(message);
    emit.mockRejectedValueOnce(notificationError);

    await expect(fail({}, scopedDb)).rejects.toBe(notificationError);
    expect(
      frameVariants.markFailedByWorkflowRun
    ).toHaveBeenCalledExactlyOnceWith('run_1', 'boom');
  });

  it('keeps ordinary notification errors best effort', async () => {
    const { frameVariants, scopedDb } = makeDb(1);
    const notificationError = new Error('channel unavailable');
    emit.mockRejectedValueOnce(notificationError);

    await expect(fail({}, scopedDb)).resolves.toBeUndefined();
    expect(
      frameVariants.markFailedByWorkflowRun
    ).toHaveBeenCalledExactlyOnceWith('run_1', 'boom');
  });
});
