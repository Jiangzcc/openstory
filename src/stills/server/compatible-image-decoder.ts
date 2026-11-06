import { PhotonImage } from '@cf-wasm/photon';
import { CompatibleImageError } from './compatible-image-error';
import { fitsConfiguredImageDecodeBudget } from '@/models/image-resource-budget';
import type { ImageResourceDimensions } from '@/models/image-resource-budget';

export function validateCompatibleImageDecoding(
  bytes: Uint8Array,
  expected: ImageResourceDimensions
): void {
  if (!fitsConfiguredImageDecodeBudget(expected, bytes.byteLength))
    throw new CompatibleImageError('resource_limit');
  let image: PhotonImage | undefined;
  try {
    image = PhotonImage.new_from_byteslice(bytes);
    if (
      image.get_width() !== expected.width ||
      image.get_height() !== expected.height
    ) {
      throw new CompatibleImageError('invalid_image');
    }
  } catch {
    throw new CompatibleImageError('invalid_image');
  } finally {
    image?.free();
  }
}
