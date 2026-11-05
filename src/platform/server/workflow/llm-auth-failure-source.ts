import type { ResolvedLlmKey } from '@/models/server/db/api-keys';

export type LlmAuthFailureSource = {
  model: string;
  source: ResolvedLlmKey['source'];
  via: ResolvedLlmKey['via'];
};

const UNAUTHORIZED_STATUS = 401;
const SOURCE_PREFIX = '[llm-auth:v1:';
const SOURCE_PATTERN =
  /^(?:\w*Error:\s*)*\[llm-auth:v1:(organization|team|platform):(openrouter|fal|xai|google|llmtr|compatible):([^\]\s]+)\] /;
const KEY_VIAS = [
  'openrouter',
  'fal',
  'xai',
  'google',
  'llmtr',
  'compatible',
] as const;

const HTTP_STATUS_PATTERNS = [
  /^LLM stream error \[(\d{3})(?:,|\])/i,
  /\bHTTP(?: error)?[ :]*(\d{3})\b/i,
  /\b(\d{3})[ :]+unauthori[sz]ed\b/i,
  /\b(?:status|code)[=: ]+(\d{3})\b/i,
];

function unauthorized(error: Error): boolean {
  if ('status' in error && typeof error.status === 'number') {
    return error.status === UNAUTHORIZED_STATUS;
  }
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode === UNAUTHORIZED_STATUS;
  }
  const match = HTTP_STATUS_PATTERNS.map((pattern) =>
    pattern.exec(error.message)
  ).find(Boolean);
  return Number(match?.[1]) === UNAUTHORIZED_STATUS;
}

// Only the message survives durable steps and parent failure notifications.
export function withLlmAuthFailureSource(
  error: unknown,
  context: LlmAuthFailureSource
): unknown {
  if (!(error instanceof Error) || !unauthorized(error)) return error;
  const prefix =
    SOURCE_PREFIX +
    context.source +
    ':' +
    context.via +
    ':' +
    encodeURIComponent(context.model) +
    '] ';
  const attributed = new Error(prefix + error.message, { cause: error });
  attributed.name = error.name;
  return attributed;
}

export function readLlmAuthFailureSource(
  message: string
): (LlmAuthFailureSource & { message: string }) | undefined {
  const match = SOURCE_PATTERN.exec(message);
  if (!match) return undefined;
  const source = match[1] === 'team' ? 'organization' : match[1];
  const via = KEY_VIAS.find((candidate) => candidate === match[2]);
  const encodedModel = match[3];
  if (
    !via ||
    !encodedModel ||
    (source !== 'organization' && source !== 'platform')
  )
    return undefined;
  if (source === 'organization' && via === 'compatible') return undefined;
  try {
    const model = decodeURIComponent(encodedModel);
    if (!model) return undefined;
    return { model, source, via, message: message.slice(match[0].length) };
  } catch {
    return undefined;
  }
}

export function llmAuthFailureMessage(message: string): string {
  return readLlmAuthFailureSource(message)?.message ?? message;
}
