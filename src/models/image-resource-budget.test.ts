import { expect, it } from 'vitest';
import {
  fitsConfiguredImageDecodeBudget,
  supportsConfiguredImageSize,
} from './image-resource-budget';

it.each([undefined, 'auto', '512x512', '1024x1536', '2048x2048'])(
  'keeps supported fixed and automatic size %s',
  (size) => expect(supportsConfiguredImageSize(size)).toBe(true)
);

it.each([
  '4096x4096',
  '3072x3072',
  '32769x1',
  '0x1024',
  '999999999999999999999x1',
])('refuses an impossible or invalid output size %s', (size) =>
  expect(supportsConfiguredImageSize(size)).toBe(false)
);

it('accounts for encoded bytes when accepting an actual image', () => {
  const dimensions = { width: 2048, height: 2048 };
  expect(fitsConfiguredImageDecodeBudget(dimensions, 1024)).toBe(true);
  expect(fitsConfiguredImageDecodeBudget(dimensions, 10 * 1024 * 1024)).toBe(
    false
  );
});
