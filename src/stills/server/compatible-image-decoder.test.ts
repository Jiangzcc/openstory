import { beforeEach, expect, it, vi } from 'vitest';

const { decode, free, width, height } = vi.hoisted(() => ({
  decode: vi.fn(),
  free: vi.fn(),
  width: vi.fn(),
  height: vi.fn(),
}));

// Mock Photon objects only for lifecycle and preflight assertions.
vi.mock('@cf-wasm/photon', () => ({
  PhotonImage: { new_from_byteslice: decode },
}));

import { validateCompatibleImageDecoding } from './compatible-image-decoder';

const bytes = new Uint8Array([1, 2, 3]);
const expected = { width: 2, height: 3 };

beforeEach(() => {
  vi.resetAllMocks();
  width.mockReturnValue(expected.width);
  height.mockReturnValue(expected.height);
  decode.mockReturnValue({ get_width: width, get_height: height, free });
});

it('releases each decoded image immediately without copying RGBA into JS', () => {
  validateCompatibleImageDecoding(bytes, expected);
  validateCompatibleImageDecoding(bytes, expected);
  expect(decode).toHaveBeenCalledTimes(2);
  expect(decode).toHaveBeenCalledWith(bytes);
  expect(free).toHaveBeenCalledTimes(2);
});

it('releases a decoded image when dimensions disagree with its header', () => {
  width.mockReturnValue(expected.width + 1);
  expect(() => validateCompatibleImageDecoding(bytes, expected)).toThrow(
    expect.objectContaining({ code: 'invalid_image' })
  );
  expect(free).toHaveBeenCalledTimes(1);
});

it('releases a decoded image if a metadata read throws', () => {
  height.mockImplementation(() => {
    throw new Error('mock dimension failure');
  });
  expect(() => validateCompatibleImageDecoding(bytes, expected)).toThrow(
    expect.objectContaining({ code: 'invalid_image' })
  );
  expect(free).toHaveBeenCalledTimes(1);
});

it('maps constructor failure to invalid_image without freeing a missing image', () => {
  decode.mockImplementation(() => {
    throw new Error('mock pixel decode failure');
  });
  expect(() => validateCompatibleImageDecoding(bytes, expected)).toThrow(
    expect.objectContaining({ code: 'invalid_image' })
  );
  expect(free).not.toHaveBeenCalled();
});

it('refuses a decode that cannot fit the Worker memory budget', () => {
  expect(() =>
    validateCompatibleImageDecoding(bytes, { width: 4096, height: 4096 })
  ).toThrow(expect.objectContaining({ code: 'resource_limit' }));
  expect(decode).not.toHaveBeenCalled();
});
