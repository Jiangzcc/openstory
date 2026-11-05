import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, toolDefinition } from '@tanstack/ai';
import type { StreamChunk } from '@tanstack/ai';
import { z } from 'zod';
import { TEXT_CHANNEL_PROTOCOLS } from '@/models/text-channels';
import type {
  TextChannelProtocol,
  TextModelRoute,
} from '@/models/text-channels';
import { createAdapter } from './create-adapter';
import { configuredTextModelOptions } from './configured-text';

// Only environment and HTTP transport are mocked; chat, adapters and SSE parsing are real.
vi.mock('#env', () => ({
  getEnv: () => ({
    E2E_TEST: 'true',
    OPENROUTER_KEY: 'mock-unused-openrouter-key',
    FAL_KEY: 'mock-unused-fal-key',
    XAI_API_KEY: 'mock-unused-xai-key',
    GEMINI_API_KEY: 'mock-unused-google-key',
    VITE_APP_URL: 'http://localhost:3000',
    VITE_APP_NAME: 'Mock text protocol tests',
  }),
}));

const BASE_URL = 'https://configured-protocol.invalid/gateway/v1';
const API_KEY = 'mock-configured-protocol-secret';
const MODEL_ID = 'custom:configured-protocol-test';
const UPSTREAM_MODEL = 'mock-upstream-deployment';
const THREAD_ID = 'mock-protocol-thread';
const PROMPT = 'Describe the mock scene.';
const SYSTEM_PROMPT = 'Return only the requested mock scene.';
const TEXT_DELTAS = ['本地 ', 'mock 输出'];
const RESULT_TEXT = TEXT_DELTAS.join('');
const RESPONSE_ID = 'resp_mock_protocol';
const MESSAGE_ID = 'msg_mock_protocol';
const CREATED_AT = 1_700_000_000;
const STREAM_CHUNK_BYTES = 11;
const CONTEXT_WINDOW = 8_000;
const MAX_OUTPUT_TOKENS = 2_000;
const SAMPLING = {
  max_tokens: 9_000,
  temperature: 0.4,
  top_p: 0.8,
  frequency_penalty: 0.2,
  presence_penalty: 0.3,
};
const TOKEN_COUNTS = {
  input: 1_000,
  output: 200,
  total: 1_200,
  cached: 64,
  reasoning: 32,
};
const RESPONSES_USAGE = {
  input_tokens: TOKEN_COUNTS.input,
  output_tokens: TOKEN_COUNTS.output,
  total_tokens: TOKEN_COUNTS.total,
  input_tokens_details: { cached_tokens: TOKEN_COUNTS.cached },
  output_tokens_details: { reasoning_tokens: TOKEN_COUNTS.reasoning },
};
const CHAT_USAGE = {
  prompt_tokens: TOKEN_COUNTS.input,
  completion_tokens: TOKEN_COUNTS.output,
  total_tokens: TOKEN_COUNTS.total,
  prompt_tokens_details: { cached_tokens: TOKEN_COUNTS.cached },
  completion_tokens_details: { reasoning_tokens: TOKEN_COUNTS.reasoning },
};
const EXPECTED_USAGE = {
  promptTokens: TOKEN_COUNTS.input,
  completionTokens: TOKEN_COUNTS.output,
  totalTokens: TOKEN_COUNTS.total,
  promptTokensDetails: { cachedTokens: TOKEN_COUNTS.cached },
  completionTokensDetails: { reasoningTokens: TOKEN_COUNTS.reasoning },
};
const PROTOCOL_CASES = [
  {
    protocol: TEXT_CHANNEL_PROTOCOLS.chatCompletions,
    path: '/chat/completions',
  },
  { protocol: TEXT_CHANNEL_PROTOCOLS.responses, path: '/responses' },
] as const;
const RESPONSE_SCHEMA = z.object({ caption: z.string() });
const STRUCTURED_RESULT = { caption: RESULT_TEXT };
const STRUCTURED_DELTAS = ['{"caption":"', RESULT_TEXT, '"}'];
const TOOL_NAME = 'describe_mock_scene';
const TOOL_ITEM_ID = 'fc_mock_protocol';
const TOOL_CALL_ID = 'call_mock_protocol';
const TOOL_INPUT = { scene: 'mock-scene' };
const TOOL_ARGUMENTS = JSON.stringify(TOOL_INPUT);
const TOOL_RESULT = { caption: RESULT_TEXT };
const TOOL_DESCRIPTION = 'Read the local mock scene description.';
const MOCK_IMAGE_URL = 'https://mock-image.invalid/scene.png';
const MOCK_IMAGE_BASE64 = 'bW9jay1pbWFnZQ==';
const MOCK_IMAGE_DATA_URL = `data:image/png;base64,${MOCK_IMAGE_BASE64}`;
const HTTP_FAILURES = [
  {
    label: 'authentication',
    status: 401,
    message: 'Mock invalid credentials.',
  },
  { label: 'region', status: 403, message: 'User location is not supported.' },
  { label: 'rate limit', status: 429, message: 'Mock provider rate limit.' },
  { label: 'server', status: 503, message: 'Mock provider unavailable.' },
] as const;
const PROVIDER_FAILURE_CODE = 'mock_provider_failure';
const mockFetch = vi.fn<typeof fetch>();
type WireEvent = Record<string, unknown>;

function configuredRoute(protocol: TextChannelProtocol): TextModelRoute {
  return {
    modelId: MODEL_ID,
    name: 'Mock configured protocol model',
    channelId: 'mock-protocol-channel',
    credentialId: 'mock-protocol-credential',
    upstreamModel: UPSTREAM_MODEL,
    protocol,
    baseUrl: BASE_URL,
    vision: true,
    structuredOutput: true,
    tools: true,
    contextWindow: CONTEXT_WINDOW,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
  };
}

function chatOptions(protocol: TextChannelProtocol) {
  const route = configuredRoute(protocol);
  return {
    adapter: createAdapter(route.modelId, {
      via: 'compatible',
      key: API_KEY,
      route,
    }),
    modelOptions: configuredTextModelOptions(route, SAMPLING),
    systemPrompts: [SYSTEM_PROMPT],
    messages: [{ role: 'user' as const, content: PROMPT }],
    threadId: THREAD_ID,
    stream: true as const,
    debug: false as const,
  };
}

function outputMessage(text: string): WireEvent {
  return {
    id: MESSAGE_ID,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
}

function responseEvent(type: string, output: WireEvent[] = []): WireEvent {
  return {
    type,
    response: {
      id: RESPONSE_ID,
      object: 'response',
      created_at: CREATED_AT,
      model: UPSTREAM_MODEL,
      status: type === 'response.created' ? 'in_progress' : 'completed',
      output,
      usage: type === 'response.created' ? null : RESPONSES_USAGE,
    },
  };
}

// Synthetic provider wire fixtures exercise the installed SDK's real stream decoder.
function responsesEvents(deltas: string[] = TEXT_DELTAS): WireEvent[] {
  return [
    responseEvent('response.created'),
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...outputMessage(''), status: 'in_progress', content: [] },
    },
    ...deltas.map((delta) => ({
      type: 'response.output_text.delta',
      item_id: MESSAGE_ID,
      output_index: 0,
      content_index: 0,
      delta,
    })),
    responseEvent('response.completed', [outputMessage(deltas.join(''))]),
  ];
}

function chatEvents(deltas: string[] = TEXT_DELTAS): WireEvent[] {
  const envelope = {
    id: 'chatcmpl_mock_protocol',
    object: 'chat.completion.chunk',
    created: CREATED_AT,
    model: UPSTREAM_MODEL,
  };
  return [
    ...deltas.map((content) => ({
      ...envelope,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })),
    {
      ...envelope,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
    { ...envelope, choices: [], usage: CHAT_USAGE },
  ];
}

function sseFrame(event: WireEvent): string {
  const name = typeof event.type === 'string' ? `event: ${event.type}\n` : '';
  return `${name}data: ${JSON.stringify(event)}\n\n`;
}

function sseResponse(events: WireEvent[]): Response {
  const payload = events.map(sseFrame).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (
        let offset = 0;
        offset < bytes.length;
        offset += STREAM_CHUNK_BYTES
      ) {
        controller.enqueue(bytes.subarray(offset, offset + STREAM_CHUNK_BYTES));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function successfulResponse(protocol: TextChannelProtocol): Response {
  return sseResponse(
    protocol === TEXT_CHANNEL_PROTOCOLS.responses
      ? responsesEvents()
      : chatEvents()
  );
}

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function requestAt(index = 0): Request {
  const call = mockFetch.mock.calls.at(index);
  if (!call) throw new Error('Expected a captured mock provider request.');
  return new Request(...call);
}

async function requestBody(index = 0): Promise<Record<string, unknown>> {
  return requestAt(index).json();
}

function textFrom(chunks: StreamChunk[]): string {
  return chunks
    .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
    .map((chunk) => chunk.delta)
    .join('');
}

function expectSuccessfulStream(chunks: StreamChunk[]): void {
  expect(chunks.filter((chunk) => chunk.type === 'RUN_ERROR')).toEqual([]);
  expect(chunks.some((chunk) => chunk.type === 'RUN_STARTED')).toBe(true);
  expect(chunks.some((chunk) => chunk.type === 'TEXT_MESSAGE_START')).toBe(
    true
  );
  expect(chunks.some((chunk) => chunk.type === 'TEXT_MESSAGE_END')).toBe(true);
  expect(textFrom(chunks)).toBe(RESULT_TEXT);
  expect(chunks.find((chunk) => chunk.type === 'RUN_FINISHED')).toMatchObject({
    usage: EXPECTED_USAGE,
  });
}

async function expectPrivateRequest(
  path: string,
  chunks: StreamChunk[],
  index = 0
): Promise<void> {
  const request = requestAt(index);
  expect(request.url).toBe(`${BASE_URL}${path}`);
  expect(request.method).toBe('POST');
  expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
  expect(request.headers.get('content-type')).toContain('application/json');
  expect(request.url).not.toContain(API_KEY);
  expect(JSON.stringify(await requestBody(index))).not.toContain(API_KEY);
  expect(JSON.stringify(chunks)).not.toContain(API_KEY);
  expect(JSON.stringify(chunks)).not.toContain('mock-unused-');
}

function toolEvents(): WireEvent[] {
  const item = {
    type: 'function_call',
    id: TOOL_ITEM_ID,
    call_id: TOOL_CALL_ID,
    name: TOOL_NAME,
  };
  return [
    responseEvent('response.created'),
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', arguments: '' },
    },
    {
      type: 'response.function_call_arguments.delta',
      item_id: TOOL_ITEM_ID,
      output_index: 0,
      delta: TOOL_ARGUMENTS,
    },
    {
      type: 'response.function_call_arguments.done',
      item_id: TOOL_ITEM_ID,
      output_index: 0,
      arguments: TOOL_ARGUMENTS,
    },
    responseEvent('response.completed', [
      { ...item, status: 'completed', arguments: TOOL_ARGUMENTS },
    ]),
  ];
}

function localTool() {
  const execute = vi.fn(async (_input: { scene: string }) => TOOL_RESULT);
  const tool = toolDefinition({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema: z.object({ scene: z.string() }),
    outputSchema: RESPONSE_SCHEMA,
  }).server(execute);
  return { execute, tool };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(() => {
    throw new Error('Unexpected fetch: all provider responses must be mocked.');
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(PROTOCOL_CASES)(
  'POSTs to $path and decodes fragmented SSE text and usage',
  async ({ protocol, path }) => {
    mockFetch.mockResolvedValueOnce(successfulResponse(protocol));
    const chunks = await collect(chat(chatOptions(protocol)));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expectSuccessfulStream(chunks);
    await expectPrivateRequest(path, chunks);
    expect(await requestBody()).toMatchObject({
      model: UPSTREAM_MODEL,
      stream: true,
      temperature: SAMPLING.temperature,
      top_p: SAMPLING.top_p,
    });
  }
);

it('sends Chat Completions messages, sampling, capped max_tokens and usage opt-in', async () => {
  const protocol = TEXT_CHANNEL_PROTOCOLS.chatCompletions;
  mockFetch.mockResolvedValueOnce(successfulResponse(protocol));
  await collect(chat(chatOptions(protocol)));
  const body = await requestBody();
  expect(body).toMatchObject({
    model: UPSTREAM_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: PROMPT },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    stream_options: { include_usage: true },
    frequency_penalty: SAMPLING.frequency_penalty,
    presence_penalty: SAMPLING.presence_penalty,
  });
  expect(body).not.toHaveProperty('max_output_tokens');
  expect(body).not.toHaveProperty('input');
  expect(body).not.toHaveProperty('instructions');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('sends Responses input, instructions and max_output_tokens without Chat-only options', async () => {
  const protocol = TEXT_CHANNEL_PROTOCOLS.responses;
  mockFetch.mockResolvedValueOnce(successfulResponse(protocol));
  await collect(chat(chatOptions(protocol)));
  const body = await requestBody();
  expect(body).toMatchObject({
    model: UPSTREAM_MODEL,
    instructions: SYSTEM_PROMPT,
    input: [{ role: 'user', content: [{ type: 'input_text', text: PROMPT }] }],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: SAMPLING.temperature,
    top_p: SAMPLING.top_p,
  });
  expect(body).not.toHaveProperty('messages');
  expect(body).not.toHaveProperty('max_tokens');
  expect(body).not.toHaveProperty('stream_options');
  expect(body).not.toHaveProperty('frequency_penalty');
  expect(body).not.toHaveProperty('presence_penalty');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('uses Responses text.format for Zod structured output and returns a validated SSE object', async () => {
  mockFetch.mockResolvedValueOnce(
    sseResponse(responsesEvents(STRUCTURED_DELTAS))
  );
  const chunks = await collect(
    chat({
      ...chatOptions(TEXT_CHANNEL_PROTOCOLS.responses),
      outputSchema: RESPONSE_SCHEMA,
    })
  );
  expect(chunks).toContainEqual(
    expect.objectContaining({
      type: 'CUSTOM',
      name: 'structured-output.complete',
      value: expect.objectContaining({ object: STRUCTURED_RESULT }),
    })
  );
  expect(chunks.filter((chunk) => chunk.type === 'RUN_ERROR')).toEqual([]);
  expect(await requestBody()).toMatchObject({
    text: {
      format: {
        type: 'json_schema',
        name: 'structured_output',
        strict: true,
        schema: {
          type: 'object',
          properties: { caption: { type: 'string' } },
          required: ['caption'],
          additionalProperties: false,
        },
      },
    },
  });
  expect(await requestBody()).not.toHaveProperty('response_format');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  await expectPrivateRequest('/responses', chunks);
});

it.each([
  {
    source: { type: 'url' as const, value: MOCK_IMAGE_URL },
    imageUrl: MOCK_IMAGE_URL,
  },
  {
    source: {
      type: 'data' as const,
      value: MOCK_IMAGE_BASE64,
      mimeType: 'image/png',
    },
    imageUrl: MOCK_IMAGE_DATA_URL,
  },
])(
  'maps Responses vision $source.type to input_image without fetching the image',
  async ({ source, imageUrl }) => {
    mockFetch.mockResolvedValueOnce(sseResponse(responsesEvents()));
    const chunks = await collect(
      chat({
        ...chatOptions(TEXT_CHANNEL_PROTOCOLS.responses),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', content: PROMPT },
              { type: 'image', source, metadata: { detail: 'high' } },
            ],
          },
        ],
      })
    );
    expectSuccessfulStream(chunks);
    expect(await requestBody()).toMatchObject({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: PROMPT },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
          ],
        },
      ],
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await expectPrivateRequest('/responses', chunks);
  }
);

it('executes a local Responses tool and replays function_call plus function_call_output by call_id', async () => {
  mockFetch.mockResolvedValueOnce(sseResponse(toolEvents()));
  mockFetch.mockResolvedValueOnce(sseResponse(responsesEvents()));
  const { execute, tool } = localTool();
  const chunks = await collect(
    chat({
      ...chatOptions(TEXT_CHANNEL_PROTOCOLS.responses),
      tools: [tool],
    })
  );
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[0]).toEqual(TOOL_INPUT);
  expect(textFrom(chunks)).toBe(RESULT_TEXT);
  expect(chunks.filter((chunk) => chunk.type === 'RUN_ERROR')).toEqual([]);
  expect(await requestBody()).toMatchObject({
    tools: [expect.objectContaining({ type: 'function', name: TOOL_NAME })],
  });
  expect(await requestBody(1)).toMatchObject({
    input: expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call',
        call_id: TOOL_CALL_ID,
        name: TOOL_NAME,
        arguments: TOOL_ARGUMENTS,
      }),
      {
        type: 'function_call_output',
        call_id: TOOL_CALL_ID,
        output: JSON.stringify(TOOL_RESULT),
      },
    ]),
  });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  await expectPrivateRequest('/responses', chunks);
  await expectPrivateRequest('/responses', chunks, 1);
});

describe.each(PROTOCOL_CASES)(
  '$protocol provider failures',
  ({ protocol, path }) => {
    it.each(HTTP_FAILURES)(
      'surfaces $label HTTP $status without retry, fallback or credentials',
      async ({ status, message }) => {
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message,
                type: 'mock_provider_error',
                code: PROVIDER_FAILURE_CODE,
              },
            }),
            {
              status,
              headers: {
                'content-type': 'application/json',
                'x-mock-sensitive-context': API_KEY,
              },
            }
          )
        );
        const chunks = await collect(chat(chatOptions(protocol)));
        expect(chunks).toContainEqual(
          expect.objectContaining({
            type: 'RUN_ERROR',
            message: expect.stringContaining(message),
          })
        );
        expect(chunks.filter((chunk) => chunk.type === 'RUN_FINISHED')).toEqual(
          []
        );
        expect(textFrom(chunks)).toBe('');
        expect(mockFetch).toHaveBeenCalledTimes(1);
        await expectPrivateRequest(path, chunks);
      }
    );
  }
);

it('surfaces a terminal Responses SSE failure without consuming a queued fallback response', async () => {
  mockFetch.mockResolvedValueOnce(
    sseResponse([
      {
        type: 'response.failed',
        response: {
          id: RESPONSE_ID,
          model: UPSTREAM_MODEL,
          status: 'failed',
          output: [],
          error: {
            code: PROVIDER_FAILURE_CODE,
            message: 'Mock Responses stream failed.',
          },
        },
      },
    ])
  );
  mockFetch.mockResolvedValueOnce(sseResponse(responsesEvents()));
  const chunks = await collect(
    chat(chatOptions(TEXT_CHANNEL_PROTOCOLS.responses))
  );
  expect(chunks).toContainEqual(
    expect.objectContaining({
      type: 'RUN_ERROR',
      message: 'Mock Responses stream failed.',
    })
  );
  expect(chunks.filter((chunk) => chunk.type === 'RUN_FINISHED')).toEqual([]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  await expectPrivateRequest('/responses', chunks);
});
