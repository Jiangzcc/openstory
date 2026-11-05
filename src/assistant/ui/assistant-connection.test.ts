import { ChatClient } from '@tanstack/ai-react';
import { EventType } from '@tanstack/ai';
import type { StreamChunk } from '@tanstack/ai';
import { afterEach, expect, it, vi } from 'vitest';
import { isInsufficientCreditsError } from '@/platform/errors';
import { createAssistantConnection } from './assistant-connection';
import { startAssistantThread } from './assistant-store';

vi.mock('./assistant-store', () => ({ startAssistantThread: vi.fn() }));

const context = { threadId: 'thread-1', runId: 'run-1' };
const creditError = {
  name: 'InsufficientCreditsError',
  message: 'Add credits to chat with the assistant.',
  code: 'INSUFFICIENT_CREDITS',
  statusCode: 402,
};

function deniedResponse(status: number, error = creditError) {
  return Response.json({ success: false, error }, { status });
}

async function collect(chunks: AsyncIterable<StreamChunk>) {
  const results: StreamChunk[] = [];
  for await (const chunk of chunks) results.push(chunk);
  return results;
}

function send(connection: ReturnType<typeof createAssistantConnection>) {
  return collect(connection.connect([], undefined, undefined, context));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('preserves the 402 message, code and status instead of a stream read error', async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(deniedResponse(402));
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({
    message: creditError.message,
    code: creditError.code,
    statusCode: 402,
  });
  expect(fetchClient).toHaveBeenCalledTimes(1);
});

it('passes the recognizable billing error to the actual chat client', async () => {
  const onError = vi.fn();
  const client = new ChatClient({
    threadId: context.threadId,
    connection: createAssistantConnection(
      vi.fn<typeof fetch>().mockResolvedValue(deniedResponse(402))
    ),
    onError,
  });
  await client.sendMessage('Hello');
  expect(onError).toHaveBeenCalledOnce();
  expect(isInsufficientCreditsError(onError.mock.calls[0]?.[0])).toBe(true);
  expect(onError.mock.calls[0]?.[0]).toMatchObject({
    message: creditError.message,
    statusCode: 402,
  });
});

function sseResponse(chunks: StreamChunk[], durable = false, offset = 0) {
  const body = chunks
    .map(
      (chunk, index) =>
        (durable ? 'id: ' + (index + offset) + '\n' : '') +
        'data: ' +
        JSON.stringify(chunk) +
        '\n\n'
    )
    .join('');
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const started: StreamChunk = {
  type: EventType.RUN_STARTED,
  ...context,
  timestamp: 1,
};
const finished: StreamChunk = {
  type: EventType.RUN_FINISHED,
  ...context,
  timestamp: 2,
  finishReason: 'stop',
};

it.each([
  [401, 'UNAUTHENTICATED', 'Please sign in.'],
  [403, 'FORBIDDEN', 'Access denied.'],
  [400, 'VALIDATION_ERROR', 'This model cannot read images.'],
  [429, 'RATE_LIMITED', 'Try again later.'],
  [500, 'INTERNAL_ERROR', 'An internal error occurred.'],
])(
  'preserves an HTTP %s business error without retrying it as a read failure',
  async (status, code, message) => {
    const response = deniedResponse(status, {
      name: 'Error',
      code,
      message,
      statusCode: status,
    });
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      send(createAssistantConnection(fetchClient))
    ).rejects.toMatchObject({ code, message, statusCode: status });
    expect(fetchClient).toHaveBeenCalledTimes(1);
    expect(startAssistantThread).not.toHaveBeenCalled();
  }
);

it.each([
  '<html>Proxy failed</html>',
  '',
  '{bad-json',
  '{"success":false}',
  '{"error":{"message":12}}',
])(
  'retains the HTTP status for an invalid error envelope: %s',
  async (body) => {
    const response = new Response(body, { status: 502 });
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      send(createAssistantConnection(fetchClient))
    ).rejects.toMatchObject({
      message: 'Request failed (502)',
      code: 'ASSISTANT_REQUEST_ERROR',
      statusCode: 502,
    });
  }
);

it('uses the HTTP status instead of trusting a conflicting body status', async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      deniedResponse(402, { ...creditError, statusCode: 200 })
    );
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({ statusCode: 402 });
});

it('starts a new thread only for a missing thread response', async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
    deniedResponse(404, {
      name: 'Error',
      code: 'THREAD_NOT_FOUND',
      message: 'No such thread.',
      statusCode: 404,
    })
  );
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({ code: 'THREAD_NOT_FOUND' });
  expect(startAssistantThread).toHaveBeenCalledTimes(1);
});

it('does not reset the thread for an unrelated 404', async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
    deniedResponse(404, {
      name: 'Error',
      code: 'NOT_FOUND',
      message: 'No such asset.',
      statusCode: 404,
    })
  );
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(startAssistantThread).not.toHaveBeenCalled();
});

it('preserves successful SSE and the SDK request context', async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(sseResponse([started, finished]));
  const connection = createAssistantConnection(fetchClient);
  await expect(
    collect(connection.connect([], { model: 'custom:glm' }, undefined, context))
  ).resolves.toEqual([started, finished]);
  const request = fetchClient.mock.calls[0];
  expect(request).toBeDefined();
  const [url, init] = request ?? [];
  expect(url).toBe('/api/assistant/chat');
  expect(init?.method).toBe('POST');
  const body = init?.body;
  if (typeof body !== 'string')
    throw new TypeError('Expected a JSON request body.');
  expect(JSON.parse(body)).toMatchObject({
    ...context,
    forwardedProps: { model: 'custom:glm' },
  });
});

it('preserves errors returned inside an established stream', async () => {
  const chunk: StreamChunk = {
    type: EventType.RUN_ERROR,
    message: 'Provider failed.',
    code: 'PROVIDER_ERROR',
    timestamp: 2,
  };
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(sseResponse([started, chunk]));
  await expect(send(createAssistantConnection(fetchClient))).resolves.toEqual([
    started,
    chunk,
  ]);
});

it('preserves real fetch failures as transport failures', async () => {
  const offline = new Error('Offline');
  const fetchClient = vi.fn<typeof fetch>().mockRejectedValue(offline);
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({ name: 'StreamReadError', cause: offline });
});

it('preserves a real response body read failure', async () => {
  const broken = new Error('Connection lost');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(broken);
    },
  });
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    );
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({ name: 'StreamReadError', cause: broken });
});

it('does not retry a permanent HTTP rejection after a durable stream reconnect', async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(sseResponse([started], true))
    .mockResolvedValue(deniedResponse(402));
  await expect(
    send(createAssistantConnection(fetchClient))
  ).rejects.toMatchObject({
    code: creditError.code,
    message: creditError.message,
  });
  expect(fetchClient).toHaveBeenCalledTimes(2);
  expect(fetchClient.mock.calls[1]?.[1]?.headers).toMatchObject({
    'Last-Event-ID': '0',
  });
});

it('retains SDK recovery from a temporary HTTP failure and clears its error', async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(sseResponse([started], true))
    .mockResolvedValueOnce(
      new Response('Temporarily unavailable', {
        status: 503,
        headers: { 'Retry-After': '0' },
      })
    )
    .mockResolvedValueOnce(sseResponse([finished], true, 1));
  await expect(send(createAssistantConnection(fetchClient))).resolves.toEqual([
    started,
    finished,
  ]);
  expect(fetchClient).toHaveBeenCalledTimes(3);
});

it('hydrates history and keeps pagination arguments', async () => {
  const history = { messages: [], activeRun: null, interrupts: null };
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(history));
  await expect(
    createAssistantConnection(fetchClient).hydrate('thread-1', {
      limit: 10,
      before: 'message-1',
    })
  ).resolves.toMatchObject(history);
  const url = requestUrl(fetchClient.mock.calls[0]?.[0]);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    threadId: 'thread-1',
    limit: '10',
    before: 'message-1',
  });
});

it('reports structured errors during hydration and resets an inaccessible thread', async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
    deniedResponse(404, {
      name: 'Error',
      code: 'THREAD_NOT_FOUND',
      message: 'No such thread.',
      statusCode: 404,
    })
  );
  await expect(
    createAssistantConnection(fetchClient).hydrate('thread-1')
  ).rejects.toMatchObject({ code: 'THREAD_NOT_FOUND', statusCode: 404 });
  expect(startAssistantThread).toHaveBeenCalledTimes(1);
});

it('keeps the join URL and successful replay', async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(sseResponse([started, finished]));
  await expect(
    collect(createAssistantConnection(fetchClient).joinRun('run-1'))
  ).resolves.toEqual([started, finished]);
  const url = requestUrl(fetchClient.mock.calls[0]?.[0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    runId: 'run-1',
    offset: '-1',
  });
  expect(fetchClient.mock.calls[0]?.[1]?.method).toBe('GET');
});

it('reports structured errors on joining a run', async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
    deniedResponse(403, {
      name: 'Error',
      code: 'FORBIDDEN',
      message: 'This run is not yours.',
      statusCode: 403,
    })
  );
  await expect(
    collect(createAssistantConnection(fetchClient).joinRun('run-1'))
  ).rejects.toMatchObject({
    code: 'FORBIDDEN',
    statusCode: 403,
    message: 'This run is not yours.',
  });
  expect(fetchClient).toHaveBeenCalledTimes(1);
});

it('keeps concurrent operation errors isolated', async () => {
  const history = { messages: [], activeRun: null, interrupts: null };
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_input, init) =>
      init?.method === 'POST' ? deniedResponse(402) : Response.json(history)
    );
  const connection = createAssistantConnection(fetchClient);
  await Promise.all([
    expect(send(connection)).rejects.toMatchObject({
      code: creditError.code,
    }),
    expect(connection.hydrate('thread-2')).resolves.toMatchObject(history),
  ]);
});

function requestUrl(input: unknown): URL {
  if (typeof input !== 'string') throw new TypeError('Expected a URL string.');
  return new URL(input, 'https://example.test');
}
