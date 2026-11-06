import { expect, it } from 'vitest';
import { isConfiguredImageModelId } from '@/models/image-channels';
import { IMAGE_MODELS } from '@/models/models';
import { WORKFLOW_IMAGE_ROUTING_SIZE_ERROR } from '@/models/workflow-image-model-routing';
import {
  createImageChannelDraft,
  createImageModelDraft,
  createImageParameterRow,
  imageSaveErrorMessage,
  CUSTOM_IMAGE_MODEL_OPTION,
  imageModelBindingIdentity,
  imageModelBindingOptions,
  readImageChannelForm,
  readImageModelForm,
} from './admin-image-channels-state';

// All model identifiers, addresses and prices below are synthetic fixtures.
function modelForm() {
  const data = new FormData();
  data.set('id', 'custom-image:fixture-model');
  data.set('name', 'Fixture');
  data.set('channelId', 'fixture-channel');
  data.set('generate.configured', 'on');
  data.set('generate.status', 'verified');
  data.set('generate.upstreamModel', 'fixture/generate');
  return data;
}

function parameter(data: FormData, id: string, values: Record<string, string>) {
  data.append('parameterId', id);
  const defaults = {
    key: id,
    label: id,
    type: 'string',
    status: 'verified',
    generate: 'on',
  };
  for (const [key, value] of Object.entries({ ...defaults, ...values }))
    data.set('parameter.' + id + '.' + key, value);
}

function price(data: FormData, match = '{}') {
  data.append('priceId', 'fixture-price');
  data.set('price.fixture-price.operation', 'generate');
  data.set('price.fixture-price.unitPriceUsd', '0.125');
  data.set('price.fixture-price.match', match);
}

it('uses stable, disabled identifiers and never copies saved credential metadata', () => {
  const draft = createImageChannelDraft({
    id: 'fixture-channel',
    name: 'Fixture',
    baseUrl: 'https://fixture.example/v1',
    protocol: 'openai-images',
    enabled: true,
    credentialId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    keyHint: 'redacted-hint',
    hasKey: true,
  });
  expect(draft).not.toHaveProperty('apiKey');
  expect(draft).not.toHaveProperty('credentialId');
  const model = createImageModelDraft('fixture-channel', {
    name: 'Candidate',
    upstreamModel: 'fixture/candidate',
  });
  expect(isConfiguredImageModelId(model.id)).toBe(true);
  expect(model.enabled).toBe(false);
  expect(model.operations.generate?.status).toBe('unverified');
  expect(model.priceCards).toEqual([]);
});

it('omits a blank replacement key and trims a deliberately entered key', () => {
  const data = new FormData();
  data.set('id', 'fixture-channel');
  data.set('name', 'Fixture');
  data.set('baseUrl', 'https://fixture.example/v1');
  data.set('apiKey', ' ');
  const unchanged = readImageChannelForm(data, 7);
  expect(unchanged.success && unchanged.data).not.toHaveProperty('apiKey');
  data.set('apiKey', ' fixture-new-key ');
  expect(readImageChannelForm(data, 7)).toMatchObject({
    success: true,
    data: { revision: 7, apiKey: 'fixture-new-key' },
  });
});

it('round-trips typed defaults, enums, operation scopes and supplier cost separately', () => {
  const data = modelForm();
  parameter(data, 'size', {
    default: 'auto',
    useDefault: 'on',
    values: 'auto\r\n1024x1024',
  });
  parameter(data, 'n', {
    type: 'integer',
    default: '4',
    useDefault: 'on',
    minimum: '1',
    maximum: '8',
  });
  parameter(data, 'fixture_flag', {
    type: 'boolean',
    default: 'false',
    useDefault: 'on',
    values: 'true\nfalse',
    status: 'unverified',
  });
  parameter(data, 'fixture_weight', {
    type: 'number',
    default: '0',
    useDefault: 'on',
    minimum: '0',
    maximum: '1',
  });
  price(data, '{"size":"auto","n":4}');
  data.set('price.fixture-price.supplierCost', 'on');
  data.set('price.fixture-price.currency', 'CNY');
  data.set('price.fixture-price.unitCost', '0.8');
  const result = readImageModelForm(data, 9);
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.parameters.map((item) => item.defaultValue)).toEqual([
    'auto',
    4,
    false,
    0,
  ]);
  expect(result.data.parameters[0]?.values).toEqual(['auto', '1024x1024']);
  expect(result.data.parameters[2]?.status).toBe('unverified');
  expect(result.data.priceCards[0]).toMatchObject({
    match: { size: 'auto', n: 4 },
    unitPriceUsd: 0.125,
    supplierCost: { currency: 'CNY', unitPrice: 0.8 },
  });
});

it('keeps configurable reference counts and mask status without a two-image cap', () => {
  const data = modelForm();
  data.set('edit.configured', 'on');
  data.set('edit.upstreamModel', 'fixture/edit');
  data.set('edit.status', 'unverified');
  data.set('edit.minimum', '1');
  data.set('edit.maximum', '12');
  data.set('edit.mask', 'unsupported');
  const result = readImageModelForm(data, 1);
  expect(result).toMatchObject({
    success: true,
    data: {
      operations: {
        edit: {
          minReferenceImages: 1,
          maxReferenceImages: 12,
          mask: 'unsupported',
        },
      },
    },
  });
});

it.each(['{"size":{"nested":true}}', 'not-json', '["size"]'])(
  'rejects non-scalar or malformed specification match %s',
  (match) => {
    const data = modelForm();
    price(data, match);
    expect(readImageModelForm(data, 0).success).toBe(false);
  }
);

it('rejects invalid Boolean defaults and out-of-range integer values', () => {
  const data = modelForm();
  parameter(data, 'fixture_flag', {
    type: 'boolean',
    default: 'yes',
    useDefault: 'on',
  });
  expect(readImageModelForm(data, 0).success).toBe(false);
  data.delete('parameterId');
  parameter(data, 'n', {
    type: 'integer',
    default: '2.5',
    useDefault: 'on',
    minimum: '1',
    maximum: '8',
  });
  expect(readImageModelForm(data, 0).success).toBe(false);
});

it('adds useful parameter templates as unverified without hard-coding one requested image', () => {
  const count = createImageParameterRow('n').parameter;
  expect(count.status).toBe('unverified');
  expect(count.type).toBe('integer');
  expect(count.maximum).toBeGreaterThan(1);
  expect(count.defaultValue).toBeUndefined();
  expect(createImageParameterRow('output_format').parameter.key).toBe(
    'output_format'
  );
});

it('exposes actionable known save errors and hides arbitrary server or provider messages', () => {
  expect(
    imageSaveErrorMessage(
      new Error('Save an API key before enabling an image channel.')
    )
  ).toBe('Save an API key before enabling an image channel.');
  expect(
    imageSaveErrorMessage(new Error(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR))
  ).toBe(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR);
  expect(
    imageSaveErrorMessage(new Error('secret fixture provider response'))
  ).toBe('Could not save changes.');
});

it('offers registry names and original IDs, without using upstream wire IDs as local choices', () => {
  const options = imageModelBindingOptions([], 'custom-image:fixture');
  for (const id of ['gpt_image_2', 'nano_banana_2'] as const)
    expect(options.find((option) => option.value === id)).toEqual({
      value: id,
      label: IMAGE_MODELS[id].name + ' (' + id + ')',
      disabled: false,
    });
  expect(options.map((option) => option.value)).not.toContain('gpt-image-2');
});

it('disables an already configured built-in choice while retaining its own editor choice', () => {
  const model = { ...createImageModelDraft(), id: 'gpt_image_2' as const };
  expect(
    imageModelBindingOptions([model], 'custom-image:new').find(
      (option) => option.value === model.id
    )?.disabled
  ).toBe(true);
  expect(
    imageModelBindingOptions([model], model.id).find(
      (option) => option.value === model.id
    )?.disabled
  ).toBe(false);
});

it('prefills only the registry identity when choosing a built-in model', () => {
  const draft = createImageModelDraft('fixture-channel');
  expect(imageModelBindingIdentity(draft, 'gpt_image_2')).toEqual({
    id: 'gpt_image_2',
    name: IMAGE_MODELS.gpt_image_2.name,
    builtin: true,
  });
  expect(draft.operations).toEqual({});
  expect(draft.parameters).toEqual([]);
  expect(draft.priceCards).toEqual([]);
  expect(draft.enabled).toBe(false);
  expect(imageModelBindingIdentity(draft, CUSTOM_IMAGE_MODEL_OPTION)).toEqual({
    id: draft.id,
    name: draft.name,
    builtin: false,
  });
});

it('submits the built-in local ID separately from the exact per-operation upstream model', () => {
  const data = modelForm();
  data.set('id', 'gpt_image_2');
  data.set('name', IMAGE_MODELS.gpt_image_2.name);
  data.set('generate.upstreamModel', 'gpt-image-2');
  const result = readImageModelForm(data, 3);
  expect(result).toMatchObject({
    success: true,
    data: {
      id: 'gpt_image_2',
      name: IMAGE_MODELS.gpt_image_2.name,
      operations: { generate: { upstreamModel: 'gpt-image-2' } },
      parameters: [],
      priceCards: [],
      enabled: false,
    },
  });
});
