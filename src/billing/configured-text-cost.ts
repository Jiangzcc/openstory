import type { TokenUsage } from '@tanstack/ai';
import type { TextModelRoute } from '@/models/text-channels';

const TOKENS_PER_MILLION = 1_000_000;

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
