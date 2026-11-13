import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ShotVariantWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';

const emit = vi.fn(async () => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));

const { ShotVariantWorkflow } = await import('./shot-variant-workflow');

class Probe extends ShotVariantWorkflow {
  failBody(
    event: Readonly<WorkflowEvent<ShotVariantWorkflowInput>>,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error: 'boom', scopedDb });
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function makeEvent(): WorkflowEvent<ShotVariantWorkflowInput> {
  return asStub({
    instanceId: 'run-1',
    payload: {
      promptLocale: 'en',
      userId: 'user-1',
      organizationId: 'organization-1',
      sequenceId: 'sequence-1',
      shotId: 'shot-1',
      thumbnailUrl: 'https://r2/thumbnail.png',
    },
  });
}

describe('ShotVariantWorkflow failure notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockResolvedValue(undefined);
  });

  it('still emits failure when marking the run failed cannot be written', async () => {
    const markFailedByWorkflowRun = vi.fn(async () => {
      throw new Error('database down');
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      frameVariants: { markFailedByWorkflowRun },
    });

    await expect(
      makeWorkflow().failBody(makeEvent(), scopedDb)
    ).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledWith(
      'generation.variant-image:progress',
      expect.objectContaining({ shotId: 'shot-1', status: 'failed' })
    );
  });
});
