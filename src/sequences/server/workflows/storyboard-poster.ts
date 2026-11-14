import type { WorkflowStep } from 'cloudflare:workers';
import {
  deductWorkflowCredits,
  extractImageCost,
  recordFalUsageStep,
} from '@/billing/server/workflow-deduction';
import { usesConfiguredImageChannel } from '@/models/image-channels';
import { getGenerationChannel } from '@/platform/realtime';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import type { StoryboardOwner } from '../db/storyboard-owner';

type PosterPublication = {
  step: WorkflowStep;
  scopedDb: WorkflowScopedDb;
  owner: StoryboardOwner;
  poster: { url: string; metadata: ImageGenerationResult['metadata'] };
  reservationId?: string;
};

async function recordPosterCost({
  step,
  scopedDb,
  owner,
  poster,
  reservationId,
}: PosterPublication): Promise<void> {
  const usage = usesConfiguredImageChannel(
    scopedDb.models.poster,
    scopedDb.models.imageModelRouting
  )
    ? {}
    : await recordFalUsageStep(
        step,
        scopedDb,
        poster.metadata,
        'record-fal-usage-poster'
      );
  await step.do('deduct-poster-credits', async () => {
    await deductWorkflowCredits({
      scopedDb,
      costMicros: extractImageCost(poster.metadata),
      usedOwnKey: poster.metadata.usedOwnKey,
      description: `Sequence poster (${scopedDb.models.poster})`,
      idempotencyKey: `${owner.workflowRunId}:poster`,
      reservationId,
      metadata: {
        ...usage,
        ...(poster.metadata.configuredPricing
          ? { configuredPricing: poster.metadata.configuredPricing }
          : {}),
        model: scopedDb.models.poster,
        sequenceId: owner.id,
      },
      workflowName: 'StoryboardWorkflow',
    });
  });
}

export async function publishStoryboardPoster(
  args: PosterPublication
): Promise<boolean> {
  // Incurred usage survives a refused or failed publication.
  await recordPosterCost(args);
  const { step, scopedDb, owner, poster } = args;
  const published = await step.do('save-poster', async () => {
    const saved = await scopedDb.sequences.setPosterIfCurrent({
      ...owner,
      posterUrl: poster.url,
    });
    if (!saved) return false;
    const { id, ...workflowOwner } = owner;
    await getGenerationChannel(id).emit('generation.poster:ready', {
      posterUrl: poster.url,
      workflowOwner,
    });
    return true;
  });
  // A legacy cached save returned void and performs no new publication.
  return published !== false;
}
