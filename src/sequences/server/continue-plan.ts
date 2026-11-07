import {
  estimatePlanImageCost,
  planUsesConfiguredImages,
} from '@/billing/configured-image-plan-billing';
import { computePlan } from '@/shots/server/update-stale-plan';
import type { Locale } from '@/platform/i18n/locale';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { addMicros, ZERO_MICROS } from '@/billing/money';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { loadStoryboardModelConfiguration } from './launchers';
import { configuredImageSource } from '@/billing/configured-image-billing';
/**
 * What a continue click may run (#1817): the generation plan, filtered to
 * work up to the stop. The plan is the only opinion — no checkpoint stage, no
 * `startFrom` from the client — so the footer and this guard cannot disagree.
 */

import { musicRequestDurationSeconds } from '@/audio/server/music-staleness';
import { estimateImageCost, estimatePlanCost } from '@/billing/cost-estimation';
import type { Microdollars } from '@/billing/money';
import { getEffectiveFalPricing } from '@/billing/server/fal-pricing-live';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_VIDEO_MODEL,
  safeAudioModel,
  safeImageToVideoModel,
  safeTextToImageModel,
} from '@/models/models';
import { resolveShotDuration } from '@/motion/resolve-shot-duration';
import { ValidationError } from '@/platform/errors';
import type { Sequence, Shot } from '@/platform/server/db/schema';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { computeGenerationPlan } from './generation-plan';
import { getSequenceRejectingActiveRun } from './launchers';
import {
  planCounts,
  planWork,
  switchLocks,
  switchStopAt,
  type PlanUnit,
} from '@/sequences/generation-plan';
import {
  resolveStopAt,
  sliderStopLabel,
  type GenerationStage,
} from '@/sequences/pipeline';

type Flags = { generateStartFrames: boolean; generateVoices: boolean };

export function continueFromPlan(args: {
  /** The plan under the saved flags — what already exists. */
  current: readonly PlanUnit[];
  /** The plan under the requested flags — what this click would owe. */
  next: readonly PlanUnit[];
  saved: Flags;
  requested: Flags;
  stopAt: GenerationStage;
}): { work: PlanUnit[]; stopAt: GenerationStage } {
  const locks = switchLocks(args.current);
  if (
    args.saved.generateVoices &&
    !args.requested.generateVoices &&
    locks.voices
  ) {
    throw new ValidationError(
      'Voices can’t be turned off: shots already have recorded dialogue'
    );
  }
  const stopAt = switchStopAt({ ...args, plan: args.next });
  const work = planWork(args.next, stopAt);
  if (work.length === 0) {
    throw new ValidationError(
      `Nothing to generate up to ${sliderStopLabel(stopAt)}`
    );
  }
  return { work, stopAt };
}

/**
 * The quote and the reservation for a continue: the plan's work, priced per
 * unit. `priced` is false when a still is owed and its model has no price —
 * the footer shows no estimate, the gate reserves the floored number.
 */
type ContinueEstimateInput = {
  sequence: Pick<
    Sequence,
    'imageModel' | 'videoModel' | 'musicModel' | 'aspectRatio' | 'resolution'
  >;
  shots: ReadonlyArray<Pick<Shot, 'durationMs'>>;
  work: readonly PlanUnit[];
  generateStartFrames: boolean;
  draftMotion: boolean;
  modelConfiguration: ModelRuntimeConfiguration;
  imagePlan: UpdateStalePlan;
};

function continueImageEstimate(
  args: ContinueEstimateInput,
  pricing: Awaited<ReturnType<typeof getEffectiveFalPricing>>
) {
  const model = safeTextToImageModel(
    args.sequence.imageModel,
    DEFAULT_IMAGE_MODEL
  );
  const routing = args.modelConfiguration.imageModelRouting;
  const counts = planCounts(args.work);
  const quote = planUsesConfiguredImages(args.imagePlan, routing)
    ? estimatePlanImageCost(args.imagePlan, routing, pricing)
    : undefined;
  const priced = quote
    ? quote.priced
    : counts.still === 0 ||
      estimateImageCost(model, args.sequence.aspectRatio, 1, {
        pricing,
        imageModelRouting: routing,
        resolution: args.sequence.resolution,
      }) !== null;
  const hasImages =
    counts.still +
      counts['sheet:character'] +
      counts['sheet:location'] +
      counts['ref:element'] >
    0;
  return {
    imageModel: model,
    imageModelRouting: routing,
    priced,
    counts: quote
      ? {
          ...counts,
          still: 0,
          'sheet:character': 0,
          'sheet:location': 0,
          'ref:element': 0,
        }
      : counts,
    costMicros: quote?.costMicros ?? ZERO_MICROS,
    imageSource:
      quote?.imageSource ??
      (hasImages ? configuredImageSource(model, routing) : undefined),
  };
}

async function estimateContinueCost(args: ContinueEstimateInput): Promise<{
  micros: Microdollars;
  priced: boolean;
  imageSource?: 'platform';
}> {
  const { sequence, shots } = args;
  const pricing = await getEffectiveFalPricing();
  const image = continueImageEstimate(args, pricing);
  const videoModel = safeImageToVideoModel(
    sequence.videoModel,
    DEFAULT_VIDEO_MODEL
  );
  const cost = estimatePlanCost({
    counts: image.counts,
    imageModel: image.imageModel,
    imageModelRouting: image.imageModelRouting,
    aspectRatio: sequence.aspectRatio,
    resolution: sequence.resolution,
    videoModels: [videoModel],
    videoDurationSeconds: resolveShotDuration({
      durationMs: shots[0]?.durationMs,
      model: videoModel,
    }),
    referenceOnly: !args.generateStartFrames,
    draftMotion: args.draftMotion,
    audioModels: [safeAudioModel(sequence.musicModel, DEFAULT_MUSIC_MODEL)],
    audioDurationSeconds: musicRequestDurationSeconds(shots),
    pricing,
  });
  return {
    micros: addMicros(cost, image.costMicros),
    priced: image.priced,
    imageSource: image.imageSource,
  };
}

export async function prepareContinueEstimate(args: {
  promptLocale?: Locale;
  scopedDb: ScopedDb;
  userId: string;
  sequence: Sequence;
  work: readonly PlanUnit[];
  requested: Flags;
  draftMotion: boolean;
}) {
  const { scopedDb, sequence, requested, work } = args;
  const modelConfiguration = await loadStoryboardModelConfiguration(scopedDb);
  const plan = await computePlan({
    promptLocale: args.promptLocale,
    scopedDb,
    userId: args.userId,
    sequenceId: sequence.id,
    sequenceOverrides: { ...requested, draftMotion: args.draftMotion },
    units: work.map(({ kind, id }) => ({ kind, id })),
    imageModelRouting: modelConfiguration.imageModelRouting,
  });
  const estimate = await estimateContinueCost({
    modelConfiguration,
    imagePlan: plan,
    sequence,
    shots: await scopedDb.shots.listBySequence(sequence.id),
    work,
    generateStartFrames: requested.generateStartFrames,
    draftMotion: args.draftMotion,
  });
  return { estimate, modelConfiguration, plan };
}

/**
 * The one gate and work list for Continue, shared by the editor and MCP. The
 * sequence must not be running a storyboard (the switches a click saves are
 * snapshotted by the trigger). `requested` is the start-frame and voice
 * switches the run uses; an agent passes the saved ones. The caller checks
 * `estimate.micros` against the balance (a check, not a hold, #1818).
 */
export async function prepareContinue(args: {
  promptLocale?: Locale;
  scopedDb: ScopedDb;
  userId: string;
  sequence: Sequence;
  stopAt: GenerationStage;
  requested: { generateStartFrames: boolean; generateVoices: boolean };
  draftMotion: boolean;
  /** The live plan under the saved switches, when already computed. */
  generationPlan?: readonly PlanUnit[];
}) {
  const { scopedDb, sequence, requested } = args;
  await getSequenceRejectingActiveRun(scopedDb, sequence.id);
  const saved = {
    generateStartFrames: sequence.generateStartFrames,
    generateVoices: sequence.generateVoices,
  };
  const current =
    args.generationPlan ??
    (await computeGenerationPlan(scopedDb, sequence.id)).units;
  const next =
    saved.generateStartFrames === requested.generateStartFrames &&
    saved.generateVoices === requested.generateVoices
      ? current
      : (await computeGenerationPlan(scopedDb, sequence.id, requested)).units;
  const { work, stopAt } = continueFromPlan({
    current,
    next,
    saved,
    requested,
    stopAt: args.stopAt,
  });
  const prepared = await prepareContinueEstimate({ ...args, work });
  return { work, stopAt, ...prepared };
}

/**
 * Save a Continue's switches, run it, and put them back if it refuses (a run
 * already in flight, no style): the trigger snapshots them off the row, and a
 * rejected click must not leave its switches on a sequence nothing ran with.
 * Shared by the editor and MCP so both save the same four.
 */
export async function withContinueSwitches<T>(
  scopedDb: ScopedDb,
  sequence: Sequence,
  settings: {
    generationStopAt: GenerationStage;
    generateStartFrames: boolean;
    generateVoices: boolean;
    draftMotion: boolean;
  },
  run: () => Promise<T>
): Promise<T> {
  const before = {
    generationStopAt: resolveStopAt({
      generationStopAt: sequence.generationStopAt,
    }),
    generateStartFrames: sequence.generateStartFrames,
    generateVoices: sequence.generateVoices,
    draftMotion: sequence.draftMotion,
  };
  await scopedDb.sequences.update({ id: sequence.id, ...settings });
  try {
    return await run();
  } catch (error) {
    await scopedDb.sequences.update({ id: sequence.id, ...before });
    throw error;
  }
}

/** Whose keys waive Continue's balance check (script analysis + renders). */
export const CONTINUE_CREDIT_PROVIDERS = ['fal', 'openrouter'] as const;
