import { readStorageObject, storageObjectSize } from '#storage';
import { isValidId } from '@/platform/id';
import { keyOwner, r2KeyFromUrl } from '@/platform/server/storage/buckets';
import { sniffImageMimeType } from '@/platform/server/storage/file';
import { readCompatibleImageResponse } from './compatible-image-transport';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';

const REFERENCE_FETCH_TIMEOUT_MS = 30_000;
const REFERENCE_LIMIT_ERROR = 'Image references exceed supported file limits.';

async function storedReferenceBytes(
  key: string,
  organizationId: string | undefined,
  maxBytes: number
) {
  const owner = keyOwner(key.split('/').slice(1));
  if (owner && isValidId(owner) && owner !== organizationId)
    throw new Error('Image reference belongs to another organization.');
  const size = await storageObjectSize(key);
  if (size === null) throw new Error('Image reference is unavailable.');
  if (size > maxBytes) throw new Error(REFERENCE_LIMIT_ERROR);
  const object = await readStorageObject(key, {
    offset: 0,
    length: maxBytes + 1,
  });
  if (!object) throw new Error('Image reference is unavailable.');
  if (object.bytes.byteLength > maxBytes)
    throw new Error(REFERENCE_LIMIT_ERROR);
  return object.bytes;
}

async function referenceBytes(
  url: string,
  organizationId: string | undefined,
  maxBytes: number
) {
  if (maxBytes <= 0) throw new Error(REFERENCE_LIMIT_ERROR);
  const key = r2KeyFromUrl(url);
  if (key !== null) return storedReferenceBytes(key, organizationId, maxBytes);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Image reference could not be read.');
  }
  return readCompatibleImageResponse(response, maxBytes);
}

export async function configuredImageReferenceFiles(
  urls: readonly string[],
  organizationId?: string
): Promise<File[]> {
  const files: File[] = [];
  let totalBytes = 0;
  for (const [index, url] of urls.entries()) {
    const maxBytes = Math.min(
      COMPATIBLE_IMAGE_LIMITS.maxImageBytes,
      COMPATIBLE_IMAGE_LIMITS.maxTotalBytes - totalBytes
    );
    const bytes = await referenceBytes(url, organizationId, maxBytes);
    totalBytes += bytes.byteLength;
    const mimeType = sniffImageMimeType(bytes);
    if (!mimeType) throw new Error(REFERENCE_LIMIT_ERROR);
    const extension = mimeType.split('/')[1] ?? 'png';
    files.push(
      new File(
        [new Uint8Array(bytes)],
        'reference-' + index + '.' + extension,
        { type: mimeType }
      )
    );
  }
  return files;
}
