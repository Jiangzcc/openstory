import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/platform/server/ai/prompts-index';
import { DEFAULT_MODEL_CONFIGURATION } from './model-configuration';
import { SUPPORTED_LOCALES } from '@/platform/i18n/locale';

const handlers = new Map<unknown, (input: unknown) => unknown>();
vi.doMock('@tanstack/react-start', async () => ({
  ...(await vi.importActual('@tanstack/react-start')),
  createServerFn: () => ({
    middleware() {
      return this;
    },
    validator() {
      return this;
    },
    handler(handler: (input: unknown) => unknown) {
      const rpc = () => {};
      handlers.set(rpc, handler);
      return rpc;
    },
  }),
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://example.test', {
      headers: { 'x-real-ip': '127.0.0.1' },
    }),
}));
vi.doMock('@/platform/middleware.fn', () => ({
  authWithOrganizationMiddleware: {},
}));
vi.doMock('@/shots/shot-access.fn', () => ({ shotAccessMiddleware: {} }));
vi.doMock('@/sequences/server/script-enhancement', () => ({
  prepareBilling: async () => ({
    llmKey: { key: 'mock', via: 'openrouter', source: 'organization' },
  }),
  streamScriptEnhancement: vi.fn(),
}));
const mockStream = vi.fn((_input: { messages: ChatMessage[] }) =>
  (async function* () {
    yield {
      done: true,
      accumulated: 'Lena waits in the rain.',
      model: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      via: 'openrouter',
      parsed: {
        durationSeconds: 5,
        recommendations: [{ index: 0, score: 90, reasoning: 'Fits.' }],
      },
    };
  })()
);
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream: mockStream,
  llmCostFromUsage: () => 0,
}));

const { shortenPromptFn, estimateSceneDurationFn, recommendStylesForScriptFn } =
  await import('./ai.fn');
const script = 'Lena says "Stay here." 雨声继续。';
const scopedDb = {
  textChannels: { getSnapshot: async () => [] },
  modelConfiguration: { get: async () => DEFAULT_MODEL_CONFIGURATION },
  styles: {
    list: async () => [
      {
        id: 'style-1',
        name: '雨景 Noir',
        description: 'Low-key rain',
        usageCount: 2,
        config: {
          mood: 'tense',
          artStyle: 'noir',
          lighting: 'low-key',
          colorPalette: ['#111111'],
          cameraWork: 'static',
          referenceFilms: [],
          colorGrading: 'muted',
        },
      },
    ],
  },
};

beforeEach(() => vi.clearAllMocks());

describe('auxiliary final system prompt language', () => {
  it.each(SUPPORTED_LOCALES)(
    'sends %s instructions and preserves source material',
    async (promptLocale) => {
      const context = {
        promptLocale,
        scopedDb,
        user: { id: 'user' },
        organizationId: 'org',
        sequence: {
          analysisModel: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
        },
        shot: { id: 'shot' },
        scene: { metadata: { title: 'Lena 原景', location: 'Rain street' } },
      };
      await handlers.get(shortenPromptFn)?.({
        context,
        data: { prompt: script },
      });
      await handlers.get(estimateSceneDurationFn)?.({
        context,
        data: { extract: script },
      });
      await handlers.get(recommendStylesForScriptFn)?.({
        context,
        data: { script, limit: 1 },
      });
      expect(mockStream).toHaveBeenCalledTimes(3);
      const instructions =
        promptLocale === 'zh-CN'
          ? ['你擅长压缩', '你估算单个场景', '你是一名创意导演']
          : [
              'You are an expert',
              'You estimate',
              'You are a creative director',
            ];
      for (const [index, [input]] of mockStream.mock.calls.entries()) {
        expect(input.messages[0]?.content).toContain(instructions[index]);
        expect(input.messages[1]?.content).toContain(script);
      }
      const duration = mockStream.mock.calls[1]?.[0].messages;
      expect(duration?.[0]?.content).toContain('durationSeconds');
      expect(duration?.[1]?.content).toContain('Lena 原景');
      expect(mockStream.mock.calls[2]?.[0].messages[1]?.content).toContain(
        '雨景 Noir'
      );
    }
  );
});
