import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  MotionMusicPromptsWorkflowInput,
  MotionMusicPromptsWorkflowResult,
} from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Scene } from '@/shots/scene-analysis.schema';
import { asStub } from '@/test/as-stub';

const spawnAndAwaitChild = vi.fn(async () => ({
  prompt: 'cinematic score',
  tags: 'orchestral',
  scenes: [],
}));
const sceneSummariesFromAnalysis = vi.fn(() => [
  { sceneId: 'scene-1', summary: 'A quiet arrival' },
]);
const joinMusicDesignByIndex = vi.fn(
  (scenes: Scene[], _design: unknown[]) => scenes
);

vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));
vi.doMock('@/audio/server/workflows/music-scene-summaries', () => ({
  joinMusicDesignByIndex,
  musicSceneSummariesFromAnalysis: sceneSummariesFromAnalysis,
}));
vi.doMock('@/audio/server/music-prompt', () => ({
  reinforceInstrumentalTags: (tags: string) => `${tags}, instrumental`,
}));

const { MotionMusicPromptsWorkflow } =
  await import('./motion-music-prompts-workflow');

class Probe extends MotionMusicPromptsWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<MotionMusicPromptsWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ): Promise<MotionMusicPromptsWorkflowResult> {
    return this.runImpl(event, step, scopedDb);
  }
}

function makeStep(): WorkflowStep {
  return asStub<WorkflowStep>({
    do: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  });
}

function makeInput(scene: Scene): MotionMusicPromptsWorkflowInput {
  return asStub<MotionMusicPromptsWorkflowInput>({
    promptLocale: 'zh-CN',
    userId: 'user-1',
    organizationId: 'organization-1',
    sequenceId: 'sequence-1',
    reservationId: 'reservation-1',
    scenesWithVisualPrompts: [scene],
    shotMapping: [],
    aspectRatio: '16:9',
    characterBible: [],
    locationBible: [],
    elementBible: [],
    styleConfig: {},
    analysisModelId: 'google/gemini-3-flash-preview',
    musicPromptSource: 'ai-generated',
    referenceOnly: false,
  });
}

describe('MotionMusicPromptsWorkflow', () => {
  it('passes the parent model snapshot and request context to the music child', async () => {
    const scene = asStub<Scene>({ sceneId: 'scene-1' });
    const input = makeInput(scene);
    const modelConfiguration: ModelRuntimeConfiguration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      sceneSplit: 'z-ai/glm-5.3-flash',
    };
    const event = asStub<WorkflowEvent<MotionMusicPromptsWorkflowInput>>({
      instanceId: 'motion-music-parent-1',
      payload: input,
    });
    const scopedDb = asStub<WorkflowScopedDb>({ models: modelConfiguration });
    const workflow = new Probe(asStub(undefined), asStub({}));

    const result = await workflow.runBody(event, makeStep(), scopedDb);

    expect(spawnAndAwaitChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelConfiguration,
        parentBindingName: 'MOTION_MUSIC_PROMPTS_WORKFLOW',
        parentInstanceId: 'motion-music-parent-1',
        childId: 'music-prompt:sequence-1',
        childPayload: expect.objectContaining({
          promptLocale: 'zh-CN',
          userId: 'user-1',
          organizationId: 'organization-1',
          sequenceId: 'sequence-1',
          reservationId: 'reservation-1',
          sceneSummaries: sceneSummariesFromAnalysis.mock.results[0]?.value,
          analysisModelId: input.analysisModelId,
          promptSource: 'ai-generated',
          musicModel: 'elevenlabs_music',
        }),
      })
    );
    expect(result).toMatchObject({
      completeScenes: [scene],
      musicPrompt: 'cinematic score',
      musicTags: 'orchestral, instrumental',
      motionPromptsBySceneId: {},
      motionPromptsByShotId: {},
    });
    expect(joinMusicDesignByIndex).toHaveBeenCalledWith(
      [scene],
      expect.any(Array)
    );
  });
});
