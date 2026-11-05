import type { ResolvedLlmKey } from '@/models/server/db/api-keys';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { readLlmAuthFailureSource } from './llm-auth-failure-source';

// A model alone cannot prove which credential a failed call actually spent.
export async function handleLlmAuthFailure(
  scopedDb: WorkflowScopedDb,
  error: string,
  _model?: string
): Promise<string | undefined> {
  const failure = readLlmAuthFailureSource(error);
  if (failure?.source !== 'organization' || failure.via === 'compatible')
    return undefined;

  await scopedDb.apiKeys.markKeyInvalid(failure.via, failure.message);
  return (
    'Your ' +
    LLM_KEY_LABELS[failure.via] +
    ' API key is invalid — update it in Settings.'
  );
}

const LLM_KEY_LABELS: Record<
  Exclude<ResolvedLlmKey['via'], 'compatible'>,
  string
> = {
  openrouter: 'OpenRouter',
  fal: 'fal.ai',
  xai: 'xAI',
  google: 'Google',
  llmtr: 'LLMTR',
};
