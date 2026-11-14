/**
 * A failed upscale leaves the status race (#1942): the old still is still
 * good, so the shot reads it; the user hears through `upscaleError`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { UpscaleShotVariantWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';

const emit = vi.fn((_event: string, _data: unknown) => Promise.resolve());
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));
const getAnchorImageUrl = vi.fn(() => Promise.resolve('https://r2/old.png'));
vi.doMock('@/shots/server/frame-image', () => ({ getAnchorImageUrl }));

const { UpscaleShotVariantWorkflow } =
  await import('./upscale-shot-variant-workflow');

class Probe extends UpscaleShotVariantWorkflow {
  fail(
    event: Readonly<WorkflowEvent<UpscaleShotVariantWorkflowInput>>,
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

function makeDb() {
  const frameVariants = {
    update: vi.fn(() => Promise.resolve({})),
    markFailedByWorkflowRun: vi.fn(() => Promise.resolve(1)),
  };
  const db = {
    frameVariants,
    frames: { clearPendingPromoteVersionIdIf: vi.fn() },
    claims: {
      frameVariants: {
        getById: vi.fn(() => Promise.resolve({ status: 'generating' })),
      },
    },
    liveRead: { frames: { getById: vi.fn(() => Promise.resolve(null)) } },
  };
  // stub of the surface onFailure touches
  return { ...db, scopedDb: asStub<WorkflowScopedDb>(db) };
}

function fail(versionId: string | undefined, scopedDb: WorkflowScopedDb) {
  const payload: UpscaleShotVariantWorkflowInput = {
    promptLocale: 'en' as const,
    userId: 'u1',
    organizationId: 't1',
    sequenceId: 'seq_1',
    shotId: 'shot_1',
    frameId: 'frame_1',
    promptVersionId: null,
    croppedTileUrl: 'https://r2/tile.png',
    croppedTilePath: 'tile.png',
    ...(versionId ? { versionId } : {}),
  };
  return makeWorkflow().fail(
    {
      payload,
      instanceId: 'run_1',
      workflowName: 'upscale',
      timestamp: new Date(0),
    },
    scopedDb
  );
}

describe('UpscaleShotVariantWorkflow onFailure (#1942)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockResolvedValue(undefined);
    getAnchorImageUrl.mockResolvedValue('https://r2/old.png');
  });
  it('fails the minted version out of the race', async () => {
    const { frameVariants, scopedDb } = makeDb();
    await fail('ver_1', scopedDb);
    expect(frameVariants.update).toHaveBeenCalledWith('ver_1', {
      status: 'failed',
      isPrimary: false,
      error: 'boom',
    });
  });

  it('fails a legacy run by run id out of the race', async () => {
    const { frameVariants, scopedDb } = makeDb();
    await fail(undefined, scopedDb);
    expect(frameVariants.markFailedByWorkflowRun).toHaveBeenCalledWith(
      'run_1',
      'boom',
      { isPrimary: false }
    );
  });

  it('tells the user the upscale failed', async () => {
    emit.mockClear();
    await fail('ver_1', makeDb().scopedDb);
    expect(emit).toHaveBeenCalledWith(
      'generation.image:progress',
      expect.objectContaining({
        shotId: 'shot_1',
        status: 'completed',
        upscaleError: 'boom',
      })
    );
  });

  it('still tells the user when marking the version failed cannot be written', async () => {
    emit.mockClear();
    const { frameVariants, scopedDb } = makeDb();
    const persistenceError = new Error('database down');
    frameVariants.update.mockRejectedValueOnce(persistenceError);

    await expect(fail('ver_1', scopedDb)).rejects.toBe(persistenceError);

    expect(emit).toHaveBeenCalledWith(
      'generation.image:progress',
      expect.objectContaining({
        shotId: 'shot_1',
        status: 'completed',
        upscaleError: 'boom',
      })
    );
  });
  it('propagates legacy run failure after attempting notification', async () => {
    const { frameVariants, scopedDb } = makeDb();
    const persistenceError = new Error('database down');
    frameVariants.markFailedByWorkflowRun.mockRejectedValueOnce(
      persistenceError
    );

    await expect(fail(undefined, scopedDb)).rejects.toBe(persistenceError);
    expect(emit).toHaveBeenCalledOnce();
  });

  it('still reads the thumbnail and notifies after promotion cleanup fails', async () => {
    const { liveRead, scopedDb } = makeDb();
    const cleanupError = new Error('frame unavailable');
    liveRead.frames.getById.mockRejectedValueOnce(cleanupError);

    await expect(fail('ver_1', scopedDb)).rejects.toBe(cleanupError);
    expect(getAnchorImageUrl).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
  });

  it('notifies without a thumbnail and rejects its read failure', async () => {
    const thumbnailError = new Error('thumbnail unavailable');
    getAnchorImageUrl.mockRejectedValueOnce(thumbnailError);

    await expect(fail('ver_1', makeDb().scopedDb)).rejects.toBe(thumbnailError);
    expect(emit).toHaveBeenCalledWith('generation.image:progress', {
      shotId: 'shot_1',
      status: 'completed',
      upscaleError: 'boom',
    });
  });

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('stops marking a version on engine abort: %s', async (message) => {
    const { frameVariants, liveRead, scopedDb } = makeDb();
    const abort = new Error(message);
    frameVariants.update.mockRejectedValueOnce(abort);

    await expect(fail('ver_1', scopedDb)).rejects.toBe(abort);
    expect(liveRead.frames.getById).not.toHaveBeenCalled();
    expect(getAnchorImageUrl).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    'version read',
    'legacy write',
    'promotion read',
    'thumbnail read',
  ] as const)('stops later actions when %s aborts', async (phase) => {
    const { claims, frameVariants, liveRead, scopedDb } = makeDb();
    const abort = new Error('Aborting engine: Grace period complete');
    const operation = {
      'version read': claims.frameVariants.getById,
      'legacy write': frameVariants.markFailedByWorkflowRun,
      'promotion read': liveRead.frames.getById,
      'thumbnail read': getAnchorImageUrl,
    }[phase];
    operation.mockRejectedValueOnce(abort);

    await expect(
      fail(phase === 'legacy write' ? undefined : 'ver_1', scopedDb)
    ).rejects.toBe(abort);
    if (phase === 'version read')
      expect(frameVariants.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    'channel unavailable',
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('propagates notification error: %s', async (message) => {
    const notificationError = new Error(message);
    emit.mockRejectedValueOnce(notificationError);

    await expect(fail('ver_1', makeDb().scopedDb)).rejects.toBe(
      notificationError
    );
  });
});
