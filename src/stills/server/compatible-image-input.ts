import { z } from 'zod';
import { inspectCompatibleImageBytes } from './compatible-image-bytes';
import { CompatibleImageError } from './compatible-image-error';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import type { CompatibleImageInput } from './compatible-image-types';

const inputSchema = z.object({
  baseUrl: z.string().min(1).max(2048),
  apiKey: z.string().min(1).max(4096).regex(/^\S+$/),
  upstreamModel: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\r\n]+$/),
  operation: z.enum(['generate', 'edit']),
  prompt: z.string().trim().min(1).max(COMPATIBLE_IMAGE_LIMITS.maxPromptLength),
  references: z
    .array(z.instanceof(File))
    .max(COMPATIBLE_IMAGE_LIMITS.maxReferences),
  mask: z.instanceof(File).optional(),
  parameters: z.unknown().optional(),
});

export function validateCompatibleImageInput(
  input: CompatibleImageInput
): string {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  if (
    input.operation === 'generate' &&
    (input.references.length > 0 || input.mask)
  )
    invalidInput();
  if (input.operation === 'edit' && input.references.length === 0)
    invalidInput();
  return normalizeBaseUrl(input.baseUrl);
}

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return invalidInput();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalidInput();
  return url.href.replace(/\/+$/, '');
}

function invalidInput(): never {
  throw new CompatibleImageError('invalid_input', {
    submissionState: 'not_submitted',
  });
}

export async function validateCompatibleImageUploads(
  input: CompatibleImageInput
): Promise<void> {
  const files = [...input.references, ...(input.mask ? [input.mask] : [])];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > COMPATIBLE_IMAGE_LIMITS.maxTotalBytes) {
    throw new CompatibleImageError('resource_limit', {
      submissionState: 'not_submitted',
    });
  }
  let first: { width: number; height: number } | undefined;
  for (const file of files) {
    if (file.size > COMPATIBLE_IMAGE_LIMITS.maxImageBytes)
      throw new CompatibleImageError('resource_limit', {
        submissionState: 'not_submitted',
      });
    const metadata = await inspectUpload(file);
    first ??= metadata;
    if (
      file === input.mask &&
      (file.size >= COMPATIBLE_IMAGE_LIMITS.maxMaskBytes ||
        metadata.mimeType !== 'image/png' ||
        metadata.width !== first.width ||
        metadata.height !== first.height)
    )
      invalidInput();
  }
}

async function inspectUpload(file: File) {
  try {
    const metadata = inspectCompatibleImageBytes(
      new Uint8Array(await file.arrayBuffer())
    );
    if (file.type && file.type !== metadata.mimeType) invalidInput();
    return metadata;
  } catch (error) {
    const code =
      error instanceof CompatibleImageError ? error.code : 'invalid_input';
    throw new CompatibleImageError(code, { submissionState: 'not_submitted' });
  }
}
