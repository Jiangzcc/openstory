import { deflateSync } from 'node:zlib';
import { PhotonImage } from '@cf-wasm/photon';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectCompatibleImageBytes } from './compatible-image-bytes';
import { generateCompatibleImages } from './compatible-image-client';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import {
  MOCK_IMAGE_BASE64,
  mockImageBytes,
  mockImageInput,
  mockImageResponse,
} from './compatible-image-test-fixtures';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_POLYNOMIAL = 0xedb88320;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? CRC_POLYNOMIAL : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(kind: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(kind, 4, 'ascii');
  chunk.set(data, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

// Synthetic RGB PNG; oversized headers are preflight fixtures, not valid pixels.
function pngBytes(width = 1, height = 1, corruptPixels = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = corruptPixels
    ? Buffer.from([0, 0, 0, 0])
    : deflateSync(Buffer.from([0, 255, 0, 0]));
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('IDAT', pixels),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Deliberately invalid synthetic payloads with intact format/dimension headers.
function jpegWithoutPixelTables(): Uint8Array {
  return Uint8Array.from([
    255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1,
    0, 0, 63, 0, 0, 255, 217,
  ]);
}

function webpWithoutPixels(): Uint8Array {
  const bytes = Buffer.alloc(26);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBPVP8L', 8);
  bytes.writeUInt32LE(5, 16);
  bytes[20] = 0x2f;
  return bytes;
}

function extendedWebp(width: number, height: number): Uint8Array {
  const original = mockImageBytes('webp');
  const bytes = Buffer.alloc(original.length + 18);
  bytes.set(original.subarray(0, 12));
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('VP8X', 12);
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  bytes.set(original.subarray(12), 30);
  return bytes;
}

afterEach(() => vi.restoreAllMocks());

it.each(['png', 'jpeg', 'webp'] as const)(
  'decodes the existing synthetic %s fixture and preserves metadata',
  (format) => {
    const bytes = mockImageBytes(format);
    const input = bytes.slice();
    expect(inspectCompatibleImageBytes(bytes)).toEqual({
      width: 2,
      height: 3,
      mimeType: 'image/' + format,
      byteLength: bytes.byteLength,
    });
    expect(bytes).toEqual(input);
  }
);

it('rejects the 61-byte CRC-valid PNG whose IDAT cannot be decoded', () => {
  const bytes = pngBytes(1, 1, true);
  expect(bytes).toHaveLength(61);
  expect(() => inspectCompatibleImageBytes(bytes)).toThrow(
    expect.objectContaining({ code: 'invalid_image' })
  );
  expect(inspectCompatibleImageBytes(pngBytes())).toMatchObject({
    width: 1,
    height: 1,
    mimeType: 'image/png',
  });
});

it.each([
  ['PNG', () => pngBytes(1, 1, true)],
  ['JPEG', jpegWithoutPixelTables],
  ['WebP', webpWithoutPixels],
] as const)(
  'refuses undecodable %s before a complete result',
  async (_, build) => {
    const bytes = build();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockImageResponse({
        data: [{ b64_json: Buffer.from(bytes).toString('base64') }],
      })
    );
    await expect(
      generateCompatibleImages(mockImageInput(), { fetch: fetchMock })
    ).rejects.toMatchObject({ code: 'invalid_image' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);

it.each(['png', 'jpeg', 'webp'] as const)(
  'accepts decodable %s through the production response path',
  async (format) => {
    const result = await generateCompatibleImages(mockImageInput(), {
      fetch: async () =>
        mockImageResponse({
          data: [{ b64_json: MOCK_IMAGE_BASE64[format] }],
        }),
    });
    expect(result.status).toBe('complete');
    expect(result.images[0]).toMatchObject({
      width: 2,
      height: 3,
      mimeType: 'image/' + format,
    });
  }
);

it('rejects inconsistent WebP canvas dimensions before decoding', () => {
  const decode = vi.spyOn(PhotonImage, 'new_from_byteslice');
  expect(() => inspectCompatibleImageBytes(extendedWebp(1, 1))).toThrow(
    expect.objectContaining({ code: 'invalid_image' })
  );
  expect(decode).not.toHaveBeenCalled();
});

it('rejects a misleading second JPEG frame header before decoding', () => {
  const original = jpegWithoutPixelTables();
  const header = Buffer.from(original.subarray(2, 15));
  const bytes = Buffer.concat([
    Buffer.from(original.subarray(0, 15)),
    header,
    Buffer.from(original.subarray(15)),
  ]);
  bytes.writeUInt16BE(4096, 7);
  bytes.writeUInt16BE(4096, 9);
  const decode = vi.spyOn(PhotonImage, 'new_from_byteslice');
  expect(() => inspectCompatibleImageBytes(bytes)).toThrow(
    expect.objectContaining({ code: 'invalid_image' })
  );
  expect(decode).not.toHaveBeenCalled();
});

it('decodes an extended WebP with matching canvas and frame dimensions', () => {
  expect(inspectCompatibleImageBytes(extendedWebp(2, 3))).toMatchObject({
    width: 2,
    height: 3,
    mimeType: 'image/webp',
  });
});

it.each([
  ['edge', () => pngBytes(COMPATIBLE_IMAGE_LIMITS.maxEdge + 1, 1)],
  ['pixels', () => pngBytes(16_384, 8192)],
  ['decode memory', () => pngBytes(4096, 4096)],
  ['bytes', () => new Uint8Array(COMPATIBLE_IMAGE_LIMITS.maxImageBytes + 1)],
] as const)('rejects excessive %s before decoding', (_, build) => {
  const decode = vi.spyOn(PhotonImage, 'new_from_byteslice');
  expect(() => inspectCompatibleImageBytes(build())).toThrow(
    expect.objectContaining({ code: 'resource_limit' })
  );
  expect(decode).not.toHaveBeenCalled();
});

it('still rejects CRC corruption and truncated JPEG/WebP before decoding', () => {
  const png = mockImageBytes();
  png[42] = (png[42] ?? 0) ^ 1;
  const decode = vi.spyOn(PhotonImage, 'new_from_byteslice');
  for (const bytes of [
    png,
    mockImageBytes('jpeg').slice(0, -2),
    mockImageBytes('webp').slice(0, -2),
  ]) {
    expect(() => inspectCompatibleImageBytes(bytes)).toThrow(
      expect.objectContaining({ code: 'invalid_image' })
    );
  }
  expect(decode).not.toHaveBeenCalled();
});

it('handles a valid image view with a nonzero buffer offset', () => {
  const bytes = mockImageBytes('webp');
  const padded = new Uint8Array(bytes.length + 20);
  padded.set(bytes, 7);
  expect(
    inspectCompatibleImageBytes(padded.subarray(7, 7 + bytes.length))
  ).toMatchObject({ width: 2, height: 3, mimeType: 'image/webp' });
});
