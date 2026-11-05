import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micros } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { asStub } from '@/test/as-stub';
import type { ModelConfiguration } from '@/models/model-configuration';
import type {
  TextModelRoute,
  TextModelRoutingSnapshot,
} from '@/models/text-channels';

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

const SHORTENING_MODEL = 'z-ai/glm-5.3-flash' as const;
const STYLE_MODEL = 'google/gemini-3.8-flash' as const;
const DEFAULT_ANALYSIS = 'openai/gpt-6-luna' as const;
const ANSWERING_MODEL = 'anthropic/claude-sonnet-5.5' as const;
const COST = micros(280);
const usage = { inputTokens: 50, outputTokens: 20 };
const mockCost = vi.fn(() => COST);
const mockStream = vi.fn(() =>
  (async function* () {
    yield {
      done: true,
      accumulated: 'A red cup on a wooden table.',
      usage,
      model: ANSWERING_MODEL,
      via: 'llmtr',
      parsed: {
        durationSeconds: 7,
        recommendations: [{ index: 0, score: 90, reasoning: 'Fits the mood.' }],
      },
    };
  })()
);
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream: mockStream,
  llmCostFromUsage: mockCost,
  RECOMMENDED_MODELS: { fast: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis },
}));
vi.doMock('@tanstack/react-start', async () => ({
  ...(await vi.importActual('@tanstack/react-start')),
  createServerFn: () => ({
    middleware() {
      return this;
    },
    validator() {
      return this;
    },
    handler(handler: unknown) {
      return handler;
    },
  }),
}));
vi.doMock('@tanstack/react-start/server', async () => ({
  ...(await vi.importActual('@tanstack/react-start/server')),
  getRequest: () =>
    new Request('https://example.test', {
      headers: { 'x-real-ip': 'test-models' },
    }),
}));
const { shortenPromptFn, recommendStylesForScriptFn, estimateSceneDurationFn } =
  await import('./ai.fn');

function testStyle() {
  return {
    id: 'style-1',
    name: 'Warm',
    description: 'Warm light.',
    usageCount: 1,
    config: {
      version: 2,
      look: {
        mood: 'warm',
        artStyle: 'film',
        lighting: 'soft',
        colorPalette: ['red'],
        colorGrading: 'warm',
      },
      motion: { camera: 'slow' },
      references: [],
    },
  };
}

function context(
  sequenceModel: string | null = null,
  configuration: Partial<ModelConfiguration> = {},
  snapshot: TextModelRoutingSnapshot = []
) {
  const resolveLlmKey = vi.fn(async () => ({
    key: 'test-key',
    via: 'openrouter',
    source: 'platform',
  }));
  const deductCredits = vi.fn();
  const get = vi.fn(async () => ({
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultAnalysis: DEFAULT_ANALYSIS,
    promptShortening: SHORTENING_MODEL,
    styleRecommendation: STYLE_MODEL,
    ...configuration,
  }));
  const style = testStyle();
  return {
    user: { id: 'u' },
    teamId: 't',
    sequence: { analysisModel: sequenceModel },
    shot: { id: 'shot-1' },
    scene: null,
    scopedDb: {
      apiKeys: { resolveLlmKey },
      modelConfiguration: { get },
      textChannels: { getSnapshot: vi.fn(async () => snapshot) },
      billing: { hasEnoughCredits: async () => true, deductCredits },
      styles: { list: async () => [style] },
    },
  };
}

type Handler = (input: {
  data: Record<string, unknown>;
  context: ReturnType<typeof context>;
}) => Promise<unknown>;
const shorten = asStub<Handler>(shortenPromptFn);
const recommend = asStub<Handler>(recommendStylesForScriptFn);
const estimateDuration = asStub<Handler>(estimateSceneDurationFn);

beforeEach(() => vi.clearAllMocks());

describe('request auxiliary model configuration', () => {
  it.each([
    [
      'shortening',
      shorten,
      { prompt: 'A red cup on a wooden table with warm light.' },
      SHORTENING_MODEL,
    ],
    [
      'style recommendation',
      recommend,
      { script: 'A cup turns on a table.' },
      STYLE_MODEL,
    ],
  ] as const)(
    '%s resolves the server model and prices actual usage',
    async (_name, run, data, model) => {
      const c = context();
      await run({
        data: {
          ...data,
          model: 'anthropic/claude-opus-5.5',
          modelConfiguration: { promptShortening: 'anthropic/claude-opus-5.5' },
        },
        context: c,
      });
      expect(c.scopedDb.modelConfiguration.get).toHaveBeenCalledOnce();
      expect(c.scopedDb.apiKeys.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
        model,
        []
      );
      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ model })
      );
      expect(mockCost).toHaveBeenCalledWith(usage, ANSWERING_MODEL, 'llmtr');
      expect(c.scopedDb.billing.deductCredits).toHaveBeenCalledWith(
        COST,
        expect.objectContaining({ metadata: { model } })
      );
    }
  );
});

describe('configured scene duration fallback', () => {
  it.each([null, 'unknown-model'])(
    'uses server defaultAnalysis for invalid sequence model %s',
    async (sequenceModel) => {
      const c = context(sequenceModel);
      const result = await estimateDuration({
        data: { extract: 'A cup turns.', model: STYLE_MODEL },
        context: c,
      });
      expect(result).toEqual({ durationSeconds: 7 });
      expect(c.scopedDb.modelConfiguration.get).toHaveBeenCalledOnce();
      expect(c.scopedDb.apiKeys.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
        DEFAULT_ANALYSIS,
        []
      );
      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ model: DEFAULT_ANALYSIS })
      );
      expect(mockCost).toHaveBeenCalledWith(usage, ANSWERING_MODEL, 'llmtr');
    }
  );

  it('preserves a valid sequence model without loading its default', async () => {
    const c = context(STYLE_MODEL);
    await estimateDuration({ data: { extract: 'A cup turns.' }, context: c });
    expect(c.scopedDb.modelConfiguration.get).not.toHaveBeenCalled();
    expect(c.scopedDb.apiKeys.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
      STYLE_MODEL,
      []
    );
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: STYLE_MODEL })
    );
  });
});

describe('custom auxiliary request routes', () => {
  it('uses a registered custom helper default without substituting', async () => {
    const snapshot = [CUSTOM_ROUTE];
    const c = context(
      null,
      { promptShortening: CUSTOM_ROUTE.modelId },
      snapshot
    );
    await shorten({
      data: { prompt: 'A red cup on a wooden table with warm light.' },
      context: c,
    });
    expect(c.scopedDb.apiKeys.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
      CUSTOM_ROUTE.modelId,
      snapshot
    );
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: CUSTOM_ROUTE.modelId })
    );
  });

  it('preserves a stored custom sequence model when estimating duration', async () => {
    const snapshot = [CUSTOM_ROUTE];
    const c = context(CUSTOM_ROUTE.modelId, {}, snapshot);
    await estimateDuration({ data: { extract: 'A cup turns.' }, context: c });
    expect(c.scopedDb.modelConfiguration.get).not.toHaveBeenCalled();
    expect(c.scopedDb.textChannels.getSnapshot).toHaveBeenCalledOnce();
    expect(c.scopedDb.apiKeys.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
      CUSTOM_ROUTE.modelId,
      snapshot
    );
  });

  it.each([
    { snapshot: [] },
    { snapshot: [{ ...CUSTOM_ROUTE, structuredOutput: false }] },
  ])(
    'rejects absent or schema-incapable custom duration models before dispatch',
    async ({ snapshot }) => {
      const c = context(CUSTOM_ROUTE.modelId, {}, snapshot);
      await expect(
        estimateDuration({ data: { extract: 'A cup turns.' }, context: c })
      ).rejects.toThrow('required capabilities');
      expect(c.scopedDb.apiKeys.resolveLlmKey).not.toHaveBeenCalled();
      expect(mockStream).not.toHaveBeenCalled();
    }
  );
});
