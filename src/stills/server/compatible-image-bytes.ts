import { validateCompatibleImageDecoding } from './compatible-image-decoder';
import { CompatibleImageError } from './compatible-image-error';
import { COMPATIBLE_IMAGE_LIMITS } from './compatible-image-limits';
import type { CompatibleImageMime } from './compatible-image-types';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_HEADER_BYTES = 33;
const PNG_CHUNK_OVERHEAD = 12;
const PNG_IHDR_LENGTH = 13;
const JPEG_PREFIX = 0xff;
const JPEG_START = 0xd8;
const JPEG_END = 0xd9;
const JPEG_SCAN = 0xda;
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const WEBP_HEADER_BYTES = 12;
const WEBP_CHUNK_HEADER_BYTES = 8;
const WEBP_EXTENDED_BYTES = 10;
const WEBP_LOSSLESS_BYTES = 5;
const WEBP_LOSSY_BYTES = 10;
const UINT24_HIGH_FACTOR = 65_536;
const WEBP_EDGE_MASK = 0x3fff;
const CRC_POLYNOMIAL = 0xedb88320;

export interface CompatibleImageMetadata {
  width: number;
  height: number;
  mimeType: CompatibleImageMime;
  byteLength: number;
}

function invalidImage(): never {
  throw new CompatibleImageError('invalid_image');
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? CRC_POLYNOMIAL : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePngHeader(bytes: Uint8Array, view: DataView): void {
  if (
    bytes.length < PNG_HEADER_BYTES ||
    view.getUint32(8) !== PNG_IHDR_LENGTH ||
    ascii(bytes, 12, 4) !== 'IHDR'
  )
    invalidImage();
}

function pngChunk(bytes: Uint8Array, view: DataView, offset: number) {
  const length = view.getUint32(offset);
  const end = offset + PNG_CHUNK_OVERHEAD + length;
  if (end > bytes.length) invalidImage();
  if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
    invalidImage();
  return { kind: ascii(bytes, offset + 4, 4), length, end };
}

function pngDimensions(
  bytes: Uint8Array,
  view: DataView
): { width: number; height: number } {
  validatePngHeader(bytes, view);
  let offset = PNG_SIGNATURE.length;
  let hasData = false;
  while (offset + PNG_CHUNK_OVERHEAD <= bytes.length) {
    const chunk = pngChunk(bytes, view, offset);
    if (chunk.kind === 'IDAT' && chunk.length > 0) hasData = true;
    if (chunk.kind === 'IEND') {
      if (!hasData || chunk.length !== 0 || chunk.end !== bytes.length)
        invalidImage();
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    offset = chunk.end;
  }
  return invalidImage();
}

function jpegSegment(bytes: Uint8Array, view: DataView, start: number) {
  if (bytes[start] !== JPEG_PREFIX) invalidImage();
  let offset = start;
  while (bytes[offset] === JPEG_PREFIX) offset += 1;
  const marker = bytes[offset];
  offset += 1;
  if (marker === undefined || offset + 2 > bytes.length) invalidImage();
  const length = view.getUint16(offset);
  if (length < 2 || offset + length > bytes.length) invalidImage();
  return { marker, offset, length, end: offset + length };
}

function jpegDimensions(
  bytes: Uint8Array,
  view: DataView
): { width: number; height: number } {
  if (bytes.at(-2) !== JPEG_PREFIX || bytes.at(-1) !== JPEG_END) invalidImage();
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 4 <= bytes.length) {
    const segment = jpegSegment(bytes, view, offset);
    if (segment.marker === JPEG_SCAN) {
      if (!dimensions || segment.end >= bytes.length) invalidImage();
      return dimensions;
    }
    if (JPEG_SOF.has(segment.marker)) {
      if (segment.length < 8) invalidImage();
      const frame = {
        width: view.getUint16(segment.offset + 5),
        height: view.getUint16(segment.offset + 3),
      };
      if (dimensions) validateMatchingDimensions(frame, dimensions);
      dimensions = frame;
    }
    offset = segment.end;
  }
  return invalidImage();
}

function uint24(view: DataView, offset: number): number {
  return (
    view.getUint16(offset, true) +
    view.getUint8(offset + 2) * UINT24_HIGH_FACTOR
  );
}

function webpFrameDimensions(
  kind: string,
  view: DataView,
  offset: number,
  length: number
): { width: number; height: number } | undefined {
  if (kind === 'VP8X') {
    if (length !== WEBP_EXTENDED_BYTES) invalidImage();
    return {
      width: uint24(view, offset + 4) + 1,
      height: uint24(view, offset + 7) + 1,
    };
  }
  if (kind === 'VP8L') {
    if (length < WEBP_LOSSLESS_BYTES || view.getUint8(offset) !== 0x2f)
      invalidImage();
    const packed = view.getUint32(offset + 1, true);
    return {
      width: (packed & WEBP_EDGE_MASK) + 1,
      height: ((packed >>> 14) & WEBP_EDGE_MASK) + 1,
    };
  }
  if (kind !== 'VP8 ') return undefined;
  if (
    length < WEBP_LOSSY_BYTES ||
    view.getUint8(offset + 3) !== 0x9d ||
    view.getUint16(offset + 4) !== 0x012a
  )
    invalidImage();
  return {
    width: view.getUint16(offset + 6, true) & WEBP_EDGE_MASK,
    height: view.getUint16(offset + 8, true) & WEBP_EDGE_MASK,
  };
}

function validateWebpHeader(bytes: Uint8Array, view: DataView): void {
  if (
    bytes.length < WEBP_HEADER_BYTES ||
    view.getUint32(4, true) + 8 !== bytes.length ||
    ascii(bytes, 8, 4) !== 'WEBP'
  )
    invalidImage();
}

function webpDimensions(
  bytes: Uint8Array,
  view: DataView
): { width: number; height: number } {
  validateWebpHeader(bytes, view);
  let offset = WEBP_HEADER_BYTES;
  let dimensions: { width: number; height: number } | undefined;
  let hasFrame = false;
  while (offset + WEBP_CHUNK_HEADER_BYTES <= bytes.length) {
    const kind = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const end = offset + WEBP_CHUNK_HEADER_BYTES + length;
    if (end + (length % 2) > bytes.length) invalidImage();
    const frame = webpFrameDimensions(
      kind,
      view,
      offset + WEBP_CHUNK_HEADER_BYTES,
      length
    );
    if (frame && dimensions) validateMatchingDimensions(frame, dimensions);
    dimensions ??= frame;
    if (kind === 'VP8 ' || kind === 'VP8L') hasFrame = true;
    offset = end + (length % 2);
  }
  if (!dimensions || !hasFrame || offset !== bytes.length) invalidImage();
  return dimensions;
}

function validateMatchingDimensions(
  actual: { width: number; height: number },
  expected: { width: number; height: number }
): void {
  if (actual.width !== expected.width || actual.height !== expected.height)
    invalidImage();
}

export function inspectCompatibleImageBytes(
  bytes: Uint8Array
): CompatibleImageMetadata {
  if (bytes.byteLength > COMPATIBLE_IMAGE_LIMITS.maxImageBytes)
    throw new CompatibleImageError('resource_limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mimeType: CompatibleImageMime;
  let dimensions: { width: number; height: number };
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    mimeType = 'image/png';
    dimensions = pngDimensions(bytes, view);
  } else if (bytes[0] === JPEG_PREFIX && bytes[1] === JPEG_START) {
    mimeType = 'image/jpeg';
    dimensions = jpegDimensions(bytes, view);
  } else {
    if (ascii(bytes, 0, 4) !== 'RIFF') invalidImage();
    mimeType = 'image/webp';
    dimensions = webpDimensions(bytes, view);
  }
  validateDimensions(dimensions);
  validateCompatibleImageDecoding(bytes, dimensions);
  return { ...dimensions, mimeType, byteLength: bytes.byteLength };
}

function validateDimensions({
  width,
  height,
}: {
  width: number;
  height: number;
}): void {
  if (width <= 0 || height <= 0) invalidImage();
  if (
    Math.max(width, height) > COMPATIBLE_IMAGE_LIMITS.maxEdge ||
    width * height > COMPATIBLE_IMAGE_LIMITS.maxPixels
  ) {
    throw new CompatibleImageError('resource_limit');
  }
}

export function decodeCompatibleImageBase64(
  value: string,
  maxBytes = COMPATIBLE_IMAGE_LIMITS.maxImageBytes
): Uint8Array {
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (value.length > maxEncodedLength)
    throw new CompatibleImageError('resource_limit');
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    invalidImage();
  const binary = atob(value);
  if (binary.length > maxBytes)
    throw new CompatibleImageError('resource_limit');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function compatibleImageDataUrl(
  bytes: Uint8Array,
  mimeType: CompatibleImageMime
): string {
  let binary = '';
  for (
    let offset = 0;
    offset < bytes.length;
    offset += COMPATIBLE_IMAGE_LIMITS.base64ChunkBytes
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        offset,
        offset + COMPATIBLE_IMAGE_LIMITS.base64ChunkBytes
      )
    );
  }
  return 'data:' + mimeType + ';base64,' + btoa(binary);
}
