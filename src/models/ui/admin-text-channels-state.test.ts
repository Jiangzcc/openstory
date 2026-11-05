import { describe, expect, it } from 'vitest';
import { SCRIPT_ANALYSIS_MODELS } from '@/models/models.config';
import {
  TEXT_CHANNEL_PROTOCOL,
  TEXT_CHANNEL_PROTOCOLS,
} from '@/models/text-channels';
import type { ChannelTextModel, TextChannel } from '@/models/text-channels';
import {
  builtinTextModelOptions,
  changeTextModelChoice,
  createTextChannelDraft,
  createTextModelDraft,
  CUSTOM_TEXT_MODEL_OPTION,
  textCandidateToDraft,
  textChannelToDraft,
  textModelToDraft,
  validateTextChannelDraft,
  validateTextModelDraft,
} from './admin-text-channels-state';
import type { TextModelDraft } from './admin-text-channels-state';

// Fixtures use reserved example addresses and test-only credentials.
const channel: TextChannel = {
  id: 'channel-test',
  name: 'Test channel',
  baseUrl: 'https://provider.example/v1',
  protocol: TEXT_CHANNEL_PROTOCOL,
  enabled: true,
  credentialId: 'test-credential',
  keyHint: 'test-hint',
  hasKey: true,
};
const savedModel: ChannelTextModel = {
  id: 'custom:test-model',
  name: 'Test model',
  channelId: channel.id,
  upstreamModel: 'vendor/text-model',
  enabled: true,
  vision: false,
  structuredOutput: true,
  tools: true,
  contextWindow: 16000,
  maxOutputTokens: 4000,
  inputPricePerMillion: 0.25,
  outputPricePerMillion: 1.5,
};
const REVISION = 4;
function validModel(overrides: Partial<TextModelDraft> = {}): TextModelDraft {
  return { ...textModelToDraft(savedModel), ...overrides };
}
function validateModel(
  draft: TextModelDraft,
  models: ChannelTextModel[] = [],
  isNew = true
) {
  return validateTextModelDraft(draft, REVISION, [channel], models, isNew);
}

describe('channel initialization and keys', () => {
  it.each([
    'http://localhost:3001/v1',
    'http://127.0.0.1:3001/v1',
    'http://[::1]:3001/v1',
  ])('accepts a local development base URL: %s', (baseUrl) => {
    expect(
      validateTextChannelDraft(
        { ...textChannelToDraft(channel), baseUrl, apiKey: 'test-local-key' },
        REVISION,
        channel
      ).success
    ).toBe(true);
  });
  it('creates a disabled channel with no generated credential', () => {
    const draft = createTextChannelDraft();
    expect(draft.id).toMatch(/^channel-/);
    expect(draft.protocol).toBe(TEXT_CHANNEL_PROTOCOLS.chatCompletions);
    expect(draft.enabled).toBe(false);
    expect(draft.apiKey).toBe('');
  });
  it('never puts stored credential identifiers or hints into a write-only key input', () => {
    const draft = textChannelToDraft(channel);
    expect(draft.apiKey).toBe('');
    expect(draft).not.toHaveProperty('credentialId');
    expect(draft).not.toHaveProperty('keyHint');
    expect(draft).not.toHaveProperty('hasKey');
  });
  it('retains the saved key for a blank key and submits the captured revision', () => {
    const result = validateTextChannelDraft(
      { ...textChannelToDraft(channel), apiKey: '   ' },
      REVISION,
      channel
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiKey).toBeUndefined();
      expect(result.data.revision).toBe(REVISION);
    }
  });
});

describe('channel protocols', () => {
  it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
    'preserves the saved %s protocol through editing and validation',
    (protocol) => {
      const original = { ...channel, protocol };
      const draft = textChannelToDraft(original);
      expect(draft.protocol).toBe(protocol);
      expect(validateTextChannelDraft(draft, REVISION, original)).toMatchObject(
        {
          success: true,
          data: { protocol, revision: REVISION, apiKey: undefined },
        }
      );
    }
  );
  it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
    'submits a newly selected %s protocol without resetting it to Chat',
    (protocol) => {
      const draft = {
        ...textChannelToDraft(channel),
        protocol,
        apiKey: 'test-key',
      };
      expect(validateTextChannelDraft(draft, REVISION)).toMatchObject({
        success: true,
        data: { protocol, apiKey: 'test-key' },
      });
    }
  );
  it('returns an actionable protocol error for an unsupported value', () => {
    const draft = textChannelToDraft(channel);
    Reflect.set(draft, 'protocol', 'unsupported-protocol');
    expect(validateTextChannelDraft(draft, REVISION, channel)).toEqual({
      success: false,
      errors: { protocol: 'Choose Chat Completions or Responses.' },
    });
  });
});

describe('channel credential and URL changes', () => {
  it('requires a key before enabling a new channel', () => {
    const draft = { ...textChannelToDraft(channel), enabled: true };
    expect(validateTextChannelDraft(draft, REVISION)).toMatchObject({
      success: false,
      errors: { apiKey: expect.any(String) },
    });
  });
  it('requires a new key when a saved credential would move to another base URL', () => {
    const draft = {
      ...textChannelToDraft(channel),
      baseUrl: 'https://other.example/v1',
    };
    expect(validateTextChannelDraft(draft, REVISION, channel)).toMatchObject({
      success: false,
      errors: { apiKey: expect.any(String) },
    });
    expect(
      validateTextChannelDraft(
        { ...draft, apiKey: 'test-only-new-key' },
        REVISION,
        channel
      ).success
    ).toBe(true);
  });
  it('normalizes trailing slashes before checking whether the base URL changed', () => {
    const draft = {
      ...textChannelToDraft(channel),
      baseUrl: channel.baseUrl + '/',
    };
    expect(validateTextChannelDraft(draft, REVISION, channel).success).toBe(
      true
    );
  });
  it.each([
    'http://provider.example/v1',
    'https://user:pass@provider.example/v1',
    'https://provider.example/v1?key=test',
  ])('rejects an unsafe base URL: %s', (baseUrl) => {
    expect(
      validateTextChannelDraft(
        { ...textChannelToDraft(channel), baseUrl },
        REVISION,
        channel
      ).success
    ).toBe(false);
  });
});

describe('explicit USD costs', () => {
  it('requires explicit costs instead of coercing empty prices to zero', () => {
    for (const field of [
      'inputPricePerMillion',
      'outputPricePerMillion',
    ] as const) {
      expect(validateModel(validModel({ [field]: '' }))).toMatchObject({
        success: false,
        errors: { [field]: expect.any(String) },
      });
    }
  });
  it('accepts explicit zero prices and preserves the USD values and captured revision', () => {
    const result = validateModel(
      validModel({ inputPricePerMillion: '0', outputPricePerMillion: '0' })
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        revision: REVISION,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
    });
  });
  it.each(['-1', 'Infinity', 'not-a-number'])(
    'rejects an invalid USD cost: %s',
    (value) => {
      expect(
        validateModel(validModel({ inputPricePerMillion: value })).success
      ).toBe(false);
    }
  );
});

describe('token limits and model identity', () => {
  it.each(['', '0', '1.5', 'Infinity'])(
    'requires a positive whole token limit: %s',
    (value) => {
      expect(validateModel(validModel({ contextWindow: value })).success).toBe(
        false
      );
    }
  );
  it('rejects output limits above the context window', () => {
    expect(
      validateModel(
        validModel({ contextWindow: '1000', maxOutputTokens: '1001' })
      )
    ).toMatchObject({ success: false });
  });
  it('requires a saved channel rather than submitting an arbitrary channel ID', () => {
    expect(
      validateModel(validModel({ channelId: 'missing-channel' }))
    ).toMatchObject({
      success: false,
      errors: { channelId: expect.any(String) },
    });
  });
  it('rejects an unknown unprefixed local ID and accepts a custom identifier', () => {
    expect(validateModel(validModel({ id: 'unknown-model' })).success).toBe(
      false
    );
    expect(validateModel(validModel({ id: 'custom:my/model-1' })).success).toBe(
      true
    );
  });
  it('blocks accidentally creating a duplicate while allowing an explicit edit', () => {
    expect(validateModel(validModel(), [savedModel])).toMatchObject({
      success: false,
      errors: { id: expect.any(String) },
    });
    expect(validateModel(validModel(), [savedModel], false).success).toBe(true);
  });
});

describe('conservative custom drafts', () => {
  it('keeps synced candidates disabled with no inferred capabilities, limits or prices', () => {
    const candidate = {
      name: 'Candidate',
      upstreamModel: 'vendor/candidate',
      vendor: 'Test vendor',
      enabled: true,
      vision: true,
      inputPricePerMillion: 10,
    };
    const draft = textCandidateToDraft(channel.id, candidate);
    expect(draft).toMatchObject({
      id: 'custom:',
      channelId: channel.id,
      name: 'Candidate',
      upstreamModel: candidate.upstreamModel,
      enabled: false,
      vision: false,
      structuredOutput: false,
      tools: false,
      contextWindow: '',
      maxOutputTokens: '',
      inputPricePerMillion: '',
      outputPricePerMillion: '',
    });
  });
  it('starts a manual custom draft conservatively', () => {
    expect(createTextModelDraft(channel.id)).toMatchObject({
      enabled: false,
      vision: false,
      tools: false,
      structuredOutput: false,
    });
  });
});

describe('built-in model requirements', () => {
  it('seeds built-in capability requirements without inferring limits or public prices', () => {
    const builtin = SCRIPT_ANALYSIS_MODELS[0];
    const draft = changeTextModelChoice(
      createTextModelDraft(channel.id),
      builtin.id
    );
    expect(draft).toMatchObject({
      id: builtin.id,
      vision: builtin.vision,
      structuredOutput: true,
      tools: true,
      enabled: false,
      contextWindow: '',
      maxOutputTokens: '',
      inputPricePerMillion: '',
      outputPricePerMillion: '',
    });
    expect(
      changeTextModelChoice(draft, CUSTOM_TEXT_MODEL_OPTION)
    ).toMatchObject({
      id: 'custom:',
      vision: false,
      structuredOutput: false,
      tools: false,
    });
  });
  it('disables already-bound built-in IDs for new entries but keeps the edited ID available', () => {
    const id = SCRIPT_ANALYSIS_MODELS[0].id;
    const models: ChannelTextModel[] = [{ ...savedModel, id }];
    expect(
      builtinTextModelOptions(models).find((option) => option.value === id)
        ?.disabled
    ).toBe(true);
    expect(
      builtinTextModelOptions(models, id).find((option) => option.value === id)
        ?.disabled
    ).toBe(false);
  });
});

describe('optional model metadata', () => {
  it('omits blank optional metadata and preserves stored rates when editing', () => {
    const result = validateModel(
      validModel({ vendor: '  ', description: '  ' })
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        vendor: undefined,
        description: undefined,
        inputPricePerMillion: savedModel.inputPricePerMillion,
        outputPricePerMillion: savedModel.outputPricePerMillion,
      },
    });
  });
});
