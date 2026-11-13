import { describe, expect, it, vi } from 'vitest';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ReplaceElementWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';

const imageBinding = {};
const motionBinding = {};
const spawnAndAwaitChild = vi.fn(async () => ({
  imageUrl: 'https://r2/new-still.png',
}));
const describeElementImage = vi.fn(async () => ({
  description: 'A blue square logo',
  consistencyTag: 'blue-square-logo',
  suggestedToken: 'LOGO',
  model: 'google/gemini-3-flash-preview' as const,
  costMicros: 12,
  usedOwnKey: false,
}));
const deductWorkflowCredits = vi.fn(async () => {});
const channelEmit = vi.fn(async () => {});

vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));
vi.doMock('@/cast/server/element-vision', () => ({
  describeElementImage,
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: channelEmit }),
}));

const { ReplaceElementWorkflow } = await import('./replace-element-workflow');

class Probe extends ReplaceElementWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<ReplaceElementWorkflowInput>>,
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

describe('ReplaceElementWorkflow', () => {
  it('passes the parent model snapshot to the image child after vision', async () => {
    const modelConfiguration: ModelRuntimeConfiguration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      vision: 'google/gemini-3-flash-preview',
    };
    const input = asStub<ReplaceElementWorkflowInput>({
      promptLocale: 'zh-CN',
      userId: 'user-1',
      organizationId: 'organization-1',
      sequenceId: 'sequence-1',
      elementId: 'element-1',
      token: 'LOGO',
      previousDescription: 'A red hex logo',
      newImageUrl: 'https://r2/upload.png',
      newFilename: 'logo.png',
      affectedShotIds: ['shot-1'],
      motionPromptByShotId: { 'shot-1': 'A quiet walk' },
      shotSnapshotByShotId: {
        'shot-1': {
          frameId: 'frame-1',
          sourceImageUrl: 'https://r2/old-still.png',
          sourceModel: 'nano_banana_2',
          hasVideo: false,
          durationMs: 3000,
        },
      },
      aspectRatio: '16:9',
      resolution: '720p',
      videoModel: 'kling_v3_pro',
      imageModel: 'nano_banana_2',
    });
    const event = asStub<WorkflowEvent<ReplaceElementWorkflowInput>>({
      instanceId: 'replace-parent-1',
      payload: input,
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      models: modelConfiguration,
      credentials: {
        resolveLlmKey: vi.fn(async () => ({ source: 'platform' })),
      },
      sequenceElements: {
        updateVisionStatus: vi.fn(async () => {}),
        updateVisionResult: vi.fn(async () => {}),
        isTokenTaken: vi.fn(async () => false),
      },
      liveRead: {
        shots: {
          getByIds: vi.fn(async () => [{ id: 'shot-1' }]),
        },
      },
      frameVariants: {
        createPendingClaim: vi.fn(async () => ({ id: 'claim-1' })),
        failUnclaimed: vi.fn(async () => {}),
      },
    });
    const workflow = new Probe(
      asStub(undefined),
      asStub({ IMAGE_WORKFLOW: imageBinding, MOTION_WORKFLOW: motionBinding })
    );

    const result = await workflow.runBody(event, makeStep(), scopedDb);

    expect(describeElementImage).toHaveBeenCalledWith(
      expect.objectContaining({
        promptLocale: 'zh-CN',
        model: 'google/gemini-3-flash-preview',
        imageUrl: 'https://r2/upload.png',
        filename: 'logo.png',
      })
    );
    expect(deductWorkflowCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        costMicros: 12,
        workflowName: 'ReplaceElementWorkflow',
      })
    );
    expect(spawnAndAwaitChild).toHaveBeenCalledTimes(1);
    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        binding: imageBinding,
        modelConfiguration,
        parentBindingName: 'REPLACE_ELEMENT_WORKFLOW',
        parentInstanceId: 'replace-parent-1',
        childId: 'image:sequence-1:shot-1',
        childPayload: expect.objectContaining({
          promptLocale: 'zh-CN',
          shotId: 'shot-1',
          frameId: 'frame-1',
          targetVariantId: 'claim-1',
          model: 'nano_banana_2',
          referenceImages: expect.arrayContaining([
            expect.objectContaining({
              referenceImageUrl: 'https://r2/old-still.png',
              role: 'primary',
            }),
            expect.objectContaining({
              referenceImageUrl: 'https://r2/upload.png',
              role: 'element',
            }),
          ]),
        }),
      })
    );
    expect(result).toEqual({
      elementId: 'element-1',
      successCount: 1,
      failedCount: 0,
    });
  });
});
