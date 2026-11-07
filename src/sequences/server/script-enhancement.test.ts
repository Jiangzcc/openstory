import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequestParams, StreamChunk } from '@/models/server/llm-client';
import type { EnhanceScriptInput } from '@/models/ai.fn';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import type { AnalysisModelId } from '@/models/models.config';
import type { ImageToVideoModel } from '@/models/models';
import { micros } from '@/billing/money';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { asStub } from '@/test/as-stub';
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

const getRequestHeader = vi.fn<(name: string) => string | undefined>();
vi.doMock('@tanstack/react-start/server', () => ({ getRequestHeader }));

const SCRIPT = 'Scene 1 — 30s\nA cyclist races home.\nTOTAL: 30s';
const SERVED_MODEL: AnalysisModelId = 'z-ai/glm-5.3-flash';
const COST = micros(375);
const usage = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };
const mockCost = vi.fn(() => COST);
const callLLMStream = vi.fn(
  (_params: LLMRequestParams): AsyncGenerator<StreamChunk> =>
    (async function* () {
      yield { done: false, delta: SCRIPT, accumulated: SCRIPT };
      yield {
        done: true,
        delta: '',
        accumulated: SCRIPT,
        parsed: undefined,
        usage,
        model: SERVED_MODEL,
        via: 'llmtr',
      };
    })()
);
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream,
  ENHANCE_REASONING: 'low',
  llmCostFromUsage: mockCost,
}));

const { streamScriptEnhancement, enhanceScriptToString } =
  await import('./script-enhancement');

function context(
  source: 'organization' | 'platform' = 'organization',
  models: ModelConfiguration = DEFAULT_MODEL_CONFIGURATION,
  snapshot: TextModelRoutingSnapshot = []
) {
  const resolveLlmKey = vi.fn(async () => ({ source, via: 'openrouter' }));
  const getModelConfiguration = vi.fn(async () => models);
  const scopedDb = asStub<ScopedDb>({
    modelConfiguration: { get: getModelConfiguration },
    textChannels: { getSnapshot: vi.fn(async () => snapshot) },
    billing: { hasEnoughCredits: async () => true, deductCredits: vi.fn() },
    apiKeys: {
      resolveLlmKey,
    },
  });
  return {
    promptLocale: 'en' as const,
    scopedDb,
    userId: 'u1',
    organizationId: 't1',
    resolveLlmKey,
    getModelConfiguration,
  };
}

beforeEach(() => {
  getRequestHeader.mockReset();
  callLLMStream.mockClear();
  mockCost.mockClear();
});

describe('Enhance user location', () => {
  it.each([
    [' au ', 'AU'],
    [undefined, ''],
    ['XX', ''],
    ['T1', ''],
  ])(
    'compiles request country %s into the streaming prompt',
    async (header, expected) => {
      getRequestHeader.mockReturnValue(header);
      const script = 'A British visitor cycles through Tokyo.';

      let result = '';
      for await (const chunk of streamScriptEnhancement(
        { script },
        context()
      )) {
        result += chunk.delta;
      }

      expect(result).toContain('A cyclist races home.');
      expect(getRequestHeader).toHaveBeenCalledWith('cf-ipcountry');
      const messages = callLLMStream.mock.calls[0]?.[0].messages;
      expect(messages?.[0]?.content).toContain(
        `User country (ISO country code; unavailable when empty): ${expected}\n`
      );
      expect(messages?.[0]?.content).not.toContain('{{userCountry}}');
      expect(messages?.[1]?.content).toContain(script);
    }
  );

  it('also passes the country when the API invents a script from scratch', async () => {
    getRequestHeader.mockReturnValue('NZ');

    await enhanceScriptToString({ script: '', invent: true }, context());

    const messages = callLLMStream.mock.calls[0]?.[0].messages;
    expect(messages?.[0]?.content).toContain(
      'User country (ISO country code; unavailable when empty): NZ\n'
    );
    expect(messages?.[1]?.content).toContain('Invent an original short video');
  });
});

const CONFIGURED_ANALYSIS: AnalysisModelId = 'google/gemini-3.8-flash';
const CONFIGURED_VIDEO: ImageToVideoModel = 'minimax_h3_max';
const SELECTED_ANALYSIS: AnalysisModelId = 'openai/gpt-6-luna';
const SELECTED_VIDEO: ImageToVideoModel = 'seedance_v2_5';
const models: ModelConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  defaultAnalysis: CONFIGURED_ANALYSIS,
  defaultVideo: CONFIGURED_VIDEO,
};
const selectionCases = [
  {
    name: 'omitted models',
    selection: {},
    analysis: CONFIGURED_ANALYSIS,
    video: CONFIGURED_VIDEO,
  },
  {
    name: 'explicit models',
    selection: { analysisModel: SELECTED_ANALYSIS, videoModel: SELECTED_VIDEO },
    analysis: SELECTED_ANALYSIS,
    video: SELECTED_VIDEO,
  },
  {
    name: 'explicit analysis only',
    selection: { analysisModel: SELECTED_ANALYSIS },
    analysis: SELECTED_ANALYSIS,
    video: CONFIGURED_VIDEO,
  },
  {
    name: 'explicit video only',
    selection: { videoModel: SELECTED_VIDEO },
    analysis: CONFIGURED_ANALYSIS,
    video: SELECTED_VIDEO,
  },
] satisfies Array<{
  name: string;
  selection: Partial<EnhanceScriptInput>;
  analysis: AnalysisModelId;
  video: ImageToVideoModel;
}>;

describe('configured script enhancement defaults', () => {
  it.each(selectionCases)(
    'resolves $name and prices the answering model',
    async ({ selection, analysis, video }) => {
      const c = context('platform', models);
      await enhanceScriptToString(
        { script: 'A cyclist races home.', ...selection },
        c
      );
      expect(c.getModelConfiguration).toHaveBeenCalledOnce();
      expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(analysis, []);
      expect(callLLMStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: analysis,
          metadata: expect.objectContaining({ videoModel: video }),
        })
      );
      expect(mockCost).toHaveBeenCalledWith(usage, SERVED_MODEL, 'llmtr');
      expect(c.scopedDb.billing.deductCredits).toHaveBeenCalledWith(
        COST,
        expect.objectContaining({ metadata: { model: analysis } })
      );
    }
  );
});

it('keeps the user custom model and reuses its snapshot on region retries', async () => {
  const snapshot = [CUSTOM_ROUTE];
  const c = context('organization', DEFAULT_MODEL_CONFIGURATION, snapshot);
  await enhanceScriptToString(
    { script: 'A cyclist races home.', analysisModel: CUSTOM_ROUTE.modelId },
    c
  );
  expect(c.scopedDb.textChannels.getSnapshot).toHaveBeenCalledOnce();
  expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
    CUSTOM_ROUTE.modelId,
    snapshot
  );
  const request = callLLMStream.mock.calls[0]?.[0];
  expect(request?.model).toBe(CUSTOM_ROUTE.modelId);
  await request?.resolveApiKey?.(SERVED_MODEL);
  expect(c.resolveLlmKey).toHaveBeenLastCalledWith(SERVED_MODEL, snapshot);
});

it('uses a custom default from the server configuration', async () => {
  const c = context(
    'organization',
    { ...DEFAULT_MODEL_CONFIGURATION, defaultAnalysis: CUSTOM_ROUTE.modelId },
    [CUSTOM_ROUTE]
  );
  await enhanceScriptToString({ script: 'A cyclist races home.' }, c);
  expect(callLLMStream).toHaveBeenCalledWith(
    expect.objectContaining({ model: CUSTOM_ROUTE.modelId })
  );
});

it('rejects a disabled or unregistered custom id before resolving keys', async () => {
  const c = context();
  await expect(
    enhanceScriptToString(
      {
        script: 'A cyclist races home.',
        analysisModel: CUSTOM_ROUTE.modelId,
      },
      c
    )
  ).rejects.toThrow('unavailable');
  expect(c.resolveLlmKey).not.toHaveBeenCalled();
  expect(callLLMStream).not.toHaveBeenCalled();
});

it('rejects image inputs when the custom model has no vision capability', async () => {
  const c = context('organization', DEFAULT_MODEL_CONFIGURATION, [
    { ...CUSTOM_ROUTE, vision: false },
  ]);
  await expect(
    enhanceScriptToString(
      {
        script: 'A cyclist races home.',
        analysisModel: CUSTOM_ROUTE.modelId,
        elements: [
          {
            token: '@Image1',
            imageUrl: 'https://cdn.example/cyclist.png',
            kind: 'image',
          },
        ],
      },
      c
    )
  ).rejects.toThrow('required capabilities');
  expect(c.resolveLlmKey).not.toHaveBeenCalled();
  expect(callLLMStream).not.toHaveBeenCalled();
});
