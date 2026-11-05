import type { TokenUsage } from '@tanstack/ai';
import type { LlmKeyInfo } from './create-adapter';
import type { TextChannelProtocol, TextModelRoute } from '../text-channels';
import { TEXT_CHANNEL_PROTOCOLS } from '../text-channels';

export const CONFIGURED_TEXT_SDK_RETRIES = 0;
const TEST_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MOCK_HOST_SUFFIX = '.invalid';

export function assertConfiguredTextTestHost(
  baseUrl: string,
  testMode?: string
): void {
  if (testMode !== 'true') return;
  const hostname = new URL(baseUrl).hostname;
  if (TEST_LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(MOCK_HOST_SUFFIX))
    return;
  throw new Error(
    'Configured text channels require a mock or loopback URL during E2E tests.'
  );
}

const TOKENS_PER_MILLION = 1_000_000;
const OUTPUT_CONTEXT_FRACTION = 0.5;

type SamplingOptions = {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
};

export function configuredTextApi(protocol: TextChannelProtocol) {
  return protocol === TEXT_CHANNEL_PROTOCOLS.responses
    ? 'responses'
    : 'chat-completions';
}

export function configuredTextModelOptions(
  route: TextModelRoute,
  options: SamplingOptions = {}
) {
  const ceiling = Math.min(route.maxOutputTokens, route.contextWindow);
  const requested =
    options.max_tokens ??
    Math.floor(route.contextWindow * OUTPUT_CONTEXT_FRACTION);
  const maxTokens = Math.max(1, Math.min(requested, ceiling));
  const sampling = {
    ...(options.temperature !== undefined && {
      temperature: options.temperature,
    }),
    ...(options.top_p !== undefined && { top_p: options.top_p }),
  };
  if (route.protocol === TEXT_CHANNEL_PROTOCOLS.responses) {
    return { max_output_tokens: maxTokens, ...sampling };
  }
  return {
    max_tokens: maxTokens,
    stream_options: { include_usage: true },
    ...sampling,
    ...(options.frequency_penalty !== undefined && {
      frequency_penalty: options.frequency_penalty,
    }),
    ...(options.presence_penalty !== undefined && {
      presence_penalty: options.presence_penalty,
    }),
  };
}

export function assertConfiguredTextCapabilities(
  key: LlmKeyInfo | undefined,
  required: { structuredOutput?: boolean; vision?: boolean; tools?: boolean }
): void {
  if (key?.via !== 'compatible') return;
  for (const capability of ['structuredOutput', 'vision', 'tools'] as const) {
    if (required[capability] && !key.route[capability]) {
      throw new Error(
        'Configured text model does not support the required capability: ' +
          capability
      );
    }
  }
}

export function configuredTextCostUsd(
  usage: TokenUsage | undefined,
  route: TextModelRoute
): number | undefined {
  if (!usage) return undefined;
  const counts = [usage.promptTokens, usage.completionTokens];
  if (counts.some((count) => !Number.isFinite(count) || count < 0))
    return undefined;
  return (
    (usage.promptTokens * route.inputPricePerMillion +
      usage.completionTokens * route.outputPricePerMillion) /
    TOKENS_PER_MILLION
  );
}

export function configuredTextUsage(
  usage: TokenUsage | undefined,
  key: LlmKeyInfo | undefined
): TokenUsage | undefined {
  if (!usage || key?.via !== 'compatible') return usage;
  return { ...usage, cost: configuredTextCostUsd(usage, key.route) };
}
