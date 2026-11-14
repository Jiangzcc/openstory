import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { MusicWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';

const emit = vi.fn(async () => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));

const { MusicWorkflow } = await import('./music-workflow');

class Probe extends MusicWorkflow {
  failBody(
    event: Readonly<WorkflowEvent<MusicWorkflowInput>>,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error: 'boom', scopedDb });
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function makeEvent(): WorkflowEvent<MusicWorkflowInput> {
  return asStub({
    instanceId: 'run-1',
    payload: {
      promptLocale: 'en',
      userId: 'user-1',
      organizationId: 'organization-1',
      sequenceId: 'sequence-1',
      prompt: 'tense strings',
      tags: 'cinematic',
      duration: 10,
    },
  });
}

describe('MusicWorkflow failure notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockResolvedValue(undefined);
  });

  it('still emits failure when music claim cleanup cannot be written', async () => {
    const persistenceError = new Error('database down');
    const failMusicClaim = vi.fn(async () => {
      throw persistenceError;
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      sequenceVariants: { failMusicClaim },
    });

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      persistenceError
    );

    expect(emit).toHaveBeenCalledWith(
      'generation.audio:progress',
      expect.objectContaining({ status: 'failed', primary: true })
    );
  });
  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('stops cleanup on engine abort: %s', async (message) => {
    const abort = new Error(message);
    const failMusicClaim = vi.fn(async () => {
      throw abort;
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      sequenceVariants: { failMusicClaim },
    });

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      abort
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('propagates notification engine abort: %s', async (message) => {
    const notificationError = new Error(message);
    const failMusicClaim = vi.fn(async () => undefined);
    const scopedDb = asStub<WorkflowScopedDb>({
      sequenceVariants: { failMusicClaim },
    });
    emit.mockRejectedValueOnce(notificationError);

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      notificationError
    );
    expect(failMusicClaim).toHaveBeenCalledOnce();
  });

  it('keeps ordinary notification errors best effort', async () => {
    const notificationError = new Error('channel unavailable');
    const failMusicClaim = vi.fn(async () => undefined);
    const scopedDb = asStub<WorkflowScopedDb>({
      sequenceVariants: { failMusicClaim },
    });
    emit.mockRejectedValueOnce(notificationError);

    await expect(
      makeWorkflow().failBody(makeEvent(), scopedDb)
    ).resolves.toBeUndefined();
    expect(failMusicClaim).toHaveBeenCalledOnce();
  });

  it('keeps the cleanup error when notification also fails', async () => {
    const persistenceError = new Error('database down');
    const failMusicClaim = vi.fn(async () => {
      throw persistenceError;
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      sequenceVariants: { failMusicClaim },
    });
    emit.mockRejectedValueOnce(new Error('channel unavailable'));

    await expect(makeWorkflow().failBody(makeEvent(), scopedDb)).rejects.toBe(
      persistenceError
    );
    expect(emit).toHaveBeenCalledOnce();
  });
});
