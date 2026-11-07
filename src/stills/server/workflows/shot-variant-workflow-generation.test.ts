import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ShotVariantWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
const { soften } = vi.hoisted(() => ({ soften: vi.fn() }));
// Mock the paid generation boundary after real workflow preparation.
vi.mock('./content-soften', () => ({ generateImageSoftening: soften }));
import { ShotVariantWorkflow } from './shot-variant-workflow';
class Probe extends ShotVariantWorkflow {
  execute(
    event: WorkflowEvent<ShotVariantWorkflowInput>,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, db);
  }
}
beforeEach(() => soften.mockReset());
it.each(['mock-parent-hold', undefined])(
  'passes the exact reservation %s to softening',
  async (reservationId) => {
    const input = {
      promptLocale: 'en',
      userId: 'mock-user',
      organizationId: 'mock-org',
      sequenceId: 'mock-sequence',
      shotId: 'mock-shot',
      frameId: 'mock-frame',
      thumbnailUrl: '/r2/mock/source.png',
      model: 'nano_banana_2',
      aspectRatio: '16:9',
      tileHashInput: null,
      reservationId,
    } satisfies ShotVariantWorkflowInput;
    const event = {
      payload: input,
      instanceId: 'mock-run',
      timestamp: new Date(0),
      workflowName: 'mock-variant',
    };
    const step = asStub<WorkflowStep>({
      do: async (_name: string, callback: () => Promise<unknown>) => callback(),
    });
    const db = asStub<WorkflowScopedDb>({
      models: {},
      liveRead: { frames: { getById: async () => ({ id: 'mock-frame' }) } },
      frameVariants: { appendVersion: async () => ({ id: 'mock-version' }) },
    });
    const stop = new Error('Mock stop before any provider request');
    soften.mockRejectedValueOnce(stop);
    type Ctor = ConstructorParameters<typeof Probe>;
    const workflow = new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
    await expect(workflow.execute(event, step, db)).rejects.toBe(stop);
    expect(soften).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId,
        workflowRunId: event.instanceId,
      })
    );
  }
);
