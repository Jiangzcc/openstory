import { nativeGeminiTextModel } from '@/models/gemini-native';
import { isGoogleRegionBlockedHere } from '@/models/google-region';
import { nativeGrokTextModel } from '@/models/grok-native';
import { llmtrTextModel } from '@/models/llmtr';
import {
  isCustomTextModelId,
  resolveTextModelRoute,
} from '@/models/text-channels';
import type { TextModelRoutingSnapshot } from '@/models/text-channels';
import { getPlatformLlmKey } from './create-adapter';
import type { ResolvedLlmKey } from './db/api-keys';

type TeamLlmProvider = Exclude<ResolvedLlmKey['via'], 'compatible'>;
export type TeamLlmKeyLookup = { key: string } | { skippedReason?: string };
type TeamKeyReader = (provider: TeamLlmProvider) => Promise<TeamLlmKeyLookup>;
type TeamKeyResult = {
  resolved?: { key: string; source: 'team'; via: TeamLlmProvider };
  fallbackReason?: string;
};
type RoutingCredentials = {
  teamKey: TeamKeyReader;
  channelSecret: (credentialId: string) => Promise<string>;
};

function teamProviders(model: string | undefined): TeamLlmProvider[] {
  const providers: TeamLlmProvider[] = [];
  if (model && nativeGrokTextModel(model)) providers.push('xai');
  if (model && nativeGeminiTextModel(model) && !isGoogleRegionBlockedHere()) {
    providers.push('google');
  }
  if (model && llmtrTextModel(model)) providers.push('llmtr');
  return [...providers, 'openrouter', 'fal'];
}

async function findTeamKey(
  model: string | undefined,
  read: TeamKeyReader
): Promise<TeamKeyResult> {
  let fallbackReason: string | undefined;
  for (const via of teamProviders(model)) {
    const result = await read(via);
    if ('key' in result) {
      return { resolved: { key: result.key, source: 'team', via } };
    }
    fallbackReason ??= result.skippedReason;
  }
  return { fallbackReason };
}

export async function resolveLlmKeyForModel(
  model: string | undefined,
  routing: TextModelRoutingSnapshot,
  credentials: RoutingCredentials
): Promise<ResolvedLlmKey> {
  const route = model ? resolveTextModelRoute(routing, model) : undefined;
  const team = isCustomTextModelId(model)
    ? {}
    : await findTeamKey(model, credentials.teamKey);
  if (team.resolved) return team.resolved;
  if (route) {
    const key = await credentials.channelSecret(route.credentialId);
    return { key, source: 'platform', via: 'compatible', route };
  }
  const platform = getPlatformLlmKey(model);
  if (!platform) {
    throw new Error(
      'No platform LLM key available (set OPENROUTER_KEY or FAL_KEY)'
    );
  }
  return { ...platform, fallbackReason: team.fallbackReason };
}
