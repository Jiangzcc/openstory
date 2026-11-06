import OpenAI from 'openai';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import { workersSafeFetch } from '@/platform/server/ai/workers-safe-fetch';
import {
  CompatibleImageError,
  safeCompatibleImageRequestId,
  sanitizeCompatibleImageError,
} from './compatible-image-error';
import {
  validateCompatibleImageInput,
  validateCompatibleImageUploads,
} from './compatible-image-input';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import {
  compatibleEditParameters,
  compatibleGenerateParameters,
  parseCompatibleImageParameters,
} from './compatible-image-parameters';
import { normalizeCompatibleImageResponse } from './compatible-image-response';
import { limitCompatibleImageResponse } from './compatible-image-transport';
import type { CompatibleImageParameters } from './compatible-image-parameters';
import type {
  CompatibleImageInput,
  CompatibleImageOptions,
  CompatibleImageResult,
} from './compatible-image-types';

export type {
  CompatibleImageInput,
  CompatibleImageOptions,
  CompatibleImageResult,
} from './compatible-image-types';

interface RequestContext {
  submitted: boolean;
  responseStatus?: number;
  requestId?: string;
  transportError?: unknown;
}

export async function generateCompatibleImages(
  input: CompatibleImageInput,
  options: CompatibleImageOptions = {}
): Promise<CompatibleImageResult> {
  const baseURL = validateCompatibleImageInput(input);
  const parameters = parseCompatibleImageParameters(input.parameters);
  const request = buildRequest(input, parameters);
  await validateCompatibleImageUploads(input);
  if (options.signal?.aborted)
    throw new CompatibleImageError(requestAbortCode(options.signal), {
      submissionState: 'not_submitted',
    });
  const signal = requestSignal(options.signal);
  const fetchImpl = options.fetch ?? workersSafeFetch;
  const context: RequestContext = { submitted: false };
  try {
    const client = createClient(
      input.apiKey,
      baseURL,
      boundedFetch(fetchImpl, context, input.apiKey)
    );
    const response =
      request.operation === 'generate'
        ? await client.images
            .generate(request.body, { maxRetries: 0, signal })
            .withResponse()
        : await client.images
            .edit(request.body, { maxRetries: 0, signal })
            .withResponse();
    return await normalizeCompatibleImageResponse(response.data, {
      fetch: fetchImpl,
      signal,
      parameters,
      requestId: context.requestId,
    });
  } catch (error) {
    const sanitized = sanitizeCompatibleImageError(
      requestFailure(error, context, signal),
      input.apiKey,
      context.requestId,
      context.responseStatus
    );
    if (!context.submitted)
      throw new CompatibleImageError(sanitized.code, {
        submissionState: 'not_submitted',
      });
    throw sanitized;
  }
}

function requestAbortCode(signal: AbortSignal): CompatibleImageError['code'] {
  return signal.reason instanceof DOMException &&
    signal.reason.name === 'TimeoutError'
    ? 'request_timeout'
    : 'request_aborted';
}

function requestFailure(
  error: unknown,
  context: RequestContext,
  signal: AbortSignal
): unknown {
  const cause = context.transportError ?? error;
  if (!(cause instanceof OpenAI.APIError) && isEngineAbortError(cause))
    throw cause;
  if (signal.aborted) return new CompatibleImageError(requestAbortCode(signal));
  return cause;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(COMPATIBLE_IMAGE_LIMITS.timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function createClient(
  apiKey: string,
  baseURL: string,
  fetch: typeof workersSafeFetch
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL,
    fetch,
    maxRetries: 0,
    timeout: COMPATIBLE_IMAGE_LIMITS.timeoutMs,
    logLevel: 'off',
  });
}

function buildRequest(
  input: CompatibleImageInput,
  parameters: CompatibleImageParameters
) {
  if (input.operation === 'generate')
    return {
      operation: 'generate' as const,
      body: compatibleGenerateParameters(input, parameters),
    };
  return {
    operation: 'edit' as const,
    body: compatibleEditParameters(input, parameters),
  };
}

function boundedFetch(
  fetchImpl: typeof fetch,
  context: RequestContext,
  apiKey: string
): typeof fetch {
  const bounded: typeof fetch = async (input, init) => {
    context.submitted = true;
    try {
      const response = await fetchImpl(input, { ...init, redirect: 'manual' });
      context.responseStatus = response.status;
      context.requestId = safeCompatibleImageRequestId(
        response.headers.get('x-request-id'),
        apiKey
      );
      return await limitCompatibleImageResponse(
        response,
        COMPATIBLE_IMAGE_LIMITS.maxJsonBytes
      );
    } catch (error) {
      if (error instanceof CompatibleImageError || isEngineAbortError(error))
        context.transportError = error;
      throw error;
    }
  };
  // The SDK uses this constructor instead of probing custom fetch with data:,.
  return Object.assign(bounded, { Response });
}
