import { expect, it, vi } from 'vitest';
import { generateCompatibleImages } from './compatible-image-client';
import {
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

const ENGINE_ABORT_MESSAGE = 'Aborting engine: Grace period complete';

// Synthetic transports only; no supplier requests or wallet writes.
it('preserves an engine interruption wrapped by the SDK transport', async () => {
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(interruption);
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toBe(interruption);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('preserves an engine interruption while reading the generation body', async () => {
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(interruption);
    },
  });
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(body, { headers: { 'content-type': 'application/json' } })
    );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toBe(interruption);
});

it('preserves an engine interruption downloading the generated image', async () => {
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      mockImageResponse({ data: [{ url: 'https://example.com/mock.png' }] })
    )
    .mockRejectedValueOnce(interruption);
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toBe(interruption);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not treat provider error wording as a local engine interruption', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { message: ENGINE_ABORT_MESSAGE } },
        { status: 500 }
      )
    );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({
    name: 'CompatibleImageError',
    code: 'request_failed',
  });
});
