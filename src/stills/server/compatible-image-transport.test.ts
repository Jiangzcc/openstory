import { mockCompatibleRequestUrl } from './compatible-image-test-fixtures';
import { expect, it, vi } from 'vitest';

// Mock reduced budgets exercise aggregate limits without allocating production-sized blobs.
vi.mock('./compatible-image-limits', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./compatible-image-limits')>();
  return {
    ...actual,
    COMPATIBLE_IMAGE_LIMITS: {
      ...actual.COMPATIBLE_IMAGE_LIMITS,
      maxImageBytes: 750,
      maxTotalBytes: 800,
      maxJsonBytes: 4096,
    },
  };
});

import { generateCompatibleImages } from './compatible-image-client';
import { decodeCompatibleImageBase64 } from './compatible-image-bytes';
import { normalizeCompatibleImageResponse } from './compatible-image-response';
import {
  limitCompatibleImageResponse,
  readCompatibleImageResponse,
} from './compatible-image-transport';
import {
  MOCK_IMAGE_BASE64,
  mockImageBytes,
  mockImageFile,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

it('rejects an advertised over-limit API body without reading or retrying it', async () => {
  const cancel = vi.fn();
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: {
          'content-length': '4097',
          'content-type': 'application/json',
        },
      })
  );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({
    code: 'resource_limit',
    submissionState: 'unknown',
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('caps bytes while reading streams that omit or understate content length', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    }),
    { headers: { 'content-length': '1' } }
  );
  await expect(readCompatibleImageResponse(response, 8)).rejects.toMatchObject({
    code: 'resource_limit',
  });
});

it('allows bounded responses and preserves safe headers', async () => {
  const response = await limitCompatibleImageResponse(
    new Response(mockImageBytes(), { headers: { 'x-request-id': 'mock_req' } }),
    100
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    mockImageBytes()
  );
  expect(response.headers.get('x-request-id')).toBe('mock_req');
});

it('limits base64 bytes before allocating oversized decoded images', () => {
  expect(() => decodeCompatibleImageBase64('A'.repeat(1004))).toThrow(
    'resource limit'
  );
  expect(() => decodeCompatibleImageBase64('YWFh', 2)).toThrow(
    'resource limit'
  );
});

it('enforces total returned-image bytes rather than only a per-image limit', async () => {
  await expect(
    normalizeCompatibleImageResponse(
      {
        data: [
          { b64_json: MOCK_IMAGE_BASE64.png },
          { b64_json: MOCK_IMAGE_BASE64.jpeg },
        ],
      },
      {
        fetch: vi.fn<typeof fetch>(),
        signal: AbortSignal.timeout(1000),
        parameters: { n: 2 },
      }
    )
  ).rejects.toMatchObject({ code: 'resource_limit' });
});

it('enforces the download limit without an extra inference call', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    mockCompatibleRequestUrl(url).endsWith('/images/generations')
      ? mockImageResponse({
          data: [{ url: 'https://mock-cdn.example.test/large.png' }],
        })
      : new Response('not read', { headers: { 'content-length': '751' } })
  );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({ code: 'resource_limit' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('rejects oversized reference files and total uploads before making an API call', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  const oversized = new File([new Uint8Array(751)], 'large.png', {
    type: 'image/png',
  });
  const single = mockImageInput({ operation: 'edit', references: [oversized] });
  const aggregate = mockImageInput({
    operation: 'edit',
    references: [
      mockImageFile('first.jpeg', 'jpeg'),
      mockImageFile('second.jpeg', 'jpeg'),
    ],
  });
  for (const input of [single, aggregate]) {
    await expect(
      generateCompatibleImages(input, { fetch: fetchMock })
    ).rejects.toMatchObject({
      code: 'resource_limit',
      submissionState: 'not_submitted',
    });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
