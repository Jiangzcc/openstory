import { mockCompatibleRequestUrl } from './compatible-image-test-fixtures';
import { expect, it, vi } from 'vitest';
import { generateCompatibleImages } from './compatible-image-client';
import {
  MOCK_IMAGE_BASE64,
  mockImageBytes,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

it.each(['png', 'jpeg', 'webp'] as const)(
  'reads actual %s bytes rather than response metadata',
  async (format) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockImageResponse({
        data: [{ b64_json: MOCK_IMAGE_BASE64[format] }],
        size: '1024x1024',
        output_format: 'png',
      })
    );
    const result = await generateCompatibleImages(
      mockImageInput({ parameters: { size: 'auto' } }),
      { fetch: fetchMock }
    );
    expect(result.images[0]).toMatchObject({
      width: 2,
      height: 3,
      mimeType: 'image/' + format,
      byteLength: mockImageBytes(format).length,
    });
    expect(result.images[0]?.dataUrl).toBe(
      'data:image/' + format + ';base64,' + MOCK_IMAGE_BASE64[format]
    );
    expect(result.mismatches).toHaveLength(0);
    expect(result.reported.size).toBe('1024x1024');
  }
);

it('accepts base64 output when the unused URL field is null', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    mockImageResponse({
      id: 'mock-generation',
      data: [{ b64_json: MOCK_IMAGE_BASE64.png, url: null }],
    })
  );
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: fetchMock,
  });
  expect(result).toMatchObject({
    actualCount: 1,
    status: 'complete',
    images: [{ width: 2, height: 3, mimeType: 'image/png' }],
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('treats null optional response metadata and usage as absent', async () => {
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: async () =>
      mockImageResponse({
        size: null,
        output_format: null,
        quality: null,
        background: null,
        usage: null,
      }),
  });
  expect(result.usage).toBeUndefined();
  expect(result.reported).toEqual({
    size: undefined,
    outputFormat: undefined,
    quality: undefined,
    background: undefined,
  });
  expect(result.status).toBe('complete');
});

it.each([
  { input_tokens_details: null, output_tokens_details: null },
  {
    input_tokens_details: { image_tokens: null, text_tokens: null },
    output_tokens_details: { image_tokens: null, text_tokens: null },
  },
])('does not invent counts from null usage fields: %j', async (details) => {
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: async () =>
      mockImageResponse({
        usage: {
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          ...details,
        },
      }),
  });
  expect(result.usage?.inputTokens).toBeUndefined();
  expect(result.usage?.outputTokens).toBeUndefined();
  expect(result.usage?.totalTokens).toBeUndefined();
  expect(result.usage?.inputTokensDetails?.imageTokens).toBeUndefined();
  expect(result.usage?.inputTokensDetails?.textTokens).toBeUndefined();
  expect(result.usage?.outputTokensDetails?.imageTokens).toBeUndefined();
  expect(result.usage?.outputTokensDetails?.textTokens).toBeUndefined();
});

it.each([
  { data: [{ b64_json: 123, url: null }] },
  { data: [{ b64_json: null, url: false }] },
  { size: 1024 },
  { output_format: 'gif' },
  { quality: false },
  { background: {} },
  { usage: 'unknown' },
  { usage: { input_tokens: '10' } },
  { usage: { output_tokens_details: { image_tokens: -1 } } },
])('still rejects invalid non-null optional fields: %j', async (response) => {
  await expect(
    generateCompatibleImages(mockImageInput(), {
      fetch: async () => mockImageResponse(response),
    })
  ).rejects.toMatchObject({ code: 'invalid_response' });
});

const mockFixedSpecificationMismatches = [
  {
    parameter: 'size',
    requested: '1024x1024',
    actual: '2x3',
    imageIndex: 0,
    basis: 'bytes',
  },
  {
    parameter: 'output_format',
    requested: 'jpeg',
    actual: 'png',
    imageIndex: 0,
    basis: 'bytes',
  },
  { parameter: 'quality', requested: 'high', actual: 'low', basis: 'reported' },
  {
    parameter: 'background',
    requested: 'transparent',
    actual: 'opaque',
    basis: 'reported',
  },
];

it('rejects fixed dimensions and format mismatches with actual byte evidence', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    mockImageResponse({
      size: '1024x1024',
      output_format: 'jpeg',
      quality: 'low',
      background: 'opaque',
    })
  );
  await expect(
    generateCompatibleImages(
      mockImageInput({
        parameters: {
          size: '1024x1024',
          output_format: 'jpeg',
          quality: 'high',
          background: 'transparent',
        },
      }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({
    code: 'response_mismatch',
    requestId: 'mock_req_123',
    submissionState: 'unknown',
    mismatches: mockFixedSpecificationMismatches,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('normalizes only numeric usage fields and does not invent missing usage', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    mockImageResponse({
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 20,
        input_tokens_details: { text_tokens: 3, image_tokens: 9 },
        output_tokens_details: { image_tokens: 8 },
        api_key: 'must-not-propagate',
      },
    })
  );
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: fetchMock,
  });
  expect(result.usage).toEqual({
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
    inputTokensDetails: { textTokens: 3, imageTokens: 9 },
    outputTokensDetails: { imageTokens: 8, textTokens: undefined },
  });
  expect(JSON.stringify(result)).not.toContain('must-not-propagate');
  const noUsage = await generateCompatibleImages(mockImageInput(), {
    fetch: async () => mockImageResponse(),
  });
  expect(noUsage.usage).toBeUndefined();
});

it('downloads URL images without forwarding API authorization and verifies actual bytes', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (mockCompatibleRequestUrl(url).endsWith('/images/generations'))
      return mockImageResponse({
        data: [
          {
            b64_json: null,
            url: 'https://mock-cdn.example.test/result?signature=mock',
          },
        ],
      });
    expect(mockCompatibleRequestUrl(url)).toBe(
      'https://mock-cdn.example.test/result?signature=mock'
    );
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(init?.redirect).toBe('manual');
    return new Response(mockImageBytes('jpeg'), {
      headers: { 'content-type': 'image/png' },
    });
  });
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: fetchMock,
  });
  expect(result.images[0]?.mimeType).toBe('image/jpeg');
  expect(result.images[0]?.dataUrl).toContain('data:image/jpeg;base64,');
  expect(JSON.stringify(result)).not.toContain('signature=mock');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('verifies data URLs returned in the URL field', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    mockImageResponse({
      data: [{ url: 'data:image/png;base64,' + MOCK_IMAGE_BASE64.jpeg }],
    })
  );
  const result = await generateCompatibleImages(mockImageInput(), {
    fetch: fetchMock,
  });
  expect(result.images[0]?.mimeType).toBe('image/jpeg');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  { data: [] },
  { data: [{}] },
  { data: [{ b64_json: null, url: null }] },
  { data: [{ b64_json: null }] },
  { data: [{ url: null }] },
  { data: [{ b64_json: 'not-base64' }] },
  { data: [{ b64_json: btoa('<svg xmlns="http://www.w3.org/2000/svg"/>') }] },
  { data: [{ b64_json: btoa('<html>error</html>') }] },
])(
  'rejects HTTP 200 without an actual accepted raster image: %j',
  async ({ data }) => {
    await expect(
      generateCompatibleImages(mockImageInput(), {
        fetch: async () => mockImageResponse({ data }),
      })
    ).rejects.toMatchObject({ submissionState: 'unknown' });
  }
);

it('rejects URL HTTP 200 containing HTML instead of image bytes', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    mockCompatibleRequestUrl(url).endsWith('/images/generations')
      ? mockImageResponse({
          data: [{ url: 'https://mock-cdn.example.test/fake.png' }],
        })
      : new Response('<html>upstream error</html>', {
          headers: { 'content-type': 'image/png' },
        })
  );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({ code: 'invalid_image' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  'file:///secret.png',
  'https://user:password@mock-cdn.example.test/a.png',
  'javascript:alert(1)',
  'https://mock-cdn.example.test/a.png#private',
])('rejects non-downloadable or authenticated URL %s', async (url) => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    mockImageResponse({ data: [{ url }] })
  );
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({ code: 'invalid_response' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects corrupt PNG contents and truncated JPEG or WebP images', async () => {
  const corrupted = mockImageBytes();
  corrupted[42] = (corrupted[42] ?? 0) ^ 1;
  for (const bytes of [
    corrupted,
    mockImageBytes('jpeg').slice(0, -2),
    mockImageBytes('webp').slice(0, -2),
  ]) {
    const b64_json = btoa(String.fromCharCode(...bytes));
    await expect(
      generateCompatibleImages(mockImageInput(), {
        fetch: async () => mockImageResponse({ data: [{ b64_json }] }),
      })
    ).rejects.toMatchObject({ code: 'invalid_image' });
  }
});

it('refuses a redirected image download and never forwards authorization to its destination', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (mockCompatibleRequestUrl(url).endsWith('/images/generations'))
      return mockImageResponse({
        data: [{ url: 'https://mock-cdn.example.test/output' }],
      });
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    return new Response(null, {
      status: 302,
      headers: { location: 'https://another.example.test/output' },
    });
  });
  await expect(
    generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
  ).rejects.toMatchObject({ code: 'download_failed', status: 302 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
