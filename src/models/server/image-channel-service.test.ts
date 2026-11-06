import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ImageChannelsAdminStore } from './image-channel-service';
import type { ImageChannelsConfiguration } from '../image-channels';
import { generateId } from '@/platform/id';
import { IMAGE_CHANNEL_PROTOCOL } from '../image-channels';
import { imageConfigurationFixture } from '../__tests__/image-model-fixture';
import {
  imageRoutingCapacityFixture,
  largeImageParameterFixture,
} from '../__tests__/image-routing-capacity-fixture';
import { WORKFLOW_IMAGE_ROUTING_SIZE_ERROR } from '../workflow-image-model-routing';
import {
  createImageChannelsAdminService,
  createImageChannelsReader,
  IMAGE_CHANNEL_SYNC_MAX_BYTES,
  IMAGE_CHANNEL_SYNC_TIMEOUT_MS,
} from './image-channel-service';

const MOCK_PROVIDER_SECRET = 'mock-secret-only-never-a-provider-key';
const configuration: ImageChannelsConfiguration = {
  revision: 1,
  models: [],
  channels: [
    {
      id: 'mock',
      name: 'Mock',
      baseUrl: 'https://10.0.0.4/v1',
      protocol: IMAGE_CHANNEL_PROTOCOL,
      enabled: true,
      hasKey: true,
      keyHint: '****mock',
      credentialId: generateId(),
    },
  ],
};
const fetchMock = vi.fn<typeof fetch>();
function mockStore(): ImageChannelsAdminStore {
  return {
    read: vi.fn(async () => ({
      configuration: structuredClone(configuration),
      serialized: 'mock-registry',
    })),
    commit: vi.fn(async () => undefined),
    resolveSecret: vi.fn(async () => MOCK_PROVIDER_SECRET),
  };
}
function mockResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
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

it('discovers read-only candidates via exactly one GET without enabling or inventing prices', async () => {
  fetchMock.mockResolvedValue(
    mockResponse({
      data: [
        { id: 'longshine/Qwen-Image', owned_by: 'Mock' },
        { id: 'longshine/Qwen-Image-Edit' },
        { id: 'gpt-image-2' },
        { id: 'image-name-text', output_modalities: ['text'] },
        { id: 'unusual-name', architecture: { output_modalities: ['image'] } },
        { id: 'gpt-text-model' },
        { id: 'gpt-image-2' },
      ],
    })
  );
  const store = mockStore();
  const result = await createImageChannelsAdminService(store).syncModels({
    channelId: 'mock',
  });
  expect(result.candidates.map((entry) => entry.upstreamModel)).toEqual([
    'longshine/Qwen-Image',
    'longshine/Qwen-Image-Edit',
    'gpt-image-2',
    'unusual-name',
  ]);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    'https://10.0.0.4/v1/models',
    expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      signal: expect.any(AbortSignal),
      headers: {
        Authorization: 'Bearer ' + MOCK_PROVIDER_SECRET,
        Accept: 'application/json',
      },
    })
  );
  expect(store.resolveSecret).toHaveBeenCalledWith(
    configuration.channels[0]?.credentialId
  );
  expect(store.commit).not.toHaveBeenCalled();
  expect(result.candidates[0]).not.toHaveProperty('enabled');
  expect(result.candidates[0]).not.toHaveProperty('priceCards');
});

it.each([401, 429, 500, 302])(
  'hides supplier status %i details and does not follow redirects',
  async (status) => {
    fetchMock.mockResolvedValue(
      new Response('Bearer ' + MOCK_PROVIDER_SECRET, { status })
    );
    await expect(
      createImageChannelsAdminService(mockStore()).syncModels({
        channelId: 'mock',
      })
    ).rejects.toThrow(
      'Could not sync image models. Check the channel URL and API key.'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  }
);

it.each(['id', 'name', 'description', 'owned_by'])(
  'rejects reflected secrets in discovery %s',
  async (field) => {
    fetchMock.mockResolvedValue(
      mockResponse({
        data: [{ id: 'mock-image', [field]: MOCK_PROVIDER_SECRET }],
      })
    );
    await expect(
      createImageChannelsAdminService(mockStore()).syncModels({
        channelId: 'mock',
      })
    ).rejects.toThrow('Could not sync image models.');
  }
);

it.each([
  { data: [{ id: 42 }] },
  { data: [{ id: 'bad\nmodel' }] },
  { data: [{ id: 'image', name: 42 }] },
  { models: [] },
  { data: [{ id: 'image', output_modalities: { image: true } }] },
])('rejects malformed supplier data: %j', async (body) => {
  fetchMock.mockResolvedValue(mockResponse(body));
  await expect(
    createImageChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock',
    })
  ).rejects.toThrow('Could not sync');
});

it('limits timeout and redacts thrown network details', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  fetchMock.mockRejectedValue(
    new Error('Rejected Bearer ' + MOCK_PROVIDER_SECRET)
  );
  await expect(
    createImageChannelsAdminService(mockStore()).syncModels({
      channelId: 'mock',
    })
  ).rejects.toThrow('Could not sync image models.');
  expect(timeout).toHaveBeenCalledWith(IMAGE_CHANNEL_SYNC_TIMEOUT_MS);
});

it('bounds both content length and streamed bodies', async () => {
  fetchMock.mockResolvedValue(
    new Response('{}', {
      headers: { 'content-length': String(IMAGE_CHANNEL_SYNC_MAX_BYTES + 1) },
    })
  );
  const service = createImageChannelsAdminService(mockStore());
  await expect(service.syncModels({ channelId: 'mock' })).rejects.toThrow(
    'Could not sync'
  );
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(IMAGE_CHANNEL_SYNC_MAX_BYTES + 1));
    },
    cancel,
  });
  fetchMock.mockResolvedValue(new Response(body));
  await expect(service.syncModels({ channelId: 'mock' })).rejects.toThrow(
    'Could not sync'
  );
  expect(cancel).toHaveBeenCalled();
});

it('rejects missing channel/credential without making a discovery request', async () => {
  const store = mockStore();
  await expect(
    createImageChannelsAdminService(store).syncModels({ channelId: 'missing' })
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const config = structuredClone(configuration);
  const channel = config.channels[0];
  if (!channel) throw new Error('Missing mock channel');
  channel.credentialId = null;
  channel.hasKey = false;
  channel.keyHint = null;
  store.read = vi.fn(async () => ({
    configuration: config,
    serialized: 'mock',
  }));
  await expect(
    createImageChannelsAdminService(store).syncModels({ channelId: 'mock' })
  ).rejects.toThrow('Save a channel API key');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('saves a built-in image channel binding through the existing revisioned admin store', async () => {
  const store = mockStore();
  const model = imageConfigurationFixture().models[0];
  if (!model) throw new Error('Missing mock model.');
  const saved = await createImageChannelsAdminService(store).saveModel({
    ...model,
    id: 'gpt_image_2',
    channelId: 'mock',
    revision: configuration.revision,
  });
  expect(saved.models).toHaveLength(1);
  expect(saved.models[0]).toMatchObject({
    id: 'gpt_image_2',
    channelId: 'mock',
  });
  expect(store.commit).toHaveBeenCalledExactlyOnceWith('mock-registry', saved);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('allows built-in upstream/channel rebinding while keeping the old task snapshot intact', async () => {
  const config = imageConfigurationFixture();
  const model = config.models[0];
  const channel = config.channels[0];
  if (!model?.operations.generate || !model.operations.edit || !channel)
    throw new Error('Missing mock configuration.');
  model.id = 'gpt_image_2';
  config.channels.push({
    ...channel,
    id: 'new-channel',
    baseUrl: 'https://new.example.com/v1',
  });
  const store = mockStore();
  store.read = vi.fn(async () => ({
    configuration: config,
    serialized: 'mock',
  }));
  const service = createImageChannelsAdminService(store);
  const frozen = await service.getSnapshot();
  const saved = await service.saveModel({
    ...model,
    revision: config.revision,
    channelId: 'new-channel',
    operations: {
      generate: { ...model.operations.generate, upstreamModel: 'new-generate' },
      edit: { ...model.operations.edit, upstreamModel: 'new-edit' },
    },
  });
  expect(saved.models).toHaveLength(1);
  expect(saved.models[0]).toMatchObject({
    id: model.id,
    channelId: 'new-channel',
    operations: {
      generate: { upstreamModel: 'new-generate' },
      edit: { upstreamModel: 'new-edit' },
    },
  });
  expect(frozen[0]).toMatchObject({
    baseUrl: channel.baseUrl,
    operations: {
      generate: { upstreamModel: 'mock-generate' },
      edit: { upstreamModel: 'mock-edit' },
    },
  });
  expect(store.commit).toHaveBeenCalledExactlyOnceWith('mock', saved);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['generate', 'edit'] as const)(
  'keeps the custom %s upstream identity immutable',
  async (operation) => {
    const config = imageConfigurationFixture();
    const model = config.models[0];
    const binding = model?.operations[operation];
    if (!model || !binding) throw new Error('Missing mock model binding.');
    const store = mockStore();
    store.read = vi.fn(async () => ({
      configuration: config,
      serialized: 'mock',
    }));
    await expect(
      createImageChannelsAdminService(store).saveModel({
        ...model,
        revision: config.revision,
        operations: {
          ...model.operations,
          [operation]: { ...binding, upstreamModel: 'changed-mock' },
        },
      })
    ).rejects.toThrow('Create a new image model identifier');
    expect(store.commit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  }
);

it('keeps the public channel reader free of administration methods', () => {
  const reader = createImageChannelsReader(mockStore());
  expect(reader).not.toHaveProperty('saveModel');
  expect(reader).not.toHaveProperty('saveChannel');
  expect(reader).not.toHaveProperty('syncModels');
});

function storeWithConfiguration(config: ImageChannelsConfiguration) {
  const store = mockStore();
  store.read = vi.fn(async () => ({
    configuration: config,
    serialized: 'mock',
  }));
  return store;
}

it('rejects oversized active parameter sets before saving a model or calling the supplier', async () => {
  const config = largeImageParameterFixture();
  const model = config.models[0];
  if (!model) throw new Error('Missing mock capacity model.');
  const store = storeWithConfiguration({ ...config, models: [] });
  await expect(
    createImageChannelsAdminService(store).saveModel({
      ...model,
      revision: config.revision,
    })
  ).rejects.toThrow(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR);
  expect(store.commit).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects enabling a channel whose active models exceed the snapshot budget', async () => {
  const config = largeImageParameterFixture();
  const channel = config.channels[0];
  if (!channel) throw new Error('Missing mock capacity channel.');
  channel.enabled = false;
  const store = storeWithConfiguration(config);
  await expect(
    createImageChannelsAdminService(store).saveChannel({
      id: channel.id,
      name: channel.name,
      baseUrl: channel.baseUrl,
      protocol: channel.protocol,
      enabled: true,
      revision: config.revision,
    })
  ).rejects.toThrow(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR);
  expect(store.commit).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['channel', 'model'] as const)(
  'allows disabling an oversized %s to recover the configuration',
  async (target) => {
    const config = largeImageParameterFixture();
    const channel = config.channels[0];
    const model = config.models[0];
    if (!channel || !model)
      throw new Error('Missing mock capacity configuration.');
    const store = storeWithConfiguration(config);
    const service = createImageChannelsAdminService(store);
    if (target === 'channel') {
      await service.saveChannel({
        id: channel.id,
        name: channel.name,
        baseUrl: channel.baseUrl,
        protocol: channel.protocol,
        enabled: false,
        revision: config.revision,
      });
    } else {
      await service.saveModel({
        ...model,
        enabled: false,
        revision: config.revision,
      });
    }
    expect(store.commit).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  }
);

it('accepts a large registry whose shared parameter and price dictionaries fit the workflow budget', async () => {
  const config = imageRoutingCapacityFixture(120);
  const model = config.models[0];
  if (!model) throw new Error('Missing mock shared capacity model.');
  const store = storeWithConfiguration(config);
  const saved = await createImageChannelsAdminService(store).saveModel({
    ...model,
    revision: config.revision,
  });
  expect(saved.models).toHaveLength(120);
  expect(store.commit).toHaveBeenCalledExactlyOnceWith('mock', saved);
  expect(fetchMock).not.toHaveBeenCalled();
});
