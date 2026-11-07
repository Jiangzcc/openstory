import type { ZodIssue } from 'zod';
import { SCRIPT_ANALYSIS_MODELS } from '@/models/models.config';
import {
  saveChannelTextModelSchema,
  saveTextChannelSchema,
  TEXT_CHANNEL_PROTOCOL,
} from '@/models/text-channels';
import type {
  ChannelTextModel,
  SaveChannelTextModelInput,
  SaveTextChannelInput,
  TextChannel,
  TextChannelModelCandidate,
} from '@/models/text-channels';

export const CUSTOM_TEXT_MODEL_PREFIX = 'custom:';
export const CUSTOM_TEXT_MODEL_OPTION = '__custom_text_model__';
export const MIN_TEXT_MODEL_TOKENS = 1;
export const MIN_TEXT_MODEL_PRICE = 0;
export const TEXT_MODEL_TOKEN_STEP = 1;
const BUILTIN_TEXT_MODEL_OPTIONS = SCRIPT_ANALYSIS_MODELS.map(
  ({ id, name }) => ({ value: id, label: name })
);

export type TextChannelDraft = Omit<
  SaveTextChannelInput,
  'revision' | 'apiKey' | 'userAgent'
> & {
  apiKey: string;
  userAgent: string;
};
export type TextModelDraft = Omit<
  ChannelTextModel,
  | 'id'
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'inputPricePerMillion'
  | 'outputPricePerMillion'
> & {
  id: string;
  contextWindow: string;
  maxOutputTokens: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
};
export type TextChannelFieldErrors = Record<string, string>;
type DraftValidation<T> =
  | { success: true; data: T }
  | { success: false; errors: TextChannelFieldErrors };

const CHANNEL_FIELD_MESSAGES = {
  id: 'Choose a valid channel identifier.',
  name: 'Enter a channel name.',
  baseUrl:
    'Use HTTPS, or HTTP on localhost, without credentials, query or fragment.',
  protocol: 'Choose Chat Completions or Responses.',
  apiKey: 'Enter a valid API key without line breaks.',
  userAgent:
    'Use up to 256 printable ASCII characters for User-Agent, or leave it blank.',
} satisfies Record<string, string>;
const MODEL_FIELD_MESSAGES = {
  id: 'Choose a built-in model or enter a valid custom model ID.',
  name: 'Enter a model name.',
  channelId: 'Choose a saved channel.',
  upstreamModel: 'Enter the exact upstream model ID.',
  contextWindow: 'Token limits must be positive whole numbers.',
  maxOutputTokens: 'Token limits must be positive whole numbers.',
  inputPricePerMillion: 'Enter an explicit nonnegative USD price.',
  outputPricePerMillion: 'Enter an explicit nonnegative USD price.',
  vendor: 'Enter a valid vendor name or leave it blank.',
  description: 'The description is too long.',
} satisfies Record<string, string>;
const FORM_VALIDATION_MESSAGES = new Set([
  'Maximum output tokens must not exceed the context window.',
  'Built-in text model bindings must preserve structured output, tools, and vision support.',
]);

export function createTextChannelDraft(): TextChannelDraft {
  return {
    id: 'channel-' + crypto.randomUUID(),
    name: '',
    baseUrl: '',
    protocol: TEXT_CHANNEL_PROTOCOL,
    enabled: false,
    apiKey: '',
    userAgent: '',
  };
}

export function textChannelToDraft(channel: TextChannel): TextChannelDraft {
  const { id, name, baseUrl, protocol, enabled, userAgent } = channel;
  return {
    id,
    name,
    baseUrl,
    protocol,
    enabled,
    apiKey: '',
    userAgent: userAgent ?? '',
  };
}

export function createTextModelDraft(channelId = ''): TextModelDraft {
  return {
    id: CUSTOM_TEXT_MODEL_PREFIX,
    name: '',
    channelId,
    upstreamModel: '',
    enabled: false,
    vision: false,
    structuredOutput: false,
    tools: false,
    contextWindow: '',
    maxOutputTokens: '',
    inputPricePerMillion: '',
    outputPricePerMillion: '',
    vendor: '',
    description: '',
  };
}

export function textModelToDraft(model: ChannelTextModel): TextModelDraft {
  return {
    ...model,
    contextWindow: String(model.contextWindow),
    maxOutputTokens: String(model.maxOutputTokens),
    inputPricePerMillion: String(model.inputPricePerMillion),
    outputPricePerMillion: String(model.outputPricePerMillion),
    vendor: model.vendor ?? '',
    description: model.description ?? '',
  };
}

export function textCandidateToDraft(
  channelId: string,
  candidate: TextChannelModelCandidate
): TextModelDraft {
  return {
    ...createTextModelDraft(channelId),
    name: candidate.name,
    upstreamModel: candidate.upstreamModel,
    vendor: candidate.vendor ?? '',
    description: candidate.description ?? '',
  };
}

export function textModelChoice(draft: TextModelDraft): string {
  return draft.id.startsWith(CUSTOM_TEXT_MODEL_PREFIX)
    ? CUSTOM_TEXT_MODEL_OPTION
    : draft.id;
}

export function changeTextModelChoice(
  draft: TextModelDraft,
  choice: string
): TextModelDraft {
  const id =
    choice === CUSTOM_TEXT_MODEL_OPTION ? CUSTOM_TEXT_MODEL_PREFIX : choice;
  return { ...draft, id, ...requiredBuiltinTextCapabilities(id) };
}

function validationErrors(
  issues: ZodIssue[],
  messages: Record<string, string>
) {
  const errors: TextChannelFieldErrors = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    errors[field] = FORM_VALIDATION_MESSAGES.has(issue.message)
      ? issue.message
      : (messages[field] ?? 'Check the form fields and try again.');
  }
  return errors;
}

export function validateTextChannelDraft(
  draft: TextChannelDraft,
  revision: number,
  saved?: TextChannel
): DraftValidation<SaveTextChannelInput> {
  const apiKey = draft.apiKey.trim();
  const result = saveTextChannelSchema.safeParse({
    ...draft,
    revision,
    apiKey: apiKey || undefined,
  });
  if (!result.success)
    return {
      success: false,
      errors: validationErrors(result.error.issues, CHANNEL_FIELD_MESSAGES),
    };
  const apiKeyError = channelCredentialError(result.data, saved);
  if (apiKeyError) return { success: false, errors: { apiKey: apiKeyError } };
  return { success: true, data: result.data };
}

function channelCredentialError(
  input: SaveTextChannelInput,
  saved?: TextChannel
) {
  if (input.apiKey) return undefined;
  if (input.enabled && !saved?.hasKey)
    return 'Add an API key before enabling this channel.';
  if (saved?.hasKey && input.baseUrl !== saved.baseUrl)
    return 'Enter a new API key when changing the base URL.';
  return undefined;
}

function draftNumber(value: string) {
  return value.trim() === '' ? Number.NaN : Number(value);
}

export function validateTextModelDraft(
  draft: TextModelDraft,
  revision: number,
  channels: readonly TextChannel[],
  existingModels: readonly ChannelTextModel[],
  isNew: boolean
): DraftValidation<SaveChannelTextModelInput> {
  if (!channels.some((channel) => channel.id === draft.channelId))
    return {
      success: false,
      errors: { channelId: MODEL_FIELD_MESSAGES.channelId },
    };
  if (isNew && existingModels.some((model) => model.id === draft.id.trim()))
    return {
      success: false,
      errors: {
        id: 'This model already has a binding. Edit the saved binding.',
      },
    };
  const result = saveChannelTextModelSchema.safeParse({
    ...draft,
    revision,
    contextWindow: draftNumber(draft.contextWindow),
    maxOutputTokens: draftNumber(draft.maxOutputTokens),
    inputPricePerMillion: draftNumber(draft.inputPricePerMillion),
    outputPricePerMillion: draftNumber(draft.outputPricePerMillion),
    vendor: draft.vendor?.trim() || undefined,
    description: draft.description?.trim() || undefined,
  });
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        errors: validationErrors(result.error.issues, MODEL_FIELD_MESSAGES),
      };
}

export function builtinTextModelOptions(
  models: readonly ChannelTextModel[],
  currentId?: string
) {
  const boundIds = new Set(models.map((model) => model.id));
  return BUILTIN_TEXT_MODEL_OPTIONS.map((option) => ({
    ...option,
    disabled: option.value !== currentId && boundIds.has(option.value),
  }));
}

export function requiredBuiltinTextCapabilities(id: string) {
  const builtin = SCRIPT_ANALYSIS_MODELS.find((model) => model.id === id);
  return {
    vision: builtin?.vision ?? false,
    structuredOutput: !!builtin,
    tools: !!builtin,
  };
}
