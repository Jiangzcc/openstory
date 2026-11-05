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

type OrganizationLlmProvider = Exclude<ResolvedLlmKey['via'], 'compatible'>;
export type OrganizationLlmKeyLookup =
  | { key: string }
  | { skippedReason?: string };
type OrganizationKeyReader = (
  provider: OrganizationLlmProvider
) => Promise<OrganizationLlmKeyLookup>;
type OrganizationKeyResult = {
  resolved?: {
    key: string;
    source: 'organization';
    via: OrganizationLlmProvider;
  };
  fallbackReason?: string;
};
type RoutingCredentials = {
  organizationKey: OrganizationKeyReader;
  channelSecret: (credentialId: string) => Promise<string>;
};

function organizationProviders(
  model: string | undefined
): OrganizationLlmProvider[] {
  const providers: OrganizationLlmProvider[] = [];
  if (model && nativeGrokTextModel(model)) providers.push('xai');
  if (model && nativeGeminiTextModel(model) && !isGoogleRegionBlockedHere()) {
    providers.push('google');
  }
  if (model && llmtrTextModel(model)) providers.push('llmtr');
  return [...providers, 'openrouter', 'fal'];
}

async function findOrganizationKey(
  model: string | undefined,
  read: OrganizationKeyReader
): Promise<OrganizationKeyResult> {
  let fallbackReason: string | undefined;
  for (const via of organizationProviders(model)) {
    const result = await read(via);
    if ('key' in result) {
      return { resolved: { key: result.key, source: 'organization', via } };
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
  const organization = isCustomTextModelId(model)
    ? {}
    : await findOrganizationKey(model, credentials.organizationKey);
  if (organization.resolved) return organization.resolved;
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
  return { ...platform, fallbackReason: organization.fallbackReason };
}
