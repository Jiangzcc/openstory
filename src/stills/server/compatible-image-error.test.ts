import { afterEach, expect, it, vi } from 'vitest';
import { generateCompatibleImages } from './compatible-image-client';
import {
  CompatibleImageError,
  sanitizeCompatibleImageError,
} from './compatible-image-error';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import {
  mockCompatibleRequestUrl,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([400, 401, 429, 500, 503])(
  'does not retry HTTP %s and strips the SDK error body and endpoint',
  async (status) => {
    const input = mockImageInput();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            message: 'Bearer ' + input.apiKey + ' endpoint ' + input.baseUrl,
          },
        },
        { status, headers: { 'x-request-id': 'mock_error_req' } }
      )
    );
    const error = await generateCompatibleImages(input, {
      fetch: fetchMock,
    }).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      name: 'CompatibleImageError',
      code: 'request_failed',
      status,
      requestId: 'mock_error_req',
      submissionState: status >= 500 ? 'unknown' : 'rejected',
    });
    expect(error).toBeInstanceOf(Error);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(serialized).not.toContain(input.apiKey);
    expect(serialized).not.toContain(input.baseUrl);
    expect(serialized).not.toContain('Bearer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);

it('does not retry or leak a failed connection error cause', async () => {
  const input = mockImageInput();
  const fetchMock = vi.fn<typeof fetch>(async () => {
    throw new Error(input.baseUrl + ' ' + input.apiKey);
  });
  const error = await generateCompatibleImages(input, {
    fetch: fetchMock,
  }).then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toMatchObject({
    code: 'request_failed',
    status: undefined,
    submissionState: 'unknown',
  });
  expect(error).not.toHaveProperty('cause');
  expect(String(error)).not.toContain(input.apiKey);
  expect(String(error)).not.toContain(input.baseUrl);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('disables SDK logs even when environment debugging is enabled', async () => {
  vi.stubEnv('OPENAI_LOG', 'debug');
  const spies = [
    vi.spyOn(console, 'debug'),
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
  ];
  for (const spy of spies) spy.mockImplementation(() => undefined);
  await generateCompatibleImages(mockImageInput(), {
    fetch: async () => mockImageResponse(),
  });
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it.each([
  'sk-not-a-request-id',
  'Bearer_private',
  'https://private.example.test',
  'bad request id',
  'mock-platform-credential',
  'prefix_mock-platform-credential_suffix',
])('drops unsafe request id %s', async (requestId) => {
  const response = mockImageResponse();
  response.headers.set('x-request-id', requestId);
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: async () => response,
  });
  expect(result.requestId).toBeUndefined();
});

it('keeps only a safe request id after HTTP 200 JSON parsing or validation fails', async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response('{invalid', {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'mock_invalid_json',
        },
      })
  );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({
    code: 'invalid_response',
    requestId: 'mock_invalid_json',
    status: 200,
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('marks post-submission cancellation as unknown without resending', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn<typeof fetch>(async () => {
    controller.abort();
    throw new DOMException('Mock cancelled', 'AbortError');
  });
  await expect(
    generateCompatibleImages(mockImageInput(), {
      fetch: fetchMock,
      signal: controller.signal,
    })
  ).rejects.toMatchObject({
    code: 'request_aborted',
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  'https://user:password@private.example.test/v1',
  'file:///images',
  'https://private.example.test/v1?api_key=secret',
])('does not expose an invalid configured endpoint', async (baseUrl) => {
  const fetchMock = vi.fn<typeof fetch>();
  const error = await generateCompatibleImages(mockImageInput({ baseUrl }), {
    fetch: fetchMock,
  }).then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toMatchObject({
    code: 'invalid_input',
    submissionState: 'not_submitted',
  });
  expect(String(error)).not.toContain(baseUrl);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('refuses redirects without forwarding the platform key or submitting again', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.redirect).toBe('manual');
    return new Response(null, {
      status: 302,
      headers: { location: 'https://untrusted.example.test' },
    });
  });
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({ code: 'request_failed', status: 302 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// Synthetic responses and injected transport only; never contact a provider.
const MOCK_RAW_RESPONSE =
  'mock_raw_response Bearer mock-platform-credential https://mock-images.example.test/v1';

function expectSafeFailure(error: unknown): void {
  expect(error).toBeInstanceOf(CompatibleImageError);
  if (!(error instanceof Error)) throw new Error('Expected a sanitized error');
  const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
  expect(serialized).not.toContain('mock-platform-credential');
  expect(serialized).not.toContain('https://mock-images.example.test/v1');
  expect(serialized).not.toContain('mock_raw_response');
  expect(error).not.toHaveProperty('cause');
  expect(error).not.toHaveProperty('headers');
  expect(error).not.toHaveProperty('body');
}

it.each([
  [
    'JSON parsing',
    'invalid_response',
    () =>
      new Response('{' + MOCK_RAW_RESPONSE, {
        headers: { 'content-type': 'application/json' },
      }),
  ],
  [
    'schema validation',
    'invalid_response',
    () => Response.json({ data: MOCK_RAW_RESPONSE }),
  ],
  [
    'missing image payload',
    'invalid_response',
    () => mockImageResponse({ data: [{}] }),
  ],
  [
    'image URL validation',
    'invalid_response',
    () =>
      mockImageResponse({
        data: [
          {
            url: 'https://mock-platform-credential@mock-images.example.test/v1',
          },
        ],
      }),
  ],
  [
    'image byte validation',
    'invalid_image',
    () => mockImageResponse({ data: [{ b64_json: 'YWFh' }] }),
  ],
  ['fixed output mismatch', 'response_mismatch', () => mockImageResponse()],
  [
    'body read failure',
    'invalid_response',
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError(MOCK_RAW_RESPONSE));
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      ),
  ],
] as const)(
  'retains HTTP 200 after %s without leaking response details',
  async (_, code, response) => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const result = response();
      result.headers.set('x-request-id', 'mock_after_headers');
      return result;
    });
    const error: unknown = await generateCompatibleImages(
      mockImageInput({ parameters: { output_format: 'jpeg' } }),
      { fetch: fetchMock }
    ).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code,
      status: 200,
      requestId: 'mock_after_headers',
      submissionState: 'unknown',
    });
    expectSafeFailure(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);

it('retains a response status when the transport rejects its advertised size', async () => {
  const response = mockImageResponse();
  response.headers.set(
    'content-length',
    String(COMPATIBLE_IMAGE_LIMITS.maxJsonBytes + 1)
  );
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({
    code: 'resource_limit',
    status: 200,
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps a download HTTP failure instead of replacing it with generation HTTP 200', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    mockCompatibleRequestUrl(input).endsWith('/images/generations')
      ? mockImageResponse({
          data: [{ url: 'https://mock-cdn.example.test/image.png' }],
        })
      : new Response(null, { status: 404 })
  );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({
    code: 'download_failed',
    status: 404,
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not invent a response status for a timeout before headers', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    throw new DOMException('mock connection timed out', 'AbortError');
  });
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({
    code: 'request_timeout',
    status: undefined,
    submissionState: 'unknown',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('uses an observed status for a sanitized post-response error and preserves its own status', () => {
  expect(
    sanitizeCompatibleImageError(
      new CompatibleImageError('invalid_response'),
      'mock-platform-credential',
      undefined,
      200
    )
  ).toMatchObject({ code: 'invalid_response', status: 200 });
  expect(
    sanitizeCompatibleImageError(
      new CompatibleImageError('download_failed', { status: 502 }),
      'mock-platform-credential',
      undefined,
      200
    )
  ).toMatchObject({ code: 'download_failed', status: 502 });
});
