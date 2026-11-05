import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_FAL_PRICING } from '@/billing/fal-pricing-fixture';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type {
  TextModelRoute,
  TextModelRoutingSnapshot,
} from '@/models/text-channels';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { asStub } from '@/test/as-stub';
import { createSequenceSchema } from './sequence.schemas';

const CUSTOM_ROUTE: TextModelRoute = {
  modelId: 'custom:request-model',
  name: 'Request model',
  channelId: 'test-channel',
  upstreamModel: 'upstream-model',
  credentialId: 'test-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://models.example/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};

const triggerStoryboard = vi.fn(async () => ({ workflowRunId: 'mock-run' }));
vi.doMock('./launchers', async () => ({
  ...(await vi.importActual('./launchers')),
  triggerStoryboard,
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://example.test', { headers: { 'cf-ipcountry': 'CN' } }),
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => TEST_FAL_PRICING,
}));

vi.doMock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.doMock('@/look/server/bump-style-popularity', () => ({
  bumpStylePopularity: vi.fn(),
}));
const { createSequences } = await import('./create-sequences');

function context(
  snapshot: TextModelRoutingSnapshot,
  opts: {
    teamModels?: readonly string[];
    sceneSplit?: typeof CUSTOM_ROUTE.modelId;
    canAfford?: boolean;
  } = {}
) {
  const create = vi.fn(
    async (input: { id: string; analysisModel: string }) => input
  );
  const listPage = vi.fn(async () => []);
  const resolveLlmKey = vi.fn(async (model: string) => ({
    key: 'mock-resolved-key',
    source: opts.teamModels?.includes(model) ? 'team' : 'platform',
  }));
  const createReservation = vi.fn(async () =>
    opts.canAfford ? { ok: true, reservationId: 'mock-hold' } : { ok: false }
  );
  const configuration = {
    ...DEFAULT_MODEL_CONFIGURATION,
    ...(opts.sceneSplit ? { sceneSplit: opts.sceneSplit } : {}),
  };
  const scopedDb = asStub<ScopedDb>({
    apiKeys: { hasUsableKey: vi.fn(async () => true), resolveLlmKey },
    billing: {
      createReservation,
      hasEnoughCredits: async () => opts.canAfford ?? false,
    },
    textChannels: { getSnapshot: vi.fn(async () => snapshot) },
    modelConfiguration: { get: async () => configuration },
    sequences: { create, listPage },
    styles: { getById: async () => ({ sequenceId: null }) },
  });
  return {
    scopedDb,
    user: { id: 'u' },
    teamId: 't',
    create,
    listPage,
    resolveLlmKey,
    createReservation,
    configuration,
  };
}

const input = (analysisModel: string) =>
  createSequenceSchema.parse({
    script: 'A cyclist races home.',
    aspectRatio: '16:9',
    styleId: 'style-1',
    analysisModels: [analysisModel],
    generateStartFrames: true,
    generateVoices: false,
    stopAt: 'script',
  });
beforeEach(() => vi.clearAllMocks());

describe('custom sequence creation request routing', () => {
  it('stores the selected custom id and forwards the same configuration to the launcher', async () => {
    const snapshot = [CUSTOM_ROUTE];
    const c = context(snapshot);
    const result = await createSequences(input(CUSTOM_ROUTE.modelId), c);
    expect(c.create).toHaveBeenCalledWith(
      expect.objectContaining({ analysisModel: CUSTOM_ROUTE.modelId })
    );
    expect(result.sequences[0]?.analysisModel).toBe(CUSTOM_ROUTE.modelId);
    expect(c.scopedDb.textChannels.getSnapshot).toHaveBeenCalledOnce();
    expect(triggerStoryboard).toHaveBeenCalledWith(
      c.scopedDb,
      expect.anything(),
      {
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: snapshot,
      }
    );
  });

  it.each([
    { snapshot: [] },
    { snapshot: [{ ...CUSTOM_ROUTE, structuredOutput: false }] },
  ])(
    'refuses missing or incapable custom models before any sequence write',
    async ({ snapshot }) => {
      const c = context(snapshot);
      await expect(
        createSequences(input(CUSTOM_ROUTE.modelId), c)
      ).rejects.toThrow('available analysis model');
      expect(c.create).not.toHaveBeenCalled();
      expect(c.listPage).not.toHaveBeenCalled();
      expect(triggerStoryboard).not.toHaveBeenCalled();
    }
  );
});

describe('sequence platform text reservations', () => {
  it('rejects an unfunded custom model even with usable fal and OpenRouter keys', async () => {
    const c = context([CUSTOM_ROUTE]);
    await expect(
      createSequences({ ...input(CUSTOM_ROUTE.modelId), stopAt: 'images' }, c)
    ).rejects.toThrow('Insufficient credits');
    expect(c.create).not.toHaveBeenCalled();
    expect(triggerStoryboard).not.toHaveBeenCalled();
    expect(c.resolveLlmKey).toHaveBeenCalledWith(CUSTOM_ROUTE.modelId, [
      CUSTOM_ROUTE,
    ]);
  });

  it('checks the platform scene-split helper even when the selected analysis uses a team key', async () => {
    const model = 'openai/gpt-5.4-mini';
    const c = context([CUSTOM_ROUTE], {
      teamModels: [model],
      sceneSplit: CUSTOM_ROUTE.modelId,
    });
    await expect(
      createSequences({ ...input(model), stopAt: 'images' }, c)
    ).rejects.toThrow('Insufficient credits');
    expect(c.resolveLlmKey).toHaveBeenCalledWith(CUSTOM_ROUTE.modelId, [
      CUSTOM_ROUTE,
    ]);
    expect(c.create).not.toHaveBeenCalled();
  });

  it('keeps zero-balance BYOK generation when every text call resolves to the team', async () => {
    const model = 'openai/gpt-5.4-mini';
    const c = context([], {
      teamModels: [model, DEFAULT_MODEL_CONFIGURATION.sceneSplit],
    });
    await createSequences({ ...input(model), stopAt: 'images' }, c);
    expect(c.createReservation).not.toHaveBeenCalled();
    expect(triggerStoryboard).toHaveBeenCalledOnce();
  });

  it('forwards the funded hold and the same route snapshot to the workflow', async () => {
    const c = context([CUSTOM_ROUTE], { canAfford: true });
    await createSequences(
      { ...input(CUSTOM_ROUTE.modelId), stopAt: 'images' },
      c
    );
    expect(triggerStoryboard).toHaveBeenCalledWith(
      c.scopedDb,
      expect.objectContaining({ reservationId: 'mock-hold' }),
      { ...c.configuration, textModelRouting: [CUSTOM_ROUTE] }
    );
  });

  it('preserves script-only generation without balance or credential preflight', async () => {
    const c = context([CUSTOM_ROUTE]);
    await createSequences(input(CUSTOM_ROUTE.modelId), c);
    expect(c.resolveLlmKey).not.toHaveBeenCalled();
    expect(c.createReservation).not.toHaveBeenCalled();
    expect(triggerStoryboard).toHaveBeenCalledOnce();
  });
});
