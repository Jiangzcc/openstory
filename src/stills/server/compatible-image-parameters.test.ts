import { mockCompatibleRequestUrl } from './compatible-image-test-fixtures';
import { expect, it, vi } from 'vitest';
import { generateCompatibleImages } from './compatible-image-client';
import { parseCompatibleImageParameters } from './compatible-image-parameters';
import {
  mockImageFile,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

it('passes validated model-specific scalar fields in the SDK JSON body', async () => {
  const parameters = {
    seed: 42,
    guidance_scale: 4.5,
    num_inference_steps: 20,
    negative_prompt: 'Mock excluded content',
    enhance_prompt: false,
  };
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(mockCompatibleRequestUrl(url), init);
    expect(await request.json()).toMatchObject(parameters);
    return mockImageResponse();
  });
  await generateCompatibleImages(mockImageInput({ parameters }), {
    fetch: fetchMock,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('passes validated model-specific scalar fields as SDK multipart entries', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const form = await new Request(
      mockCompatibleRequestUrl(url),
      init
    ).formData();
    expect(form.get('seed')).toBe('42');
    expect(form.get('guidance_scale')).toBe('4.5');
    expect(form.get('enhance_prompt')).toBe('false');
    return mockImageResponse();
  });
  await generateCompatibleImages(
    mockImageInput({
      operation: 'edit',
      references: [mockImageFile()],
      parameters: { seed: 42, guidance_scale: 4.5, enhance_prompt: false },
    }),
    { fetch: fetchMock }
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  'model',
  'prompt',
  'image',
  'images',
  'image_url',
  'mask',
  'headers',
  'auth',
  'authorization',
  'baseURL',
  'base_url',
  'api_key',
  'apikey',
  'stream',
  'streaming',
  '__proto__',
  'constructor',
  'prototype',
  'extra_body',
  'extra_headers',
  'request_options',
  'url',
  'user',
])('blocks reserved parameter key %s', (key) => {
  const parameters = Object.fromEntries([[key, 'injection']]);
  expect(() => parseCompatibleImageParameters(parameters)).toThrow(
    'Invalid compatible image request'
  );
});

it.each([
  { seed: Infinity },
  { seed: NaN },
  { extra: { value: 'nested' } },
  { extra: ['nested'] },
  { negative_prompt: 'x'.repeat(2049) },
  { 'unsafe-header': 'x' },
])(
  'blocks non-finite, oversized or non-scalar extensions: %j',
  (parameters) => {
    expect(() => parseCompatibleImageParameters(parameters)).toThrow(
      'Invalid compatible image request'
    );
  }
);
