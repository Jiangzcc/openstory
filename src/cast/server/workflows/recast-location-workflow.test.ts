import { describe, expect, it, vi } from 'vitest';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { RecastLocationWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';

const regenerateBinding = {};
const spawnAndAwaitChild = vi.fn(async () => ({
  totalShots: 2,
  successCount: 1,
  failedShots: ['shot-2'],
  divergedShotIds: [],
}));
const computeRegenerateShotsBatchHash = vi.fn(async () => 'snapshot-hash');

vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));
vi.doMock('@/shots/server/workflows/regenerate-shots-snapshot', () => ({
  computeRegenerateShotsBatchHash,
}));

const { RecastLocationWorkflow } = await import('./recast-location-workflow');

class Probe extends RecastLocationWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<RecastLocationWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

function makeStep(): WorkflowStep {
  return asStub<WorkflowStep>({
    do: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  });
}

describe('RecastLocationWorkflow', () => {
  it('passes the snapshot and model configuration to regenerate-shots', async () => {
    const modelConfiguration: ModelRuntimeConfiguration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      sceneSplit: 'z-ai/glm-5.3-flash',
    };
    const input = asStub<RecastLocationWorkflowInput>({
      promptLocale: 'zh-CN',
      userId: 'user-1',
      organizationId: 'organization-1',
      sequenceId: 'sequence-1',
      locationDbId: 'location-1',
      locationName: 'Rooftop',
      snapshotInputHash: 'snapshot-hash',
      imageModel: 'nano_banana_2',
      aspectRatio: '16:9',
      resolution: '720p',
      shotSnapshots: [
        asStub<RecastLocationWorkflowInput['shotSnapshots'][number]>({
          shotId: 'shot-1',
        }),
      ],
    });
    const event = asStub<WorkflowEvent<RecastLocationWorkflowInput>>({
      instanceId: 'recast-parent-1',
      payload: input,
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      models: modelConfiguration,
    });
    const workflow = new Probe(
      asStub(undefined),
      asStub({ REGENERATE_SHOTS_WORKFLOW: regenerateBinding })
    );

    const result = await workflow.runBody(event, makeStep(), scopedDb);

    expect(computeRegenerateShotsBatchHash).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceId: 'sequence-1',
        imageModel: 'nano_banana_2',
        aspectRatio: '16:9',
        shotSnapshots: input.shotSnapshots,
      })
    );
    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        binding: regenerateBinding,
        modelConfiguration,
        parentBindingName: 'RECAST_LOCATION_WORKFLOW',
        parentInstanceId: 'recast-parent-1',
        childId: 'regenerate-shots:location:location-1',
        childPayload: expect.objectContaining({
          promptLocale: 'zh-CN',
          sequenceId: 'sequence-1',
          triggerKind: 'location',
          triggerId: 'location-1',
          shotIds: ['shot-1'],
          snapshotInputHash: 'snapshot-hash',
          shotSnapshots: input.shotSnapshots,
        }),
      })
    );
    expect(result).toEqual({ shotsRegenerated: 1, shotsFailed: 1 });
  });
});
