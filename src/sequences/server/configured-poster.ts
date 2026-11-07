import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { AspectRatio } from '@/models/aspect-ratios';
import { aspectRatioToImageSize } from '@/models/aspect-ratios';
import { getLogger } from '@/platform/logger';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import { runConfiguredSingleImageStep } from '@/stills/server/configured-image-step';
import { uploadPosterToStorage } from '@/stills/server/image-storage';

const logger = getLogger(['openstory', 'image-channel', 'poster']);
export async function generateConfiguredPoster(args: {
  step: WorkflowStep;
  scopedDb: WorkflowScopedDb;
  workflowRunId: string;
  organizationId: string;
  sequenceId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  reservationId?: string;
}) {
  try {
    const result = await runConfiguredSingleImageStep({
      ...args,
      stepName: 'generate-poster',
      params: {
        model: args.scopedDb.models.poster,
        prompt: args.prompt,
        imageSize: aspectRatioToImageSize(args.aspectRatio),
        numImages: 1,
      },
      store: (image) => {
        const imageUrl = image.imageUrls[0];
        if (!imageUrl)
          throw new Error('Poster generation did not return an image.');
        return uploadPosterToStorage({
          imageUrl,
          organizationId: args.organizationId,
          sequenceId: args.sequenceId,
        });
      },
    });
    return { url: result.stored.url, metadata: result.metadata };
  } catch (error) {
    if (isEngineAbortError(error)) throw error;
    logger.warn('Configured poster generation did not complete.', {
      sequenceId: args.sequenceId,
      error: error instanceof Error ? error.message : 'Unknown image failure',
    });
    return null;
  }
}
