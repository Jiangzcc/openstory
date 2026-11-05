import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { TextModelRoute } from '@/models/text-channels';
import type { Database } from './client';
import type { ScopedDb } from './scoped';
import { asStub } from '@/test/as-stub';
import { toWorkflowScopedDb } from './scoped-workflow';

const store = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  resolveSecret: vi.fn(),
}));
vi.mock('#env', () => ({
  getEnv: () => ({ OPENROUTER_KEY: 'mock-platform-fallback' }),
}));
vi.mock('@/models/server/db/text-channels', () => ({
  createTextChannelsReadMethods: () => store,
}));
const { createApiKeysReadMethods } =
  await import('@/models/server/db/api-keys');

const ORIGINAL_ROUTE: TextModelRoute = {
  modelId: 'openai/gpt-5.4-mini',
  name: 'Mock configured model',
  channelId: 'mock-channel',
  upstreamModel: 'mock-original-upstream',
  credentialId: 'mock-original-credential',
  protocol: 'openai-responses',
  baseUrl: 'https://original.mock.invalid/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 1_000,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
};
const ORIGINAL: ModelRuntimeConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  textModelRouting: [ORIGINAL_ROUTE],
};

function mockScope() {
  const query = { limit: vi.fn(async () => []) };
  const db = asStub<Database>({
    select: () => ({ from: () => ({ where: () => query }) }),
  });
  const apiKeys = createApiKeysReadMethods(db, 'mock-team');
  return {
    apiKeys,
    scopedDb: asStub<ScopedDb>({ apiKeys, teamId: 'mock-team' }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getSnapshot.mockResolvedValue([ORIGINAL_ROUTE]);
  store.resolveSecret.mockImplementation(async (id: string) => {
    if (id === ORIGINAL_ROUTE.credentialId) return 'mock-original-secret';
    return 'mock-rotated-secret';
  });
});

describe('workflow execution model snapshots', () => {
  it('replays the compact endpoint, protocol, credential and rates after an admin edit', async () => {
    const queued = structuredClone(packModelRuntimeConfiguration(ORIGINAL));
    const replacement: TextModelRoute = {
      ...ORIGINAL_ROUTE,
      upstreamModel: 'mock-replacement-upstream',
      credentialId: 'mock-rotated-credential',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://replacement.mock.invalid/v1',
      inputPricePerMillion: 99,
    };
    store.getSnapshot.mockResolvedValue([replacement]);
    const workflow = toWorkflowScopedDb(mockScope().scopedDb, queued);
    for (let attempt = 0; attempt < 2; attempt++) {
      const resolved = await workflow.credentials.resolveLlmKey(
        ORIGINAL_ROUTE.modelId
      );
      expect(resolved).toEqual({
        key: 'mock-original-secret',
        source: 'platform',
        via: 'compatible',
        route: ORIGINAL_ROUTE,
      });
    }
    expect(store.getSnapshot).not.toHaveBeenCalled();
    expect(store.resolveSecret).toHaveBeenCalledWith(
      ORIGINAL_ROUTE.credentialId
    );
    const fresh = await mockScope().apiKeys.resolveLlmKey(
      ORIGINAL_ROUTE.modelId
    );
    expect(fresh).toMatchObject({
      key: 'mock-rotated-secret',
      route: replacement,
    });
    expect(store.getSnapshot).toHaveBeenCalledOnce();
  });

  it('fails a bound credential lookup instead of using an available fallback or newer channel', async () => {
    const workflow = toWorkflowScopedDb(
      mockScope().scopedDb,
      packModelRuntimeConfiguration(ORIGINAL)
    );
    store.resolveSecret.mockRejectedValue(
      new Error('Mock frozen credential unavailable')
    );
    await expect(
      workflow.credentials.resolveLlmKey(ORIGINAL_ROUTE.modelId)
    ).rejects.toThrow('Mock frozen credential unavailable');
    expect(store.getSnapshot).not.toHaveBeenCalled();
    expect(store.resolveSecret).toHaveBeenCalledExactlyOnceWith(
      ORIGINAL_ROUTE.credentialId
    );
    const unbound = await mockScope().apiKeys.resolveLlmKey(
      ORIGINAL_ROUTE.modelId,
      []
    );
    expect(unbound).toMatchObject({
      key: 'mock-platform-fallback',
      via: 'openrouter',
    });
  });

  it('retains legacy flat routes and code defaults without loading current channel settings', async () => {
    const legacy = toWorkflowScopedDb(mockScope().scopedDb, ORIGINAL);
    expect(
      await legacy.credentials.resolveLlmKey(ORIGINAL_ROUTE.modelId)
    ).toMatchObject({ key: 'mock-original-secret', route: ORIGINAL_ROUTE });
    const absent = toWorkflowScopedDb(mockScope().scopedDb);
    expect(absent.models).toEqual(DEFAULT_MODEL_CONFIGURATION);
    expect(
      await absent.credentials.resolveLlmKey(ORIGINAL_ROUTE.modelId)
    ).toMatchObject({ via: 'openrouter' });
    expect(store.getSnapshot).not.toHaveBeenCalled();
  });

  it('keeps an explicit empty routing override for native-only operations', async () => {
    const workflow = toWorkflowScopedDb(
      mockScope().scopedDb,
      packModelRuntimeConfiguration(ORIGINAL)
    );
    expect(
      await workflow.credentials.resolveLlmKey(ORIGINAL_ROUTE.modelId, [])
    ).toMatchObject({ via: 'openrouter' });
    expect(store.resolveSecret).not.toHaveBeenCalled();
    expect(store.getSnapshot).not.toHaveBeenCalled();
  });
});
