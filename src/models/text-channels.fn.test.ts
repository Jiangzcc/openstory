import { beforeEach, expect, it, vi } from 'vitest';
import { asStub } from '@/test/as-stub';
import type { TextModelRoutingSnapshot } from './text-channels';
import { TEXT_CHANNEL_PROTOCOL } from './text-channels';

const adminGate = { name: 'mock-system-admin-middleware' };
const loadSnapshot = vi.fn<() => Promise<TextModelRoutingSnapshot>>();
type HandlerInput = {
  data?: unknown;
  context: {
    adminScopedDb: {
      textChannels: {
        get: () => Promise<unknown>;
        saveChannel: (input: unknown) => Promise<unknown>;
        saveModel: (input: unknown) => Promise<unknown>;
        syncModels: (input: unknown) => Promise<unknown>;
      };
    };
  };
};
type FnHarness = {
  method: string;
  middlewares: unknown[];
  validation: unknown;
  run: (input: HandlerInput) => Promise<unknown>;
};

function createFnHarness(options: { method: string }) {
  const state = {
    method: options.method,
    middlewares: [] as unknown[],
    validation: undefined as unknown,
  };
  return {
    middleware(middlewares: unknown[]) {
      state.middlewares = middlewares;
      return this;
    },
    validator(validation: unknown) {
      state.validation = validation;
      return this;
    },
    handler(run: FnHarness['run']): FnHarness {
      return { ...state, run };
    },
  };
}

vi.doMock('@tanstack/react-start', () => ({ createServerFn: createFnHarness }));
vi.doMock('@/platform/middleware.fn', () => ({
  systemAdminMiddleware: adminGate,
}));
vi.doMock('@/platform/server/db/scoped', () => ({
  loadTextModelRoutingSnapshot: loadSnapshot,
}));
const functions = await import('./text-channels.fn');
const adminRead = asStub<FnHarness>(functions.getAdminTextChannelsFn);
const saveChannel = asStub<FnHarness>(functions.saveTextChannelFn);
const saveModel = asStub<FnHarness>(functions.saveChannelTextModelFn);
const syncModels = asStub<FnHarness>(functions.syncTextChannelModelsFn);
const publicRead = asStub<FnHarness>(functions.getTextModelCatalogFn);

function mockContext() {
  return {
    adminScopedDb: {
      textChannels: {
        get: vi.fn(async () => ({ revision: 0, channels: [], models: [] })),
        saveChannel: vi.fn(async (input: unknown) => input),
        saveModel: vi.fn(async (input: unknown) => input),
        syncModels: vi.fn(async () => ({
          channelId: 'mock-channel',
          candidates: [],
        })),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSnapshot.mockResolvedValue([]);
});

it('applies the existing system-admin gate to every administrative server function', () => {
  for (const action of [adminRead, saveChannel, saveModel, syncModels]) {
    expect(action.middlewares).toEqual([adminGate]);
  }
  expect(adminRead.method).toBe('GET');
  for (const action of [saveChannel, saveModel, syncModels]) {
    expect(action.method).toBe('POST');
    expect(action.validation).toBeDefined();
  }
});

it('delegates administrative operations only to the scoped service surface', async () => {
  const context = mockContext();
  const data = { revision: 3, id: 'mock-channel' };
  await adminRead.run({ context });
  await saveChannel.run({ context, data });
  await saveModel.run({ context, data });
  await syncModels.run({ context, data });
  const scoped = context.adminScopedDb.textChannels;
  expect(scoped.get).toHaveBeenCalledOnce();
  expect(scoped.saveChannel).toHaveBeenCalledWith(data);
  expect(scoped.saveModel).toHaveBeenCalledWith(data);
  expect(scoped.syncModels).toHaveBeenCalledWith(data);
});

it('returns only public incremental model metadata without the routing or credential descriptors', async () => {
  loadSnapshot.mockResolvedValue([
    {
      modelId: 'custom:example',
      name: 'Example model',
      channelId: 'mock-channel',
      upstreamModel: 'private/upstream',
      protocol: TEXT_CHANNEL_PROTOCOL,
      baseUrl: 'https://10.0.0.5/v1',
      credentialId: 'mock-credential-id',
      vision: true,
      structuredOutput: true,
      tools: true,
      contextWindow: 32_000,
      maxOutputTokens: 8_000,
      inputPricePerMillion: 0.2,
      outputPricePerMillion: 0.6,
    },
  ]);
  expect(publicRead.middlewares).toEqual([]);
  const result = await publicRead.run({ context: mockContext() });
  expect(result).toMatchObject([
    { id: 'custom:example', name: 'Example model', tools: true },
  ]);
  const serialized = JSON.stringify(result);
  for (const value of [
    'private/upstream',
    'mock-channel',
    '10.0.0.5',
    'mock-credential-id',
  ]) {
    expect(serialized).not.toContain(value);
  }
  expect(loadSnapshot).toHaveBeenCalledOnce();
});
