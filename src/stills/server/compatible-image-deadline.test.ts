import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateCompatibleImages } from './compatible-image-client';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import {
  mockCompatibleRequestUrl,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

const MOCK_SLOW_RESPONSE_MS = 4 * 60 * 1000;
const MOCK_CANCEL_DELAY_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((timeoutMs) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(
        new DOMException('Mock request deadline', 'TimeoutError')
      );
    }, timeoutMs);
    return controller.signal;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Synthetic transports only; no supplier request or wallet write.
function delayedResponse(
  signal: AbortSignal | null | undefined,
  delayMs: number
) {
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(mockImageResponse());
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function safeFailure(request: ReturnType<typeof generateCompatibleImages>) {
  return request.then(
    () => undefined,
    (error: unknown) => error
  );
}

it('accepts a supplier that finishes after three minutes without resubmitting', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
    delayedResponse(init?.signal, MOCK_SLOW_RESPONSE_MS)
  );
  const outcome = safeFailure(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  );
  await vi.advanceTimersByTimeAsync(MOCK_SLOW_RESPONSE_MS);
  expect(await outcome).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('classifies the total request deadline as timeout before response headers', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
    delayedResponse(init?.signal, COMPATIBLE_IMAGE_LIMITS.timeoutMs + 1)
  );
  const failure = safeFailure(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  );
  await vi.advanceTimersByTimeAsync(COMPATIBLE_IMAGE_LIMITS.timeoutMs);
  expect(await failure).toMatchObject({
    code: 'request_timeout',
    status: undefined,
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('retains HTTP 200 when the deadline aborts a pending JSON body', async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => {
                controller.error(
                  new DOMException('Mock body interrupted', 'AbortError')
                );
              },
              { once: true }
            );
          },
        }),
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'mock_timeout_body',
          },
        }
      )
  );
  const failure = safeFailure(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  );
  await vi.advanceTimersByTimeAsync(COMPATIBLE_IMAGE_LIMITS.timeoutMs);
  expect(await failure).toMatchObject({
    code: 'request_timeout',
    status: 200,
    requestId: 'mock_timeout_body',
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('classifies the same deadline while downloading a generated image', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) =>
    mockCompatibleRequestUrl(input).endsWith('/images/generations')
      ? mockImageResponse({
          data: [{ url: 'https://mock-cdn.example.test/image.png' }],
        })
      : delayedResponse(init?.signal, COMPATIBLE_IMAGE_LIMITS.timeoutMs + 1)
  );
  const failure = safeFailure(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  );
  await vi.advanceTimersByTimeAsync(COMPATIBLE_IMAGE_LIMITS.timeoutMs);
  expect(await failure).toMatchObject({
    code: 'request_timeout',
    status: 200,
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps caller cancellation distinct from deadline expiry and strips its reason', async () => {
  const input = mockImageInput();
  const controller = new AbortController();
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
    delayedResponse(init?.signal, MOCK_SLOW_RESPONSE_MS)
  );
  const failure = safeFailure(
    generateCompatibleImages(input, {
      fetch: fetchMock,
      signal: controller.signal,
    })
  );
  await vi.advanceTimersByTimeAsync(MOCK_CANCEL_DELAY_MS);
  controller.abort(new Error(input.apiKey + ' ' + input.baseUrl));
  const error = await failure;
  expect(error).toMatchObject({
    code: 'request_aborted',
    submissionState: 'unknown',
  });
  const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
  expect(serialized).not.toContain(input.apiKey);
  expect(serialized).not.toContain(input.baseUrl);
  expect(error).not.toHaveProperty('cause');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
