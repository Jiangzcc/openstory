import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import { configuredImageReferenceFiles } from './configured-image-references';
import { mockImageBytes } from './compatible-image-test-fixtures';

const mocks = vi.hoisted(() => ({ size: vi.fn(), read: vi.fn() }));
// Mock the R2 binding boundary; ownership and reference byte budgets stay real.
vi.mock('#storage', () => ({
  storageObjectSize: mocks.size,
  readStorageObject: mocks.read,
}));
const ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const KEY = 'images/org/' + ORGANIZATION_ID + '/reference.png';
const URL = '/r2/' + KEY;
const LIMIT_ERROR = 'Image references exceed supported file limits.';
const MEBIBYTE = 1024 * 1024;

beforeEach(() => {
  vi.resetAllMocks();
  const bytes = mockImageBytes();
  mocks.size.mockResolvedValue(bytes.byteLength);
  mocks.read.mockResolvedValue({ bytes, contentType: 'image/png' });
});
afterEach(() => vi.unstubAllGlobals());

it('reads an authorized R2 image with a bounded range', async () => {
  const files = await configuredImageReferenceFiles([URL], ORGANIZATION_ID);
  expect(files).toHaveLength(1);
  expect(files[0]?.type).toBe('image/png');
  expect(mocks.size).toHaveBeenCalledExactlyOnceWith(KEY);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(KEY, {
    offset: 0,
    length: COMPATIBLE_IMAGE_LIMITS.maxImageBytes + 1,
  });
});

it('rejects an oversized R2 object before reading its bytes', async () => {
  mocks.size.mockResolvedValue(COMPATIBLE_IMAGE_LIMITS.maxImageBytes + 1);
  await expect(
    configuredImageReferenceFiles([URL], ORGANIZATION_ID)
  ).rejects.toThrow(LIMIT_ERROR);
  expect(mocks.read).not.toHaveBeenCalled();
});

it('keeps the read bounded if the object grows after its size check', async () => {
  mocks.read.mockResolvedValue({
    bytes: new Uint8Array(COMPATIBLE_IMAGE_LIMITS.maxImageBytes + 1),
    contentType: 'image/png',
  });
  await expect(
    configuredImageReferenceFiles([URL], ORGANIZATION_ID)
  ).rejects.toThrow(LIMIT_ERROR);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(KEY, {
    offset: 0,
    length: COMPATIBLE_IMAGE_LIMITS.maxImageBytes + 1,
  });
});

it('checks the remaining aggregate budget before reading another R2 object', async () => {
  // Synthetic bytes retain only a PNG signature; decoding is the adapter boundary.
  const bytes = new Uint8Array(9 * MEBIBYTE);
  bytes.set(mockImageBytes().subarray(0, 8));
  mocks.size.mockResolvedValue(bytes.byteLength);
  mocks.read.mockResolvedValue({ bytes, contentType: 'image/png' });
  await expect(
    configuredImageReferenceFiles([URL, URL, URL], ORGANIZATION_ID)
  ).rejects.toThrow(LIMIT_ERROR);
  expect(mocks.size).toHaveBeenCalledTimes(3);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it('refuses a foreign organization before accessing storage', async () => {
  await expect(
    configuredImageReferenceFiles([URL], OTHER_ORGANIZATION_ID)
  ).rejects.toThrow('another organization');
  expect(mocks.size).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});

it('reports a missing R2 object without attempting a body read', async () => {
  mocks.size.mockResolvedValue(null);
  await expect(
    configuredImageReferenceFiles([URL], ORGANIZATION_ID)
  ).rejects.toThrow('unavailable');
  expect(mocks.read).not.toHaveBeenCalled();
});

it('applies the byte limit while reading an external reference', async () => {
  const response = new Response(mockImageBytes(), {
    headers: {
      'content-length': String(COMPATIBLE_IMAGE_LIMITS.maxImageBytes + 1),
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response)
  );
  await expect(
    configuredImageReferenceFiles(
      ['https://mock-images.example.test/ref.png'],
      ORGANIZATION_ID
    )
  ).rejects.toMatchObject({ code: 'resource_limit' });
  expect(mocks.read).not.toHaveBeenCalled();
});
