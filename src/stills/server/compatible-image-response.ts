import { z } from 'zod';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import {
  compatibleImageDataUrl,
  decodeCompatibleImageBase64,
  inspectCompatibleImageBytes,
} from './compatible-image-bytes';
import { CompatibleImageError } from './compatible-image-error';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import { readCompatibleImageResponse } from './compatible-image-transport';
import type { CompatibleImageParameters } from './compatible-image-parameters';
import type {
  CompatibleImage,
  CompatibleImageMismatch,
  CompatibleImageResult,
  CompatibleImageUsage,
} from './compatible-image-types';

function optionalResponseField<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

const tokenCount = optionalResponseField(z.number().int().nonnegative().safe());
const tokenDetails = z.object({
  image_tokens: tokenCount,
  text_tokens: tokenCount,
});
const usageSchema = z.object({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  total_tokens: tokenCount,
  input_tokens_details: optionalResponseField(tokenDetails),
  output_tokens_details: optionalResponseField(tokenDetails),
});
const responseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: optionalResponseField(z.string()),
        url: optionalResponseField(z.string()),
      })
    )
    .min(1),
  size: optionalResponseField(z.string().max(24)),
  output_format: optionalResponseField(z.enum(['png', 'jpeg', 'webp'])),
  quality: optionalResponseField(
    z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'standard', 'hd'])
  ),
  background: optionalResponseField(z.enum(['transparent', 'opaque'])),
  usage: optionalResponseField(usageSchema),
});

type ProviderImage = z.infer<typeof responseSchema>['data'][number];
type ProviderUsage = z.infer<typeof usageSchema>;

interface ResponseOptions {
  fetch: typeof fetch;
  signal: AbortSignal;
  parameters: CompatibleImageParameters;
  requestId?: string;
}

export async function normalizeCompatibleImageResponse(
  value: unknown,
  options: ResponseOptions
): Promise<CompatibleImageResult> {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new CompatibleImageError('invalid_response');
  const response = parsed.data;
  const requestedCount = options.parameters.n ?? 1;
  const images = await readAcceptedImages(
    response.data.slice(0, requestedCount),
    options
  );
  const reported = {
    size: response.size,
    outputFormat: response.output_format,
    quality: response.quality,
    background: response.background,
  };
  const result: CompatibleImageResult = {
    images,
    requestedCount,
    actualCount: images.length,
    returnedCount: response.data.length,
    status: images.length < requestedCount ? 'partial' : 'complete',
    mismatches: imageMismatches(images, options.parameters),
    usage: response.usage ? normalizeUsage(response.usage) : undefined,
    requestId: options.requestId,
    reported,
  };
  addReportedMismatches(result, options.parameters);
  if (result.mismatches.some((mismatch) => mismatch.parameter !== 'n')) {
    throw new CompatibleImageError('response_mismatch', {
      requestId: options.requestId,
      mismatches: result.mismatches,
    });
  }
  return result;
}

async function readAcceptedImages(
  data: ProviderImage[],
  options: ResponseOptions
): Promise<CompatibleImage[]> {
  const images: CompatibleImage[] = [];
  let totalBytes = 0;
  for (const image of data) {
    const bytes = await readProviderImage(
      image,
      options,
      COMPATIBLE_IMAGE_LIMITS.maxTotalBytes - totalBytes
    );
    const metadata = inspectCompatibleImageBytes(bytes);
    totalBytes += bytes.byteLength;
    images.push({
      ...metadata,
      dataUrl: compatibleImageDataUrl(bytes, metadata.mimeType),
    });
  }
  return images;
}

async function readProviderImage(
  image: ProviderImage,
  options: ResponseOptions,
  remainingBytes: number
): Promise<Uint8Array> {
  const maxBytes = Math.min(
    remainingBytes,
    COMPATIBLE_IMAGE_LIMITS.maxImageBytes
  );
  if (image.b64_json !== undefined)
    return decodeCompatibleImageBase64(image.b64_json, maxBytes);
  if (image.url === undefined)
    throw new CompatibleImageError('invalid_response');
  if (image.url.startsWith('data:')) {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(image.url);
    if (!match?.[2]) throw new CompatibleImageError('invalid_image');
    return decodeCompatibleImageBase64(match[2], maxBytes);
  }
  const url = imageDownloadUrl(image.url);
  try {
    const response = await options.fetch(url, {
      signal: options.signal,
      redirect: 'manual',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CompatibleImageError('download_failed', {
        status: response.status,
      });
    }
    return await readCompatibleImageResponse(response, maxBytes);
  } catch (error) {
    if (isEngineAbortError(error)) throw error;
    if (error instanceof CompatibleImageError) throw error;
    throw new CompatibleImageError('download_failed');
  }
}

function imageDownloadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CompatibleImageError('invalid_response');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new CompatibleImageError('invalid_response');
  }
  return url;
}

function normalizeDetails(
  value: { image_tokens?: number; text_tokens?: number } | undefined
) {
  return value
    ? { imageTokens: value.image_tokens, textTokens: value.text_tokens }
    : undefined;
}

function normalizeUsage(usage: ProviderUsage): CompatibleImageUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    inputTokensDetails: normalizeDetails(usage.input_tokens_details),
    outputTokensDetails: normalizeDetails(usage.output_tokens_details),
  };
}

function imageMismatches(
  images: CompatibleImage[],
  parameters: CompatibleImageParameters
): CompatibleImageMismatch[] {
  const mismatches: CompatibleImageMismatch[] = [];
  images.forEach((image, imageIndex) => {
    const actualSize = image.width + 'x' + image.height;
    if (
      parameters.size &&
      parameters.size !== 'auto' &&
      actualSize !== parameters.size
    ) {
      mismatches.push({
        parameter: 'size',
        requested: parameters.size,
        actual: actualSize,
        imageIndex,
        basis: 'bytes',
      });
    }
    const actualFormat = image.mimeType.slice('image/'.length);
    if (parameters.output_format && parameters.output_format !== actualFormat) {
      mismatches.push({
        parameter: 'output_format',
        requested: parameters.output_format,
        actual: actualFormat,
        imageIndex,
        basis: 'bytes',
      });
    }
  });
  return mismatches;
}

function addReportedMismatches(
  result: CompatibleImageResult,
  parameters: CompatibleImageParameters
): void {
  if (result.requestedCount !== result.returnedCount) {
    result.mismatches.push({
      parameter: 'n',
      requested: result.requestedCount,
      actual: result.returnedCount,
      basis: 'count',
    });
  }
  for (const parameter of ['quality', 'background'] as const) {
    const requested = parameters[parameter];
    const actual = result.reported[parameter];
    if (requested && requested !== 'auto' && actual && requested !== actual) {
      result.mismatches.push({
        parameter,
        requested,
        actual,
        basis: 'reported',
      });
    }
  }
}
