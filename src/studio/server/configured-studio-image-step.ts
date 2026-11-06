import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StudioRunInput } from '@/studio/schema';
import type { StudioGenerationWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent } from 'cloudflare:workers';
import { aspectRatioToImageSize } from '@/models/aspect-ratios';
import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';
import { runConfiguredImageStep } from '@/stills/server/configured-image-step';
import { uploadStudioImage } from './upload';
import { tagStudioReferences } from '@/studio/text-to-video';

export async function runConfiguredStudioImageStep(args: {
  event: Readonly<WorkflowEvent<StudioGenerationWorkflowInput>>;
  input: Extract<StudioRunInput, { activity: 'image' }>;
  step: WorkflowStep;
  scopedDb: WorkflowScopedDb;
}) {
  const { input, event, step, scopedDb } = args;
  const result = await runConfiguredImageStep({
    step,
    scopedDb,
    stepName: 'generate-image',
    workflowRunId: event.instanceId,
    reservationId: event.payload.reservationId,
    maximumOutputs: IMAGE_PARAMETER_LIMITS.maximumImages,
    params: {
      model: input.imageModel,
      prompt: input.referenceImages.length
        ? tagStudioReferences(input.prompt)
        : input.prompt,
      imageSize: aspectRatioToImageSize(input.aspectRatio),
      resolution: input.resolution,
      referenceImageUrls: input.referenceImages,
      channelParameters: input.channelParameters,
      maskImageUrl: input.maskImageUrl,
    },
    store: async (generation) => {
      const uploads = [];
      for (const [imageIndex, imageUrl] of generation.imageUrls.entries()) {
        uploads.push(
          await uploadStudioImage({
            imageUrl,
            imageIndex,
            organizationId: event.payload.organizationId,
            assetId: event.payload.assetId,
          })
        );
      }
      return uploads;
    },
  });
  const uploads = result.stored.map((image) => {
    if (!image.contentType)
      throw new Error('Stored image MIME type is unavailable.');
    return { ...image, contentType: image.contentType };
  });
  return { uploads, metadata: result.metadata, via: result.via };
}
