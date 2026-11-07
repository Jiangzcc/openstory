import { expect, it } from 'vitest';
import {
  imageChannelParametersSchema,
  imageChannelParametersSupportOperation,
  saveImageChannelParametersSchema,
  validateImageChannelParameters,
} from './image-channel-parameters';
import type {
  ImageChannelParameter,
  ImageChannelParameterValue,
  ImageOperation,
} from './image-channel-parameters';
import {
  imageEditParameterValuesSchema,
  imageGenerateParameterValuesSchema,
} from './image-parameter-contract';

// Synthetic declarations and values; no provider or storage access.
function parameter(
  key: string,
  value: ImageChannelParameterValue,
  operation: ImageOperation
): ImageChannelParameter {
  return {
    key,
    label: key,
    type: typeof value === 'number' ? 'integer' : 'string',
    status: 'verified',
    operations: [operation],
    required: false,
    defaultValue: value,
    values: [value],
  };
}

const incompatibleParameters = [
  ['edit', 'moderation', 'auto'],
  ['edit', 'style', 'natural'],
  ['edit', 'quality', 'hd'],
  ['generate', 'input_fidelity', 'high'],
  ['generate', 'quality', 'premium'],
  ['edit', 'input_fidelity', 'medium'],
  ['generate', 'background', 'solid'],
  ['generate', 'output_format', 'jpg'],
  ['generate', 'response_format', 'base64'],
  ['generate', 'moderation', 'strict'],
  ['generate', 'size', 'square_hd'],
] as const;

it.each(incompatibleParameters)(
  'reads historical %s %s=%s but refuses enabling, publishing or executing it',
  (operation, key, value) => {
    const definitions = [parameter(key, value, operation)];
    expect(imageChannelParametersSchema.safeParse(definitions).success).toBe(
      true
    );
    expect(
      saveImageChannelParametersSchema.safeParse(definitions).success
    ).toBe(false);
    expect(imageChannelParametersSupportOperation(definitions, operation)).toBe(
      false
    );
    expect(() =>
      validateImageChannelParameters(definitions, operation, {})
    ).toThrow('unavailable');
    const schema =
      operation === 'generate'
        ? imageGenerateParameterValuesSchema
        : imageEditParameterValuesSchema;
    expect(schema.safeParse({ [key]: value }).success).toBe(false);
  }
);

it.each([
  'auth',
  'imageurl',
  'imageurls',
  'proto',
  'a_p_i_k_e_y',
  'extra__body',
  'extraheaders',
  'requestoptions',
  'b_a_s_e_u_r_l',
  'm_o_d_e_l',
])(
  'normalizes reserved names in both the new-save and request contracts: %s',
  (key) => {
    const definitions = [parameter(key, 'synthetic', 'generate')];
    expect(imageChannelParametersSchema.safeParse(definitions).success).toBe(
      true
    );
    expect(
      saveImageChannelParametersSchema.safeParse(definitions).success
    ).toBe(false);
    expect(
      imageChannelParametersSupportOperation(definitions, 'generate')
    ).toBe(false);
    expect(() =>
      validateImageChannelParameters(definitions, 'generate', {})
    ).toThrow('unavailable');
    expect(
      imageGenerateParameterValuesSchema.safeParse({ [key]: 'synthetic' })
        .success
    ).toBe(false);
  }
);

it.each([
  ['generate', 'quality', 'hd'],
  ['generate', 'quality', 'xhigh'],
  ['edit', 'quality', 'max'],
  ['edit', 'input_fidelity', 'high'],
  ['generate', 'moderation', 'low'],
  ['generate', 'style', 'vivid'],
  ['edit', 'background', 'transparent'],
  ['edit', 'output_format', 'webp'],
  ['generate', 'response_format', 'b64_json'],
  ['generate', 'size', '1280x720'],
  ['edit', 'n', 16],
  ['generate', 'output_compression', 100],
] as const)(
  'preserves compatible verified %s %s=%s',
  (operation, key, value) => {
    const definitions = [parameter(key, value, operation)];
    expect(
      saveImageChannelParametersSchema.safeParse(definitions).success
    ).toBe(true);
    expect(imageChannelParametersSupportOperation(definitions, operation)).toBe(
      true
    );
    const actual = validateImageChannelParameters(definitions, operation, {});
    const schema =
      operation === 'generate'
        ? imageGenerateParameterValuesSchema
        : imageEditParameterValuesSchema;
    expect(schema.parse(actual)).toEqual(actual);
  }
);

it('checks all declared values and operations rather than only the default', () => {
  const quality = parameter('quality', 'high', 'generate');
  quality.values = ['high', 'premium'];
  expect(saveImageChannelParametersSchema.safeParse([quality]).success).toBe(
    false
  );
  quality.values = ['high', 'hd'];
  quality.operations = ['generate', 'edit'];
  expect(saveImageChannelParametersSchema.safeParse([quality]).success).toBe(
    false
  );
  expect(imageChannelParametersSupportOperation([quality], 'generate')).toBe(
    true
  );
  expect(imageChannelParametersSupportOperation([quality], 'edit')).toBe(false);
});

it('keeps unverified and unsupported standard declarations as non-executable metadata', () => {
  for (const status of ['unverified', 'unsupported'] as const) {
    const definition = { ...parameter('quality', 'premium', 'edit'), status };
    expect(
      saveImageChannelParametersSchema.safeParse([definition]).success
    ).toBe(true);
    expect(imageChannelParametersSupportOperation([definition], 'edit')).toBe(
      true
    );
    expect(validateImageChannelParameters([definition], 'edit', {})).toEqual(
      {}
    );
    expect(() =>
      validateImageChannelParameters([definition], 'edit', {
        quality: 'premium',
      })
    ).toThrow('unavailable');
  }
});

it('applies standard enums to explicit input even without a configured enum', () => {
  const quality = {
    ...parameter('quality', 'high', 'edit'),
    values: undefined,
  };
  expect(saveImageChannelParametersSchema.safeParse([quality]).success).toBe(
    true
  );
  expect(() =>
    validateImageChannelParameters([quality], 'edit', { quality: 'hd' })
  ).toThrow('Invalid image parameter');
  expect(
    validateImageChannelParameters([quality], 'edit', { quality: 'max' })
  ).toEqual({ quality: 'max' });
});

it('preserves verified scalar extensions while rejecting nested or unsafe values', () => {
  const definitions: ImageChannelParameter[] = [
    {
      ...parameter('seed', 42, 'edit'),
      values: undefined,
      minimum: 0,
      maximum: 100,
    },
    {
      ...parameter('guidance_scale', 4, 'edit'),
      type: 'number',
      values: undefined,
      minimum: 0,
      maximum: 10,
    },
    {
      ...parameter('enhance_prompt', 'false', 'edit'),
      type: 'boolean',
      defaultValue: false,
      values: [false, true],
    },
  ];
  expect(saveImageChannelParametersSchema.safeParse(definitions).success).toBe(
    true
  );
  const values = validateImageChannelParameters(definitions, 'edit', {
    guidance_scale: 4.5,
  });
  expect(imageEditParameterValuesSchema.parse(values)).toEqual({
    seed: 42,
    guidance_scale: 4.5,
    enhance_prompt: false,
  });
  expect(() =>
    validateImageChannelParameters(definitions, 'edit', {
      guidance_scale: { nested: true },
    })
  ).toThrow();
});
