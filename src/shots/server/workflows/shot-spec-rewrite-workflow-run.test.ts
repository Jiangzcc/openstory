import { describe, expect, it, vi } from 'vitest';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ShotSpecRewriteWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { StoredShotSpec } from '@/shots/shot-list.schema';
import { asStub } from '@/test/as-stub';

const spec: StoredShotSpec = {
  framing: {
    shotSize: 'medium',
    angle: 'eye-level',
    composition: 'centered',
    subjectStartState: 'standing',
  },
  action: 'walks forward',
  cameraMovement: { move: 'slow pan', pacing: 'steady' },
  direction: '',
  soundCue: '',
};
const durableLLMCallCf = vi.fn(async () => spec);
const completeDerivedPrompts = vi.fn(async () => ({
  visualVersionId: 'visual-1',
  motionVersionId: 'motion-1',
}));
const promoteIfPending = vi.fn(async () => ({
  id: 'spec-1',
  spec,
}));
const channelEmit = vi.fn(async () => {});

vi.doMock('@/models/server/llm-call-helper', () => ({
  durableLLMCallCf,
}));
vi.doMock('@/shots/server/rebuild-shot-prompts', () => ({
  completeDerivedPrompts,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: channelEmit }),
  getShotPromptChannel: () => ({ emit: channelEmit }),
}));

const { ShotSpecRewriteWorkflow } =
  await import('./shot-spec-rewrite-workflow');

class Probe extends ShotSpecRewriteWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<ShotSpecRewriteWorkflowInput>>,
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

describe('ShotSpecRewriteWorkflow', () => {
  it('promotes the rewritten spec and rebuilds derived prompts from the snapshot', async () => {
    const modelConfiguration: ModelRuntimeConfiguration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      sceneSplit: 'z-ai/glm-5.3-flash',
    };
    const input = asStub<ShotSpecRewriteWorkflowInput>({
      promptLocale: 'zh-CN',
      userId: 'user-1',
      organizationId: 'organization-1',
      sequenceId: 'sequence-1',
      shotId: 'shot-1',
      frameId: 'frame-1',
      claimId: 'claim-1',
      visualClaimId: 'visual-claim-1',
      motionClaimId: 'motion-claim-1',
      visualWritten: false,
      motionWritten: false,
      referenceOnly: false,
      scene: asStub<ShotSpecRewriteWorkflowInput['scene']>({
        sceneId: 'scene-1',
      }),
      siblingSpecs: [],
      characterBible: [],
      locationBible: [],
      elementBible: [],
      styleConfig: asStub<ShotSpecRewriteWorkflowInput['styleConfig']>({}),
      aspectRatio: '16:9',
      analysisModelId: 'google/gemini-3-flash-preview',
      lines: [],
      specInputHash: 'spec-hash',
      currentSpec: null,
      dialogue: asStub<ShotSpecRewriteWorkflowInput['dialogue']>({}),
      emitStreaming: false,
    });
    const event = asStub<WorkflowEvent<ShotSpecRewriteWorkflowInput>>({
      instanceId: 'rewrite-parent-1',
      payload: input,
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      models: modelConfiguration,
      shotSpecVersions: { promoteIfPending },
    });
    const workflow = new Probe(asStub(undefined), asStub({}));

    const result = await workflow.runBody(event, makeStep(), scopedDb);

    expect(durableLLMCallCf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'google/gemini-3-flash-preview',
      }),
      expect.objectContaining({
        sequenceId: 'sequence-1',
        promptLocale: 'zh-CN',
        workflowRunId: 'rewrite-parent-1',
        reservationId: undefined,
        scopedDb,
      })
    );
    expect(promoteIfPending).toHaveBeenCalledWith({
      shotId: 'shot-1',
      claimId: 'claim-1',
      spec,
      source: 'rewrite',
      inputHash: 'spec-hash',
      createdBy: 'user-1',
    });
    expect(completeDerivedPrompts).toHaveBeenCalledWith(
      scopedDb,
      expect.objectContaining({
        promptLocale: 'zh-CN',
        spec,
        specVersionId: 'spec-1',
        scene: input.scene,
        styleConfig: input.styleConfig,
        aspectRatio: '16:9',
        analysisModel: 'google/gemini-3-flash-preview',
        referenceOnly: false,
        frameId: 'frame-1',
        shotId: 'shot-1',
        visualClaimId: 'visual-claim-1',
        motionClaimId: 'motion-claim-1',
        currencyHash: 'spec-hash',
      })
    );
    expect(result).toEqual({
      specVersionId: 'spec-1',
      visualVersionId: 'visual-1',
      motionVersionId: 'motion-1',
    });
  });
});
