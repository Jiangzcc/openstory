import type { CompatibleImageMismatch } from './compatible-image-types';
import { APIError, APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import {
  COMPATIBLE_IMAGE_HTTP,
  COMPATIBLE_IMAGE_LIMITS,
} from './compatible-image-limits';

const ERROR_MESSAGES = {
  invalid_input: 'Invalid compatible image request.',
  request_failed: 'Compatible image provider request failed.',
  request_timeout: 'Compatible image provider request timed out.',
  request_aborted: 'Compatible image request was aborted.',
  invalid_response: 'Compatible image provider returned an invalid response.',
  response_mismatch:
    'Compatible image output does not match the requested specification.',
  invalid_image: 'Compatible image data is not a supported image.',
  resource_limit: 'Compatible image resource limit exceeded.',
  download_failed: 'Compatible image download failed.',
} as const;

export type CompatibleImageErrorCode = keyof typeof ERROR_MESSAGES;
export type CompatibleImageSubmissionState =
  | 'not_submitted'
  | 'rejected'
  | 'unknown';

export class CompatibleImageError extends Error {
  override readonly name = 'CompatibleImageError';
  readonly code: CompatibleImageErrorCode;
  readonly submissionState: CompatibleImageSubmissionState;
  readonly status?: number;
  readonly requestId?: string;
  readonly mismatches?: CompatibleImageMismatch[];

  constructor(
    code: CompatibleImageErrorCode,
    options: {
      submissionState?: CompatibleImageSubmissionState;
      status?: number;
      requestId?: string;
      mismatches?: CompatibleImageMismatch[];
    } = {}
  ) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
    this.submissionState = options.submissionState ?? 'unknown';
    this.status = options.status;
    this.requestId = options.requestId;
    this.mismatches = options.mismatches;
  }
}

export function safeCompatibleImageRequestId(
  value: unknown,
  apiKey: string
): string | undefined {
  if (typeof value !== 'string' || value.includes(apiKey)) return undefined;
  if (value.length > COMPATIBLE_IMAGE_LIMITS.maxRequestIdLength)
    return undefined;
  if (!/^[a-zA-Z0-9_-]+$/.test(value) || /sk-|bearer/i.test(value))
    return undefined;
  return value;
}

function responseStatusForError(error: unknown, responseStatus?: number) {
  if (error instanceof CompatibleImageError || error instanceof APIError)
    return error.status ?? responseStatus;
  return responseStatus;
}

export function sanitizeCompatibleImageError(
  error: unknown,
  apiKey: string,
  requestId?: string,
  responseStatus?: number
): CompatibleImageError {
  const status = responseStatusForError(error, responseStatus);
  if (error instanceof CompatibleImageError)
    return new CompatibleImageError(error.code, {
      submissionState: error.submissionState,
      status,
      mismatches: error.mismatches,
      requestId:
        safeCompatibleImageRequestId(error.requestId, apiKey) ?? requestId,
    });
  if (error instanceof APIConnectionTimeoutError)
    return new CompatibleImageError('request_timeout', {
      requestId,
      status,
    });
  if (error instanceof APIUserAbortError)
    return new CompatibleImageError('request_aborted', {
      requestId,
      status,
    });
  if (!(error instanceof APIError))
    return new CompatibleImageError('invalid_response', {
      requestId,
      status,
    });
  const rejected =
    status !== undefined &&
    status >= COMPATIBLE_IMAGE_HTTP.badRequest &&
    status < COMPATIBLE_IMAGE_HTTP.serverError;
  return new CompatibleImageError('request_failed', {
    status,
    requestId:
      safeCompatibleImageRequestId(error.requestID, apiKey) ?? requestId,
    submissionState: rejected ? 'rejected' : 'unknown',
  });
}
