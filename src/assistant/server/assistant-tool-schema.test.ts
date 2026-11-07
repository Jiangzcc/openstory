import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chat,
  convertSchemaToJsonSchema,
  DISCOVERY_TOOL_NAME,
} from '@tanstack/ai';
import { z } from 'zod';
import { createAdapter } from '@/models/server/create-adapter';
import { TEXT_CHANNEL_PROTOCOLS } from '@/models/text-channels';
import type {
  TextChannelProtocol,
  TextModelRoute,
} from '@/models/text-channels';
import { apiCreateSequenceSchema } from '@/platform/server/api-v1/input-schema';
import { MCP_TOOLS } from '@/platform/server/mcp/server';
import { assistantTools } from './assistant-tools';

vi.mock('#env', () => ({ getEnv: () => ({ E2E_TEST: 'true' }) }));

const CREATE_SEQUENCE = 'openstory_create_sequence';
const CREATE_CHARACTER = 'openstory_create_character';
const DISCOVERY_ARGUMENTS = JSON.stringify({
  toolNames: [CREATE_CHARACTER, CREATE_SEQUENCE],
});
const tools = assistantTools();
const mockFetch = vi.fn<typeof fetch>();
const wireTool = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
const wireRequest = z.object({
  tools: z.array(z.union([wireTool, z.object({ function: wireTool })])),
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

function routeFor(protocol: TextChannelProtocol): TextModelRoute {
  return {
    modelId: 'custom:assistant-schema-test',
    name: 'Mock assistant model',
    channelId: 'mock-channel',
    credentialId: 'mock-credential',
    upstreamModel: 'mock-upstream-model',
    protocol,
    baseUrl: 'https://assistant-schema.invalid/v1',
    vision: false,
    structuredOutput: true,
    tools: true,
    contextWindow: 8_000,
    maxOutputTokens: 2_000,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
  };
}

function chatEvents(discover: boolean) {
  const envelope = {
    id: 'chatcmpl_mock_schema',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'mock-upstream-model',
  };
  const delta = discover
    ? {
        tool_calls: [
          {
            index: 0,
            id: 'call_mock_discovery',
            type: 'function',
            function: {
              name: DISCOVERY_TOOL_NAME,
              arguments: DISCOVERY_ARGUMENTS,
            },
          },
        ],
      }
    : { content: 'Mock discovery complete.' };
  return [
    { ...envelope, choices: [{ index: 0, delta, finish_reason: null }] },
    {
      ...envelope,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: discover ? 'tool_calls' : 'stop',
        },
      ],
    },
  ];
}

function responseItem(discover: boolean) {
  return discover
    ? {
        type: 'function_call',
        id: 'fc_mock_discovery',
        call_id: 'call_mock_discovery',
        name: DISCOVERY_TOOL_NAME,
        arguments: DISCOVERY_ARGUMENTS,
        status: 'completed',
      }
    : {
        type: 'message',
        id: 'msg_mock_schema',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: 'Mock discovery complete.',
            annotations: [],
          },
        ],
      };
}

function responsesEvents(discover: boolean) {
  const item = responseItem(discover);
  const response = {
    id: 'resp_mock_schema',
    object: 'response',
    created_at: 1_700_000_000,
    model: 'mock-upstream-model',
  };
  return [
    {
      type: 'response.created',
      response: { ...response, status: 'in_progress', output: [] },
    },
    { type: 'response.output_item.added', output_index: 0, item },
    {
      type: 'response.completed',
      response: { ...response, status: 'completed', output: [item] },
    },
  ];
}

function providerReply(protocol: TextChannelProtocol, discover: boolean) {
  const events =
    protocol === TEXT_CHANNEL_PROTOCOLS.responses
      ? responsesEvents(discover)
      : chatEvents(discover);
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function expectSequenceSchema(schema: Record<string, unknown>) {
  expect(schema).toMatchObject({
    type: 'object',
    required: ['script'],
    properties: {
      script: { type: 'string', minLength: 10, maxLength: 50_000 },
    },
  });
  expect(schema).not.toHaveProperty('$ref');
  expect(schema).toHaveProperty(
    'properties.characters.items.$ref',
    '#/definitions/CharacterRef'
  );
  expect(schema).toHaveProperty('definitions.CharacterRef');
  expect(schema).toHaveProperty(
    'definitions.CreateCharacter.properties.name.type',
    'string'
  );
}

async function expectRequestSchemas(
  call: Parameters<typeof fetch>,
  index: number
) {
  const body = wireRequest.parse(await new Request(...call).json());
  const sent = body.tools.map((tool) =>
    'function' in tool ? tool.function : tool
  );
  for (const tool of sent)
    expect(tool.parameters.type, tool.name).toBe('object');
  const sequence = sent.find((tool) => tool.name === CREATE_SEQUENCE);
  if (index === 0) expect(sequence).toBeUndefined();
  else {
    expect(sent.some((tool) => tool.name === CREATE_CHARACTER)).toBe(true);
    if (!sequence)
      throw new Error('Discovery did not advertise sequence creation.');
    expectSequenceSchema(sequence.parameters);
  }
}

describe('assistant tool parameter schemas', () => {
  it('keeps every catalog entry an object at the root', () => {
    for (const tool of tools) {
      const schema = convertSchemaToJsonSchema(tool.inputSchema, {
        io: 'input',
      });
      if (!schema) throw new Error(`${tool.name} has no parameter schema.`);
      expect(schema.type, tool.name).toBe('object');
      expect(schema, tool.name).not.toHaveProperty('$ref');
    }
  });

  it('preserves public API metadata, defaults and validation', () => {
    const schema = tools.find(
      (tool) => tool.name === CREATE_SEQUENCE
    )?.inputSchema;
    if (!(schema instanceof z.ZodObject))
      throw new Error('Missing sequence schema.');
    expect(apiCreateSequenceSchema.meta()?.id).toBe('CreateSequenceRequest');
    expect(
      MCP_TOOLS.find((tool) => tool.name === 'openstory.create_sequence')
        ?.inputSchema
    ).toBe(apiCreateSequenceSchema);
    const input = { script: 'A lighthouse keeper befriends a whale.' };
    expect(schema.parse(input)).toEqual(apiCreateSequenceSchema.parse(input));
    for (const invalid of [
      { script: 'short' },
      { ...input, music: true, motion: false },
    ]) {
      expect(schema.safeParse(invalid)).toEqual(
        apiCreateSequenceSchema.safeParse(invalid)
      );
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
    'sends object parameters before and after lazy discovery over %s',
    async (protocol) => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockImplementation(() => {
        throw new Error('Unexpected mock provider request.');
      });
      mockFetch.mockResolvedValueOnce(providerReply(protocol, true));
      mockFetch.mockResolvedValueOnce(providerReply(protocol, false));
      const route = routeFor(protocol);
      const chunks = [];
      for await (const chunk of chat({
        adapter: createAdapter(route.modelId, {
          via: 'compatible',
          key: 'mock-key',
          route,
        }),
        messages: [{ role: 'user', content: 'Create a mock character.' }],
        threadId: 'mock-schema-thread',
        tools,
        debug: false,
      }))
        chunks.push(chunk);
      expect(chunks.filter((chunk) => chunk.type === 'RUN_ERROR')).toEqual([]);
      expect(
        chunks.filter((chunk) => chunk.type === 'RUN_FINISHED').at(-1)
      ).toMatchObject({
        metadata: { tanstack: { finishReason: 'stop' } },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      for (const [index, call] of mockFetch.mock.calls.entries())
        await expectRequestSchemas(call, index);
    }
  );
});
