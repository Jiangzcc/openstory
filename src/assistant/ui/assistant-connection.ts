import { fetchServerSentEvents } from '@tanstack/ai-react';
import type { StreamChunk } from '@tanstack/ai';
import { z } from 'zod';
import { OpenStoryError } from '@/platform/errors';
import { startAssistantThread } from './assistant-store';

const ASSISTANT_CHAT_URL = '/api/assistant/chat';
const REQUEST_ERROR_CODE = 'ASSISTANT_REQUEST_ERROR';
const THREAD_NOT_FOUND_CODE = 'THREAD_NOT_FOUND';
const NOT_FOUND_STATUS = 404;
type AssistantConnection = Required<ReturnType<typeof fetchServerSentEvents>>;

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
  }),
});

async function errorFromBody(response: Response): Promise<OpenStoryError> {
  // Proxies may return HTML or an empty body; retain the HTTP status then.
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(body);
  const error = new OpenStoryError(
    (parsed.success && parsed.data.error.message) ||
      `Request failed (${response.status})`,
    (parsed.success && parsed.data.error.code) || REQUEST_ERROR_CODE,
    response.status
  );
  if (
    error.statusCode === NOT_FOUND_STATUS &&
    error.code === THREAD_NOT_FOUND_CODE
  ) {
    startAssistantThread();
  }
  return error;
}

function requestConnection(fetchClient: typeof fetch) {
  let serverError: OpenStoryError | undefined;
  const connection = fetchServerSentEvents(ASSISTANT_CHAT_URL, {
    fetchClient: async (input, init) => {
      serverError = undefined;
      const response = await fetchClient(input, init);
      if (!response.ok) serverError = await errorFromBody(response);
      return response;
    },
  });
  const { hydrate, hydrateGeneration } = connection;
  if (!hydrate || !hydrateGeneration) {
    throw new Error('The assistant requires server-driven hydration.');
  }
  return {
    connection: { ...connection, hydrate, hydrateGeneration },
    error: () => serverError,
  };
}

async function* streamRequest(
  fetchClient: typeof fetch,
  read: (connection: AssistantConnection) => AsyncIterable<StreamChunk>
): AsyncGenerator<StreamChunk> {
  const request = requestConnection(fetchClient);
  try {
    yield* read(request.connection);
  } catch (error) {
    throw request.error() ?? error;
  }
}

async function jsonRequest<T>(
  fetchClient: typeof fetch,
  read: (connection: AssistantConnection) => Promise<T>
): Promise<T> {
  const request = requestConnection(fetchClient);
  try {
    return await read(request.connection);
  } catch (error) {
    throw request.error() ?? error;
  }
}

// Preserve HTTP responses for SDK retry decisions, then restore API errors.
export function createAssistantConnection(
  fetchClient: typeof fetch = fetch
): AssistantConnection {
  return {
    connect: (...args) =>
      streamRequest(fetchClient, (connection) => connection.connect(...args)),
    joinRun: (...args) =>
      streamRequest(fetchClient, (connection) => connection.joinRun(...args)),
    hydrate: (...args) =>
      jsonRequest(fetchClient, (connection) => connection.hydrate(...args)),
    hydrateGeneration: (...args) =>
      jsonRequest(fetchClient, (connection) =>
        connection.hydrateGeneration(...args)
      ),
  };
}
