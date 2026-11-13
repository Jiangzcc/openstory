import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { LipsyncWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';

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
      videoModel: 'kling_video_v2_1',
    },
  });
}

describe('LipsyncWorkflow failure notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockResolvedValue(undefined);
  });

  it('still emits failure when video failure persistence cannot be written', async () => {
    const markFailedByWorkflowRun = vi.fn(async () => {
      throw new Error('database down');
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      liveRead: {
        shots: {
          getById: vi.fn(async () => ({ renderSegmentId: null })),
        },
      },
      videoVariants: { markFailedByWorkflowRun },
    });

    await expect(
      makeWorkflow().failBody(makeEvent(), scopedDb)
    ).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledWith(
      'generation.video:progress',
      expect.objectContaining({
        shotId: 'shot-1',
        status: 'failed',
        error: 'boom',
      })
    );
  });

  it('uses the payload sequence when the shot lookup fails', async () => {
    const scopedDb = asStub<WorkflowScopedDb>({
      liveRead: {
        shots: {
          getById: vi.fn(async () => {
            throw new Error('database down');
          }),
        },
      },
      videoVariants: { markFailedByWorkflowRun: vi.fn(async () => 0) },
    });

    await expect(
      makeWorkflow().failBody(makeEvent(), scopedDb)
    ).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledWith(
      'generation.video:progress',
      expect.objectContaining({ shotId: 'shot-1', status: 'failed' })
    );
  });
});
