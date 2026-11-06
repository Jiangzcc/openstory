/**
 * R2 uploads for Images and Videos assets (#1274).
 *
 * Keys live under `teams/<organizationId>/studio/<assetId>/` so they never collide
 * with sequence frame paths. Ingest is the same helpers sequences use:
 * {@link uploadImageFromUrl} / {@link uploadVideoFromUrl}.
 */

import { organizationKeyPrefix } from '@/platform/server/storage/buckets';
import { uploadImageFromUrl } from '@/stills/server/image-storage';
import {
  uploadVideoFromUrl,
  type UploadedVideo,
} from '@/motion/server/video-storage';

export function uploadStudioImage(params: {
  imageUrl: string;
  organizationId: string;
  assetId: string;
  imageIndex?: number;
}): Promise<{ url: string; path: string; contentType: string }> {
  return uploadImageFromUrl(
    params.imageUrl,
    (extension) =>
      `${organizationKeyPrefix(params.organizationId)}/studio/${params.assetId}/${params.imageIndex === undefined ? 'image' : 'image-' + params.imageIndex}.${extension}`
  );
}

export function uploadStudioVideo(params: {
  videoUrl: string;
  organizationId: string;
  assetId: string;
  googleApiKey?: string;
}): Promise<UploadedVideo> {
  return uploadVideoFromUrl(
    params.videoUrl,
    (extension) =>
      `${organizationKeyPrefix(params.organizationId)}/studio/${params.assetId}/video.${extension}`,
    { googleApiKey: params.googleApiKey }
  );
}
