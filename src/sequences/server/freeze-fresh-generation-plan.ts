import type { ScopedDb } from '@/platform/server/db/scoped';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import { computeGenerationPlan } from './generation-plan';
import { planCounts, planWork } from '@/sequences/generation-plan';
import { computePlan } from '@/shots/server/update-stale-plan';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { unpackModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { partitionPlanImageEstimate } from '@/billing/configured-image-plan-billing';
import { addMicros } from '@/billing/money';
import { estimatePlanCost } from '@/billing/cost-estimation';
import { getEffectiveFalPricing } from '@/billing/server/fal-pricing-live';
import { resolveImageModels } from '@/models/resolve-image-models';
import { resolveVideoModels } from '@/models/resolve-video-models';
import { resolveAudioModels } from '@/models/resolve-audio-models';
import { musicRequestDurationSeconds } from '@/audio/server/music-staleness';

/** One planning checkpoint, after this run materialized the script's rows. */
export async function freezeFreshGenerationPlan(
  scopedDb: ScopedDb,
  input: StoryboardWorkflowInput & { sequenceId: string }
) {
  const flags = {
    generateStartFrames: !input.referenceOnly,
    generateVoices: input.generateVoices ?? false,
    includeMusic: input.includeMusic,
  };
  const sequenceOverrides = {
    ...flags,
    status: 'completed' as const,
    analysisModel: input.analysisModelId,
    // Auto style was materialized by this run's analysis; otherwise keep the click snapshot.
    ...(!input.pendingAutoStyleId ? { styleConfig: input.styleConfig } : {}),
    draftMotion: input.draftMotion ?? false,
    imageModel: input.imageModel,
    videoModel: input.videoModel,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
  };
  const { units } = await computeGenerationPlan(
    scopedDb,
    input.sequenceId,
    flags,
    {
      ignoreOwnProcessing: true,
      sequenceOverrides,
    }
  );
  const work = planWork(units, input.stopAt);
  const imageModels = resolveImageModels(input.imageModels, input.imageModel);
  const videoModels = resolveVideoModels(input.videoModels, input.videoModel);
  const audioModels = resolveAudioModels(input.audioModels, input.musicModel);
  const imageModelRouting = frozenImageRouting(input);
  const plan = await computePlan({
    promptLocale: input.promptLocale,
    scopedDb,
    sequenceId: input.sequenceId,
    units: work,
    userId: input.userId,
    sequenceOverrides,
    renderOptions: { imageModels, videoModels, audioModels },
    imageModelRouting,
  });
  if (plan.music) plan.music.promptSource = input.musicPromptSource;
  const remainingCost = await remainingPlanCost(
    scopedDb,
    input,
    plan,
    { imageModels, videoModels, audioModels },
    planCounts(work)
  );
  return { plan, remainingCost };
}

async function remainingPlanCost(
  scopedDb: ScopedDb,
  input: StoryboardWorkflowInput & { sequenceId: string },
  plan: UpdateStalePlan,
  models: {
    imageModels: ReturnType<typeof resolveImageModels>;
    videoModels: ReturnType<typeof resolveVideoModels>;
    audioModels: ReturnType<typeof resolveAudioModels>;
  },
  counts: ReturnType<typeof planCounts>
) {
  const [shots, pricing] = await Promise.all([
    scopedDb.shots.listBySequence(input.sequenceId),
    getEffectiveFalPricing(),
  ]);
  const imageModelRouting = frozenImageRouting(input);
  const image = partitionPlanImageEstimate({
    plan,
    counts,
    imageModelRouting,
    pricing,
  });
  const remaining = estimatePlanCost({
    counts: image.counts,
    imageModel: input.imageModel,
    imageModelCount: models.imageModels.length,
    imageModelRouting,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    videoModels: models.videoModels,
    videoDurationSeconds: Math.max(
      1,
      musicRequestDurationSeconds(shots) / Math.max(shots.length, 1)
    ),
    referenceOnly: input.referenceOnly,
    draftMotion: input.draftMotion ?? false,
    audioModels: models.audioModels,
    audioDurationSeconds: musicRequestDurationSeconds(shots),
    pricing,
  });
  return addMicros(remaining, image.costMicros);
}

function frozenImageRouting(input: StoryboardWorkflowInput) {
  return input.modelConfiguration
    ? (unpackModelRuntimeConfiguration(input.modelConfiguration)
        .imageModelRouting ?? [])
    : [];
}
