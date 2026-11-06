import type { TextModel } from '@/models/models';
import type { ResolvedLlmKey } from './db/api-keys';
import { withLlmAuthFailureStream } from './llm-auth-failure-stream';
import {
  extractRunError,
  regionRetriesFor,
  throwNotedRunError,
} from './llm-client';

// Finish the provider stream before surfacing RUN_ERROR so its span can close.
async function* drainCall<T>(
  model: TextModel,
  key: ResolvedLlmKey,
  call: () => AsyncIterable<T>
): AsyncGenerator<T> {
  let runError: ReturnType<typeof extractRunError> = null;
  for await (const event of call()) {
    runError ??= extractRunError(event);
    yield event;
  }
  throwNotedRunError(runError, regionRetriesFor(model, key));
}

// Only provider creation, iteration and RUN_ERROR carry a credential source.
export function llmCallStream<T>(
  model: TextModel,
  key: ResolvedLlmKey,
  call: () => AsyncIterable<T>
): AsyncGenerator<T> {
  return withLlmAuthFailureStream(model, key, drainCall(model, key, call));
}
