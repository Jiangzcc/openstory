import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { BatchMotionMusicWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';

const motionBinding = {};
const musicBinding = {};
const spawnAndAwaitChild = vi.fn(async () => ({}));
const buildMotionRender = vi.fn(() => [
  {
    input: {
      shotId: 'shot-1',
      model: 'kling_v3_pro' as const,
      prompt: 'A quiet walk',
    },
    shotIndex: 0,
  },
]);
const resolveAudioModels = vi.fn(() => ['elevenlabs_music' as const]);
const zeroReservation = vi.fn(async () => {});
const emit = vi.fn(async () => undefined);
const getGenerationChannel = vi.fn(() => ({ emit }));

vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));
vi.doMock('@/motion/server/build-motion-render', () => ({
  buildMotionRender,
}));
vi.doMock('@/models/resolve-audio-models', () => ({
  resolveAudioModels,
}));
vi.doMock('@/models/server/byteplus-asset-pool', () => ({
  arkAssetIdentities: vi.fn(async () => []),
  bytePlusAssetSlots: vi.fn(() => 0),
}));
vi.doMock('@/models/server/byteplus-observability', () => ({
  reportBytePlusAssetPool: vi.fn(),
}));
vi.doMock('@/models/server/byteplus-config', () => ({
  isBytePlusAssetsConfigured: vi.fn(() => false),
}));
vi.doMock('@/motion/server/motion-generation', () => ({
  arkStillsToRegister: vi.fn(() => []),
}));
vi.doMock('@/platform/realtime', () => ({ getGenerationChannel }));
vi.doMock('./motion-batch-jobs', () => ({
  attachSpeechClips: (shots: unknown[]) => shots,
  buildMotionJobs: vi.fn(() => []),
  missingDialogueAudioShotIds: vi.fn(() => []),
}));
vi.doMock('./motion-workflow-persist', () => ({
  persistMotionFailure: vi.fn(async () => {}),
}));

const { MotionBatchWorkflow } = await import('./motion-batch-workflow');

class Probe extends MotionBatchWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<BatchMotionMusicWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }

  failBody(
    event: Readonly<WorkflowEvent<BatchMotionMusicWorkflowInput>>,
    error: string,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error, scopedDb });
  }
}

function makeStep(): WorkflowStep {
  return asStub<WorkflowStep>({
    do: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    sleep: vi.fn(async () => {}),
  });
}

function makeInput(): BatchMotionMusicWorkflowInput {
  return asStub<BatchMotionMusicWorkflowInput>({
    promptLocale: 'zh-CN',
    userId: 'user-1',
    organizationId: 'organization-1',
    sequenceId: 'sequence-1',
    reservationId: 'reservation-1',
    shots: [
      {
        shotId: 'shot-1',
        sceneId: 'scene-1',
        packedScene: asStub<
          BatchMotionMusicWorkflowInput['shots'][number]['packedScene']
        >({}),
        imageUrl: 'https://cdn.example.com/still.png',
        referenceOnly: false,
        seedanceEditSeconds: null,
        prompt: 'A quiet walk',
        model: 'kling_v3_pro',
      },
    ],
    videoModels: ['kling_v3_pro'],
    includeMusic: true,
    music: {
      prompt: 'quiet strings',
      tags: 'instrumental',
      duration: 3,
      model: 'elevenlabs_music',
    },
    audioModels: ['elevenlabs_music'],
  });
}

describe('MotionBatchWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zeroReservation.mockResolvedValue(undefined);
    emit.mockResolvedValue(undefined);
  });

  it('propagates the parent model snapshot to motion and music children', async () => {
    const modelConfiguration: ModelRuntimeConfiguration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      sceneSplit: 'z-ai/glm-5.3-flash',
    };
    const input = makeInput();
    const event = asStub<WorkflowEvent<BatchMotionMusicWorkflowInput>>({
      instanceId: 'motion-batch-parent-1',
      payload: input,
    });
    const scopedDb = asStub<WorkflowScopedDb>({
      models: modelConfiguration,
      billing: { zeroReservation },
    });
    const workflow = new Probe(
      asStub(undefined),
      asStub({
        MOTION_WORKFLOW: motionBinding,
        MUSIC_WORKFLOW: musicBinding,
      })
    );

    const result = await workflow.runBody(event, makeStep(), scopedDb);

    expect(buildMotionRender).toHaveBeenCalledWith({
      ...input,
      shots: input.shots,
    });
    expect(spawnAndAwaitChild).toHaveBeenCalledTimes(2);
    expect(spawnAndAwaitChild).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        binding: motionBinding,
        modelConfiguration,
        parentBindingName: 'MOTION_BATCH_WORKFLOW',
        parentInstanceId: 'motion-batch-parent-1',
        childId: 'motion:sequence-1:shot-1:kling_v3_pro',
        childPayload: expect.objectContaining({
          shotId: 'shot-1',
          model: 'kling_v3_pro',
        }),
      })
    );
    expect(spawnAndAwaitChild).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        binding: musicBinding,
        modelConfiguration,
        parentBindingName: 'MOTION_BATCH_WORKFLOW',
        parentInstanceId: 'motion-batch-parent-1',
        childId: 'music:sequence-1:elevenlabs_music',
        childPayload: expect.objectContaining({
          promptLocale: 'zh-CN',
          sequenceId: 'sequence-1',
          model: 'elevenlabs_music',
          isPrimary: true,
          reservationId: 'reservation-1',
        }),
      })
    );
    expect(zeroReservation).toHaveBeenCalledWith('reservation-1');
    expect(result).toEqual({ sequenceId: 'sequence-1' });
  });

  it('releases the reservation and reports a failed batch', async () => {
    const event = asStub<WorkflowEvent<BatchMotionMusicWorkflowInput>>({
      payload: asStub<BatchMotionMusicWorkflowInput>({
        reservationId: 'reservation-1',
        sequenceId: 'sequence-1',
      }),
    });

    await new Probe(asStub(undefined), asStub({})).failBody(
      event,
      'batch failed',
      asStub<WorkflowScopedDb>({ billing: { zeroReservation } })
    );

    expect(zeroReservation).toHaveBeenCalledWith('reservation-1');
    expect(getGenerationChannel).toHaveBeenCalledWith('sequence-1');
    expect(emit).toHaveBeenCalledWith('generation.failed', {
      message: 'batch failed',
    });
  });

  it('still reports a failed batch when reservation cleanup fails', async () => {
    zeroReservation.mockRejectedValueOnce(new Error('billing unavailable'));
    const event = asStub<WorkflowEvent<BatchMotionMusicWorkflowInput>>({
      payload: asStub<BatchMotionMusicWorkflowInput>({
        reservationId: 'reservation-1',
        sequenceId: 'sequence-1',
      }),
    });

    await new Probe(asStub(undefined), asStub({})).failBody(
      event,
      'batch failed',
      asStub<WorkflowScopedDb>({ billing: { zeroReservation } })
    );

    expect(emit).toHaveBeenCalledWith('generation.failed', {
      message: 'batch failed',
    });
  });
});
