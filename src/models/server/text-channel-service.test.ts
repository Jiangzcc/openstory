import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TextChannelsAdminStore } from './text-channel-service';
import type { TextChannelsConfiguration } from '../text-channels';
import {
  TEXT_CHANNEL_PROTOCOL,
  TEXT_CHANNEL_PROTOCOLS,
} from '../text-channels';
import {
  createTextChannelsAdminService,
  TEXT_CHANNEL_SYNC_MAX_BYTES,
  TEXT_CHANNEL_SYNC_TIMEOUT_MS,
} from './text-channel-service';

const MOCK_PROVIDER_SECRET = 'mock-secret-never-call-a-real-provider';
const configuration: TextChannelsConfiguration = {
  revision: 1,
  models: [],
  channels: [
    {
      id: 'mock-provider',
      name: 'Mock provider',
      baseUrl: 'https://10.0.0.4:8443/custom/v1',
      protocol: TEXT_CHANNEL_PROTOCOL,
      enabled: true,
      hasKey: true,
      keyHint: '****ider',
      credentialId: '341f120f-edbf-47b0-99e2-9ec24cd78ef9',
    },
  ],
};
const fetchMock = vi.fn<typeof fetch>();

function mockStore(): TextChannelsAdminStore {
  return {
    read: vi.fn(async () => ({
      configuration: structuredClone(configuration),
      serialized: 'mock-registry',
    })),
    commit: vi.fn(async () => undefined),
    resolveSecret: vi.fn(async () => MOCK_PROVIDER_SECRET),
  };
}

function mockModelsResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('syncs only GET /models with the immutable stored key and never writes imports', async () => {
  const store = mockStore();
  fetchMock.mockResolvedValue(
    mockModelsResponse({
      data: [{ id: 'provider/new-text', owned_by: 'Provider' }],
    })
  );
  const result = await createTextChannelsAdminService(store).syncModels({
    channelId: 'mock-provider',
  });
  expect(result).toEqual({
    channelId: 'mock-provider',
    candidates: [
      {
        upstreamModel: 'provider/new-text',
        name: 'provider/new-text',
        vendor: 'Provider',
      },
    ],
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = requireValue(fetchMock.mock.calls[0]);
  expect(url).toBe(requireValue(configuration.channels[0]).baseUrl + '/models');
  expect(init).toMatchObject({
    method: 'GET',
    redirect: 'manual',
    headers: {
      Authorization: 'Bearer ' + MOCK_PROVIDER_SECRET,
      Accept: 'application/json',
    },
  });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(store.resolveSecret).toHaveBeenCalledWith(
    requireValue(configuration.channels[0]).credentialId
  );
  expect(store.commit).not.toHaveBeenCalled();
  expect(result.candidates[0]).not.toHaveProperty('enabled');
  expect(result.candidates[0]).not.toHaveProperty('inputPricePerMillion');
});

it('returns incremental text candidates without classifying nontext models as text bindings', async () => {
  const store = mockStore();
  fetchMock.mockResolvedValue(
    mockModelsResponse({
      data: [
        { id: 'provider/text-chat', name: 'Mock text', type: 'chat' },
        { id: 'provider/text-chat', name: 'Mock text duplicate' },
        { id: 'text-embedding-3-large' },
        { id: 'openai/whisper-1' },
        { id: 'tts-1' },
        { id: 'fal/flux-2' },
        { id: 'sora-2' },
        { id: 'provider/nontext', type: 'embedding' },
        {
          id: 'provider/image-out',
          architecture: { output_modalities: ['image'] },
        },
        { id: 'provider/vision-chat', modalities: ['text', 'image'] },
      ],
    })
  );
  const result = await createTextChannelsAdminService(store).syncModels({
    channelId: 'mock-provider',
  });
  expect(result.candidates.map((candidate) => candidate.upstreamModel)).toEqual(
    ['provider/text-chat', 'provider/vision-chat']
  );
  expect(store.commit).not.toHaveBeenCalled();
});

it.each([
  { data: [{ id: '' }] },
  { data: [{ id: 123 }] },
  { data: [{ id: 'model', name: 12 }] },
  { data: [{ id: 'model', owned_by: { name: 'invalid' } }] },
  { models: [{ id: 'model' }] },
  { data: [{ id: 'model\nheader' }] },
  { data: [{ id: 'model', modalities: { input: 'text' } }] },
  { data: [{ id: 'model', input_modalities: 42 }] },
  { data: [{ id: 'model', output_modalities: ['text', 42] }] },
  { data: [{ id: 'model', supported_endpoint_types: [null] }] },
])(
  'validates provider JSON and model fields before offering candidates: %j',
  async (body) => {
    fetchMock.mockResolvedValue(mockModelsResponse(body));
    await expect(
      createTextChannelsAdminService(mockStore()).syncModels({
        channelId: 'mock-provider',
      })
    ).rejects.toThrow(
      'Could not sync text models. Check the channel URL and API key.'
    );
  }
);

it.each([401, 429, 500, 302])(
  'does not reflect provider errors or follow status %i responses',
  async (status) => {
    fetchMock.mockResolvedValue(
      new Response('provider echoed ' + MOCK_PROVIDER_SECRET, {
        status,
        headers: { Location: 'https://other.example/models' },
      })
    );
    const service = createTextChannelsAdminService(mockStore());
    await expect(
      service.syncModels({ channelId: 'mock-provider' })
    ).rejects.toThrow(
      'Could not sync text models. Check the channel URL and API key.'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  }
);

it('redacts network and redirect failures instead of reflecting raw provider details', async () => {
  fetchMock.mockRejectedValue(
    new Error('Provider rejected Bearer ' + MOCK_PROVIDER_SECRET)
  );
  await expect(
    createTextChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock-provider',
    })
  ).rejects.toThrow(
    'Could not sync text models. Check the channel URL and API key.'
  );
});

it.each(['id', 'name', 'description', 'owned_by'])(
  'rejects secret reflection inside provider field %s',
  async (field) => {
    fetchMock.mockResolvedValue(
      mockModelsResponse({
        data: [{ id: 'provider/text-model', [field]: MOCK_PROVIDER_SECRET }],
      })
    );
    const result = createTextChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock-provider',
    });
    await expect(result).rejects.toThrow(
      'Could not sync text models. Check the channel URL and API key.'
    );
  }
);

it('bounds the discovery request timeout and reports an aborted request safely', async () => {
  const signal = AbortSignal.abort();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
  fetchMock.mockImplementation(async (_input, init) => {
    init?.signal?.throwIfAborted();
    return mockModelsResponse({ data: [] });
  });
  await expect(
    createTextChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock-provider',
    })
  ).rejects.toThrow('Could not sync text models.');
  expect(timeout).toHaveBeenCalledWith(TEXT_CHANNEL_SYNC_TIMEOUT_MS);
});

it('rejects oversized content-length without reading model metadata', async () => {
  fetchMock.mockResolvedValue(
    new Response('{}', {
      headers: { 'content-length': String(TEXT_CHANNEL_SYNC_MAX_BYTES + 1) },
    })
  );
  await expect(
    createTextChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock-provider',
    })
  ).rejects.toThrow('Could not sync text models.');
});

it('bounds chunked responses even when the provider omits content-length', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(TEXT_CHANNEL_SYNC_MAX_BYTES + 1));
    },
    cancel,
  });
  fetchMock.mockResolvedValue(new Response(body));
  await expect(
    createTextChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock-provider',
    })
  ).rejects.toThrow('Could not sync text models.');
  expect(cancel).toHaveBeenCalled();
});

it('does not call a provider for missing channels or missing saved keys', async () => {
  const store = mockStore();
  const service = createTextChannelsAdminService(store);
  await expect(
    service.syncModels({ channelId: 'unknown-channel' })
  ).rejects.toThrow('Text channel not found.');
  store.read = vi.fn(async () => ({
    serialized: 'mock-registry',
    configuration: {
      ...configuration,
      channels: [
        {
          ...requireValue(configuration.channels[0]),
          credentialId: null,
          hasKey: false,
          keyHint: null,
        },
      ],
    },
  }));
  await expect(
    service.syncModels({ channelId: 'mock-provider' })
  ).rejects.toThrow('Save a channel API key');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(store.resolveSecret).not.toHaveBeenCalled();
});

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Missing mock test value.');
  return value;
}

it.each([
  {
    id: 'qwen3-asr',
    input_modalities: 'audio,file',
    output_modalities: 'text',
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/transcriber',
    input_modalities: ['audio', 'file'],
    output_modalities: ['text'],
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/ocr-only',
    input_modalities: 'image,file',
    output_modalities: 'text',
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/nontext-output',
    input_modalities: 'text',
    output_modalities: 'image',
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/audio-output',
    input_modalities: ['text'],
    output_modalities: ['audio'],
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/response-only',
    input_modalities: 'text',
    output_modalities: 'text',
    supported_endpoint_types: ['openai-response'],
  },
  { id: 'provider/embedding-only', supported_endpoint_types: ['embedding'] },
  {
    id: 'provider/image-endpoint',
    input_modalities: 'text',
    output_modalities: 'text',
    supported_endpoint_types: ['image-generation'],
  },
  { id: 'provider/no-chat-endpoint', supported_endpoint_types: [] },
  {
    id: 'provider/architecture-asr',
    architecture: { input_modalities: 'audio,file', output_modalities: 'text' },
  },
  {
    id: 'provider/top-level-output',
    input_modalities: 'text',
    output_modalities: 'image',
    architecture: { output_modalities: ['text'] },
  },
  {
    id: 'provider/empty-inputs',
    input_modalities: [],
    output_modalities: ['text'],
  },
  { id: 'qwen3-asr' },
])('excludes non-chat or non-text discovery metadata: $id', async (model) => {
  fetchMock.mockResolvedValue(mockModelsResponse({ data: [model] }));
  const store = mockStore();
  const result = await createTextChannelsAdminService(store).syncModels({
    channelId: 'mock-provider',
  });
  expect(result.candidates).toEqual([]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(store.commit).not.toHaveBeenCalled();
});

it.each([
  {
    id: 'provider/text-chat',
    input_modalities: 'text',
    output_modalities: 'text',
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/vision-chat',
    input_modalities: 'text,image,file',
    output_modalities: 'text',
    supported_endpoint_types: ['openai'],
  },
  {
    id: 'provider/array-metadata',
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
    supported_endpoint_types: ['openai-response', 'openai'],
  },
  {
    id: 'provider/normalized-tags',
    input_modalities: ' Text , Image ',
    output_modalities: [' Text '],
    supported_endpoint_types: ' OPENAI ',
  },
  {
    id: 'provider/architecture-vision',
    architecture: {
      input_modalities: ['text', 'image'],
      output_modalities: 'text',
    },
    supported_endpoint_types: ['openai'],
  },
  { id: 'provider/legacy-modality', modalities: 'text' },
  {
    id: 'provider/image-chat',
    input_modalities: 'text,image',
    output_modalities: 'text',
    supported_endpoint_types: ['openai'],
  },
  { id: 'provider/plain-openai-model', object: 'model', owned_by: 'provider' },
])(
  'accepts text and vision chat with compatible metadata: $id',
  async (model) => {
    fetchMock.mockResolvedValue(mockModelsResponse({ data: [model] }));
    const store = mockStore();
    const result = await createTextChannelsAdminService(store).syncModels({
      channelId: 'mock-provider',
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.upstreamModel).toBe(model.id);
    expect(result.candidates[0]).not.toHaveProperty('vision');
    expect(result.candidates[0]).not.toHaveProperty('enabled');
    expect(store.commit).not.toHaveBeenCalled();
  }
);

const ENDPOINT_CANDIDATES = [
  { id: 'chat-only', supported_endpoint_types: ['openai'] },
  {
    id: 'responses-only',
    supported_endpoint_types: ['openai-response'],
  },
  {
    id: 'both',
    supported_endpoint_types: ['openai', 'openai-response'],
  },
  { id: 'standard-model' },
  {
    id: 'normalized',
    supported_endpoint_types: ' OPENAI-RESPONSE , openai ',
  },
  { id: 'no-endpoint', supported_endpoint_types: [] },
  {
    id: 'asr-model',
    supported_endpoint_types: ['openai-response'],
    input_modalities: 'audio,file',
    output_modalities: 'text',
  },
];

it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
  'discovers only candidates compatible with the saved %s endpoint',
  async (protocol) => {
    const selectedChannel = {
      ...requireValue(configuration.channels[0]),
      protocol,
    };
    const store = mockStore();
    store.read = vi.fn(async () => ({
      configuration: { ...configuration, channels: [selectedChannel] },
      serialized: 'mock-protocol-registry',
    }));
    fetchMock.mockResolvedValue(
      mockModelsResponse({
        data: ENDPOINT_CANDIDATES,
      })
    );
    const result = await createTextChannelsAdminService(store).syncModels({
      channelId: selectedChannel.id,
    });
    expect(
      result.candidates.map((candidate) => candidate.upstreamModel)
    ).toEqual([
      protocol === TEXT_CHANNEL_PROTOCOLS.responses
        ? 'responses-only'
        : 'chat-only',
      'both',
      'standard-model',
      'normalized',
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(store.commit).not.toHaveBeenCalled();
  }
);
