import { expect, it } from 'vitest';
import type { ImageChannelParameter } from './image-channel-parameters';
import {
  imageChannelParameterSchema,
  imageChannelParametersSchema,
  validateImageChannelParameters,
} from './image-channel-parameters';

// Synthetic parameter definitions; no provider calls.
const size: ImageChannelParameter = {
  key: 'size',
  label: 'Size',
  type: 'string',
  status: 'verified',
  operations: ['generate', 'edit'],
  required: true,
  values: ['auto', '1024x1024'],
  defaultValue: 'auto',
};
const count: ImageChannelParameter = {
  key: 'n',
  label: 'Count',
  type: 'integer',
  status: 'verified',
  operations: ['generate'],
  required: true,
  minimum: 1,
  maximum: 4,
  defaultValue: 1,
};

it('fills typed defaults and preserves auto size without inventing a dimension', () => {
  expect(validateImageChannelParameters([size, count], 'generate', {})).toEqual(
    { size: 'auto', n: 1 }
  );
  expect(
    validateImageChannelParameters([size, count], 'edit', { size: '1024x1024' })
  ).toEqual({ size: '1024x1024' });
});

it.each([
  { n: '2' },
  { n: 0 },
  { n: 1.5 },
  { n: 5 },
  { size: '512x512' },
  { size: null },
  { unknown: true },
])(
  'rejects unknown, null, mistyped and out-of-range execution values: %j',
  (input) => {
    expect(() =>
      validateImageChannelParameters([size, count], 'generate', input)
    ).toThrow();
  }
);

it('retains pending declarations in config but refuses them in execution', () => {
  const unverified = { ...size, status: 'unverified' as const };
  expect(imageChannelParameterSchema.safeParse(unverified).success).toBe(true);
  expect(validateImageChannelParameters([unverified], 'generate', {})).toEqual(
    {}
  );
  expect(() =>
    validateImageChannelParameters([unverified], 'generate', { size: 'auto' })
  ).toThrow('unavailable');
  expect(() =>
    validateImageChannelParameters([count], 'edit', { n: 2 })
  ).toThrow('unavailable');
});

it('rejects missing required values and supports optional scalars including decimals', () => {
  expect(() =>
    validateImageChannelParameters(
      [{ ...size, defaultValue: undefined }],
      'generate',
      {}
    )
  ).toThrow('required');
  const strength: ImageChannelParameter = {
    key: 'strength',
    label: 'Strength',
    type: 'number',
    status: 'verified',
    operations: ['edit'],
    required: false,
    minimum: 0,
    maximum: 1,
    defaultValue: 0.5,
  };
  expect(imageChannelParameterSchema.safeParse(strength).success).toBe(true);
  expect(validateImageChannelParameters([strength], 'edit', {})).toEqual({
    strength: 0.5,
  });
});

it.each([
  'model',
  'prompt',
  'image',
  'mask',
  'headers',
  'api_key',
  '__proto__',
  'constructor',
  'extra_body',
  'url',
])('blocks structural and security-sensitive parameter %s', (key) => {
  expect(imageChannelParameterSchema.safeParse({ ...size, key }).success).toBe(
    false
  );
});

it.each([
  { defaultValue: 123 },
  { values: ['auto', 123] },
  { values: ['auto', 'auto'] },
  { minimum: 1 },
  { operations: ['generate', 'generate'] },
  { key: 'n', type: 'string' },
  { key: 'n', type: 'integer', values: undefined },
  {
    key: 'output_compression',
    type: 'integer',
    values: [101],
    defaultValue: 101,
  },
])('rejects invalid definition contracts: %j', (override) => {
  expect(
    imageChannelParameterSchema.safeParse({ ...size, ...override }).success
  ).toBe(false);
});

it('permits distinct per-operation definitions but rejects overlapping duplicates', () => {
  expect(
    imageChannelParametersSchema.safeParse([
      { ...size, operations: ['generate'] },
      { ...size, operations: ['edit'] },
    ]).success
  ).toBe(true);
  expect(imageChannelParametersSchema.safeParse([size, size]).success).toBe(
    false
  );
});
