import { expect, it } from 'vitest';
import {
  createModelConfigurationSchema,
  DEFAULT_MODEL_CONFIGURATION,
} from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import {
  createTextModelRoutingSnapshot,
  TEXT_CHANNEL_PROTOCOL,
} from '@/models/text-channels';
import type { TextChannelsConfiguration } from '@/models/text-channels';
import { textModelCatalogFromRouting } from '@/models/text-model-catalog';
import { createModelConfigurationDraftUpdate } from './model-configuration-draft';

// The channel and model below are synthetic fixtures; no provider is contacted.
const CUSTOM_MODEL = 'custom:mock-draft-model';
const ACTIVE_CHANNELS: TextChannelsConfiguration = {
  revision: 1,
  channels: [
    {
      id: 'mock-channel',
      name: 'Mock channel',
      baseUrl: 'https://provider.example/v1',
      protocol: TEXT_CHANNEL_PROTOCOL,
      enabled: true,
      credentialId: 'mock-credential',
      keyHint: 'mock-hint',
      hasKey: true,
    },
  ],
  models: [
    {
      id: CUSTOM_MODEL,
      name: 'Mock draft model',
      channelId: 'mock-channel',
      upstreamModel: 'mock/upstream-model',
      enabled: true,
      structuredOutput: true,
      tools: true,
      vision: true,
      contextWindow: 16_000,
      maxOutputTokens: 4_000,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
  ],
};
const SAVED: ModelConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  defaultAnalysis: CUSTOM_MODEL,
  turboAnalysis: CUSTOM_MODEL,
  vision: CUSTOM_MODEL,
};
const DRAFT: ModelConfiguration = { ...SAVED, poster: 'flux_2_flash' };

function schemaFor(configuration: TextChannelsConfiguration) {
  return createModelConfigurationSchema(
    textModelCatalogFromRouting(createTextModelRoutingSnapshot(configuration))
  );
}

function inactiveConfiguration(disabled: 'channel' | 'binding') {
  return {
    ...ACTIVE_CHANNELS,
    channels: ACTIVE_CHANNELS.channels.map((channel) => ({
      ...channel,
      enabled: disabled !== 'channel',
    })),
    models: ACTIVE_CHANNELS.models.map((model) => ({
      ...model,
      enabled: disabled !== 'binding',
    })),
  };
}

function applySelection(
  current: ModelConfiguration,
  key: keyof ModelConfiguration,
  value: string,
  schema: ReturnType<typeof createModelConfigurationSchema>
) {
  const update = createModelConfigurationDraftUpdate(key, value, schema);
  if (!update) throw new Error('Expected a valid replacement selection.');
  return update(current);
}

function submittedValues(configuration: ModelConfiguration) {
  const form = new FormData();
  for (const [key, value] of Object.entries(configuration)) {
    form.set(key, value);
  }
  return Object.fromEntries(form);
}

function rejectedFields(
  configuration: ModelConfiguration,
  schema: ReturnType<typeof createModelConfigurationSchema>
) {
  const result = schema.safeParse(submittedValues(configuration));
  if (result.success)
    throw new Error('Expected invalid slots to block saving.');
  return result.error.issues.map((issue) => issue.path[0]);
}

const disabledKinds: ('channel' | 'binding')[] = ['channel', 'binding'];

it.each(disabledKinds)(
  'allows one-slot repairs after the %s is disabled while preserving other invalid slots',
  (disabled) => {
    expect(schemaFor(ACTIVE_CHANNELS).safeParse(DRAFT).success).toBe(true);
    const schema = schemaFor(inactiveConfiguration(disabled));
    expect(rejectedFields(DRAFT, schema)).toEqual([
      'defaultAnalysis',
      'turboAnalysis',
      'vision',
    ]);
    const first = applySelection(
      DRAFT,
      'defaultAnalysis',
      DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      schema
    );
    expect(first).toMatchObject({
      defaultAnalysis: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      turboAnalysis: CUSTOM_MODEL,
      vision: CUSTOM_MODEL,
      poster: DRAFT.poster,
    });
    expect(rejectedFields(first, schema)).toEqual(['turboAnalysis', 'vision']);
    expect(DRAFT).toEqual({ ...SAVED, poster: 'flux_2_flash' });
  }
);

it('keeps full-form validation strict until the final invalid slot is repaired', () => {
  const schema = schemaFor(inactiveConfiguration('binding'));
  const first = applySelection(
    DRAFT,
    'defaultAnalysis',
    DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
    schema
  );
  const second = applySelection(
    first,
    'turboAnalysis',
    DEFAULT_MODEL_CONFIGURATION.turboAnalysis,
    schema
  );
  expect(rejectedFields(second, schema)).toEqual(['vision']);
  const final = applySelection(
    second,
    'vision',
    DEFAULT_MODEL_CONFIGURATION.vision,
    schema
  );
  expect(schema.parse(submittedValues(final))).toEqual({
    ...DEFAULT_MODEL_CONFIGURATION,
    poster: DRAFT.poster,
  });
});

it('applies prepared repairs to the latest draft without losing another local edit', () => {
  const schema = schemaFor(inactiveConfiguration('channel'));
  const first = createModelConfigurationDraftUpdate(
    'defaultAnalysis',
    DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
    schema
  );
  const second = createModelConfigurationDraftUpdate(
    'turboAnalysis',
    DEFAULT_MODEL_CONFIGURATION.turboAnalysis,
    schema
  );
  if (!first || !second) throw new Error('Expected both repairs to be valid.');
  const draft = second(first(DRAFT));
  expect(draft).toMatchObject({
    defaultAnalysis: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
    turboAnalysis: DEFAULT_MODEL_CONFIGURATION.turboAnalysis,
    poster: DRAFT.poster,
    vision: CUSTOM_MODEL,
  });
  expect(rejectedFields(draft, schema)).toEqual(['vision']);
});

const invalidSelections: {
  key: keyof ModelConfiguration;
  value: string | null;
}[] = [
  { key: 'defaultAnalysis', value: null },
  { key: 'defaultAnalysis', value: CUSTOM_MODEL },
  { key: 'poster', value: 'seedance_v2' },
  { key: 'vision', value: 'deepseek/deepseek-v4-pro-0813' },
];

it.each(invalidSelections)(
  'rejects an invalid replacement for $key without rewriting the retained draft',
  ({ key, value }) => {
    const schema = schemaFor(inactiveConfiguration('binding'));
    expect(createModelConfigurationDraftUpdate(key, value, schema)).toBeNull();
    expect(DRAFT).toEqual({ ...SAVED, poster: 'flux_2_flash' });
  }
);
