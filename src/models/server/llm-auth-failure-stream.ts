import type { ResolvedLlmKey } from './db/api-keys';
import { withLlmAuthFailureSource } from '@/platform/server/workflow/llm-auth-failure-source';

// The stream must keep the resolved team credential across any region retry.
export async function* withLlmAuthFailureStream<T>(
  model: string,
  key: ResolvedLlmKey,
  stream: AsyncIterable<T>
): AsyncGenerator<T> {
  try {
    yield* stream;
  } catch (error) {
    // Platform Google retries can change via internally; no team key was spent.
    if (key.source === 'platform') throw error;
    throw withLlmAuthFailureSource(error, {
      model,
      source: key.source,
      via: key.via,
    });
  }
}
