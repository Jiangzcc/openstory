import type { ImageModelRoutingSnapshot } from '@/models/image-channels';
import { usesConfiguredImageChannel } from '@/models/image-channels';
import { supportsReferenceImages } from '@/models/models';
import { ValidationError } from '@/platform/errors';
import type { StudioCreateInput } from '@/studio/schema';

const STUDIO_BUILTIN_IMAGE_REFERENCE_LIMIT = 9;

export function requireStudioImageCapabilities(
  input: StudioCreateInput,
  routing?: ImageModelRoutingSnapshot
): void {
  if (
    input.activity !== 'image' ||
    usesConfiguredImageChannel(input.imageModel, routing)
  )
    return;
  if (
    input.referenceImages.length > 0 &&
    !supportsReferenceImages(input.imageModel)
  )
    throw new ValidationError(
      `${input.imageModel} does not take reference images`
    );
  if (input.referenceImages.length > STUDIO_BUILTIN_IMAGE_REFERENCE_LIMIT)
    throw new ValidationError('Too many reference images for this model.');
  if (input.channelParameters !== undefined || input.maskImageUrl !== undefined)
    throw new ValidationError(
      'Channel parameters require a configured image model.'
    );
}
