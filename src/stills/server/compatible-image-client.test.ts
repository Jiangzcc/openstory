import { mockCompatibleRequestUrl } from './compatible-image-test-fixtures';
import { expect, it, vi } from 'vitest';
import { generateCompatibleImages } from './compatible-image-client';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import {
  MOCK_IMAGE_BASE64,
  MOCK_DIFFERENT_DIMENSIONS_PNG,
  mockImageFile,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

it('sends the official SDK generation request as JSON with allowed scalar parameters', async () => {
  const parameters = {
    n: 1,
    size: 'auto',
    quality: 'high',
    background: 'opaque',
    output_format: 'png',
    output_compression: 80,
    response_format: 'b64_json',
    moderation: 'low',
    style: 'natural',
  } as const;
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    expect(mockCompatibleRequestUrl(url)).toBe(
      'https://mock-images.example.test/v1/images/generations'
    );
    const request = new Request(mockCompatibleRequestUrl(url), init);
    expect(request.headers.get('authorization')).toBe(
      'Bearer mock-platform-credential'
    );
    expect(request.headers.get('content-type')).toContain('application/json');
    expect(init?.redirect).toBe('manual');
    expect(await request.json()).toEqual({
      ...parameters,
      model: 'mock-image-model',
      prompt: 'Mock fixture image',
      stream: false,
    });
    return mockImageResponse();
  });
  const result = await generateCompatibleImages(
    mockImageInput({ parameters }),
    { fetch: fetchMock }
  );
  expect(result.images[0]).toMatchObject({
    width: 2,
    height: 3,
    mimeType: 'image/png',
    byteLength: 95,
  });
  expect(result.requestId).toBe('mock_req_123');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('serializes one edit image as image and sends the actual PNG mask', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    expect(mockCompatibleRequestUrl(url).endsWith('/images/edits')).toBe(true);
    const request = new Request(mockCompatibleRequestUrl(url), init);
    expect(request.headers.get('content-type')).toContain(
      'multipart/form-data'
    );
    const form = await request.formData();
    expect(form.getAll('image[]')).toHaveLength(0);
    expect(form.get('image')).toBeInstanceOf(File);
    const image = form.get('image');
    const mask = form.get('mask');
    if (!(image instanceof File) || !(mask instanceof File))
      throw new Error('Missing mock uploads');
    expect(image.name).toBe('first.png');
    expect(await image.arrayBuffer()).toEqual(
      await mockImageFile().arrayBuffer()
    );
    expect(mask.name).toBe('mask.png');
    expect(form.get('input_fidelity')).toBe('high');
    expect(form.get('n')).toBe('1');
    expect(form.get('quality')).toBe('low');
    return mockImageResponse();
  });
  const result = await generateCompatibleImages(
    mockImageInput({
      operation: 'edit',
      references: [mockImageFile('first.png')],
      mask: mockImageFile('mask.png'),
      parameters: { input_fidelity: 'high', n: 1, quality: 'low' },
    }),
    { fetch: fetchMock }
  );
  expect(result.status).toBe('complete');
});

it('serializes multiple edit images as repeated ordered image[] fields', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const form = await new Request(
      'https://mock-images.example.test',
      init
    ).formData();
    expect(form.getAll('image')).toHaveLength(0);
    const images = form.getAll('image[]');
    expect(images).toHaveLength(2);
    expect(
      images.map((value) => (value instanceof File ? value.name : ''))
    ).toEqual(['first.png', 'second.jpeg']);
    const second = images[1];
    if (!(second instanceof File)) throw new Error('Missing second mock image');
    expect(second.type).toBe('image/jpeg');
    expect(
      btoa(String.fromCharCode(...new Uint8Array(await second.arrayBuffer())))
    ).toBe(MOCK_IMAGE_BASE64.jpeg);
    return mockImageResponse();
  });
  await generateCompatibleImages(
    mockImageInput({
      operation: 'edit',
      references: [
        mockImageFile('first.png'),
        mockImageFile('second.jpeg', 'jpeg'),
      ],
    }),
    { fetch: fetchMock }
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('returns partial actual count without replenishing a short response', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => mockImageResponse());
  const result = await generateCompatibleImages(
    mockImageInput({ parameters: { n: 2 } }),
    { fetch: fetchMock }
  );
  expect(result).toMatchObject({
    requestedCount: 2,
    actualCount: 1,
    returnedCount: 1,
    status: 'partial',
  });
  expect(result.mismatches).toContainEqual({
    parameter: 'n',
    requested: 2,
    actual: 1,
    basis: 'count',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('ignores excess response images so accepted count cannot exceed n', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    mockImageResponse({
      data: [
        { b64_json: MOCK_IMAGE_BASE64.png },
        { url: 'https://must-not-fetch.example.test/extra.png' },
      ],
    })
  );
  const result = await generateCompatibleImages(
    mockImageInput({ parameters: { n: 1 } }),
    { fetch: fetchMock }
  );
  expect(result).toMatchObject({
    actualCount: 1,
    returnedCount: 2,
    status: 'complete',
  });
  expect(result.images).toHaveLength(1);
  expect(result.mismatches).toContainEqual({
    parameter: 'n',
    requested: 1,
    actual: 2,
    basis: 'count',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects absent edit references before invoking the provider', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  await expect(
    generateCompatibleImages(mockImageInput({ operation: 'edit' }), {
      fetch: fetchMock,
    })
  ).rejects.toMatchObject({
    code: 'invalid_input',
    submissionState: 'not_submitted',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects references and masks on a generation request', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  await expect(
    generateCompatibleImages(
      mockImageInput({ references: [mockImageFile()] }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(
    generateCompatibleImages(mockImageInput({ mask: mockImageFile() }), {
      fetch: fetchMock,
    })
  ).rejects.toMatchObject({ code: 'invalid_input' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a JPEG mask and a forged reference MIME before spending', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  const input = mockImageInput({
    operation: 'edit',
    references: [mockImageFile()],
    mask: mockImageFile('mask.jpeg', 'jpeg'),
  });
  await expect(
    generateCompatibleImages(input, { fetch: fetchMock })
  ).rejects.toMatchObject({
    code: 'invalid_input',
    submissionState: 'not_submitted',
  });
  const forged = new File([new Uint8Array([1, 2, 3])], 'fake.png', {
    type: 'image/png',
  });
  await expect(
    generateCompatibleImages(
      { ...input, references: [forged], mask: undefined },
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({
    code: 'invalid_image',
    submissionState: 'not_submitted',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([0, -1, 1.5, NaN, Infinity, COMPATIBLE_IMAGE_LIMITS.maxImages + 1])(
  'rejects invalid n=%s before spending',
  async (n) => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      generateCompatibleImages(mockImageInput({ parameters: { n } }), {
        fetch: fetchMock,
      })
    ).rejects.toMatchObject({
      code: 'invalid_input',
      submissionState: 'not_submitted',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  }
);

it('rejects operation-incompatible standard SDK parameters before spending', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  await expect(
    generateCompatibleImages(
      mockImageInput({ parameters: { input_fidelity: 'high' } }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(
    generateCompatibleImages(
      mockImageInput({
        operation: 'edit',
        references: [mockImageFile()],
        parameters: { moderation: 'low' },
      }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({ code: 'invalid_input' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not send a pre-aborted request', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  await expect(
    generateCompatibleImages(mockImageInput(), {
      fetch: fetchMock,
      signal: AbortSignal.abort(),
    })
  ).rejects.toMatchObject({
    code: 'request_aborted',
    submissionState: 'not_submitted',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a mask whose actual dimensions differ from the first reference', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  const mask = new File(
    [
      Uint8Array.from(atob(MOCK_DIFFERENT_DIMENSIONS_PNG), (char) =>
        char.charCodeAt(0)
      ),
    ],
    'mask.png',
    { type: 'image/png' }
  );
  await expect(
    generateCompatibleImages(
      mockImageInput({
        operation: 'edit',
        references: [mockImageFile()],
        mask,
      }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({
    code: 'invalid_input',
    submissionState: 'not_submitted',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('accepts the configured platform count ceiling without imposing an SDK-documentation model limit', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    expect(
      await new Request(mockCompatibleRequestUrl(url), init).json()
    ).toMatchObject({
      n: COMPATIBLE_IMAGE_LIMITS.maxImages,
    });
    return mockImageResponse();
  });
  const result = await generateCompatibleImages(
    mockImageInput({ parameters: { n: COMPATIBLE_IMAGE_LIMITS.maxImages } }),
    { fetch: fetchMock }
  );
  expect(result).toMatchObject({
    status: 'partial',
    actualCount: 1,
    requestedCount: COMPATIBLE_IMAGE_LIMITS.maxImages,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects too many reference files before submitting', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  const references = Array.from(
    { length: COMPATIBLE_IMAGE_LIMITS.maxReferences + 1 },
    () => mockImageFile()
  );
  await expect(
    generateCompatibleImages(
      mockImageInput({ operation: 'edit', references }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({
    code: 'invalid_input',
    submissionState: 'not_submitted',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uses the Workers-safe global fetch binding when no fetch is injected', async () => {
  const fetchMock = vi.fn(function (this: unknown) {
    expect(this).toBe(globalThis);
    return Promise.resolve(mockImageResponse());
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const result = await generateCompatibleImages(mockImageInput());
    expect(result.actualCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('refuses an impossible fixed output size without submitting to the supplier', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => mockImageResponse());
  await expect(
    generateCompatibleImages(
      mockImageInput({ parameters: { size: '4096x4096' } }),
      { fetch: fetchMock }
    )
  ).rejects.toMatchObject({
    code: 'resource_limit',
    submissionState: 'not_submitted',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
