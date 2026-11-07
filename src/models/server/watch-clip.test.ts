import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micros } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { asStub } from '@/test/as-stub';
import type { ChatMessage } from '@/platform/server/ai/prompts-index';
import { SUPPORTED_LOCALES } from '@/platform/i18n/locale';

const MODEL = 'google/gemini-3.8-flash' as const;
const COST = micros(320);
const usage = { inputTokens: 50, outputTokens: 15 };
const key = { key: 'test-google', via: 'google', source: 'platform' } as const;
const mockDelete = vi.fn();
const mockUpload = vi.fn();
const mockCost = vi.fn(() => COST);
let servedModel: string = MODEL;
const mockStream = vi.fn((_options: { messages: ChatMessage[] }) =>
  (async function* () {
    yield {
      done: true,
      accumulated: 'A cup turns.',
      model: servedModel,
      via: 'google',
      usage,
    };
  })()
);
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream: mockStream,
  llmCostFromUsage: mockCost,
}));
vi.doMock('@/models/server/gemini-files', () => ({
  uploadClipToGemini: mockUpload,
  deleteGeminiFile: mockDelete,
}));
vi.doMock('#storage', () => ({
  storageObjectContentType: async () => 'video/mp4',
}));
const { watchClipForOrganization } = await import('./watch-clip');

function context() {
  const resolveLlmKey = vi.fn(
    async () =>
      ({
        key: 'mock-team-or',
        via: 'openrouter',
        source: 'organization',
      }) as const
  );
  const resolveOptionalKey = vi
    .fn<ScopedDb['apiKeys']['resolveOptionalKey']>()
    .mockResolvedValue(key);
  const deductCredits = vi.fn();
  const get = vi.fn(async () => ({
    ...DEFAULT_MODEL_CONFIGURATION,
    watchClip: MODEL,
  }));
  const scopedDb = asStub<ScopedDb>({
    userId: 'u',
    modelConfiguration: { get },
    apiKeys: { resolveLlmKey, resolveOptionalKey },
    billing: { hasEnoughCredits: async () => true, deductCredits },
  });
  return { scopedDb, resolveLlmKey, resolveOptionalKey, deductCredits, get };
}

beforeEach(() => {
  vi.clearAllMocks();
  servedModel = MODEL;
  mockDelete.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue({
    uri: 'https://files.example/clip',
    name: 'files/clip',
    mimeType: 'video/mp4',
  });
});

describe('configured assistant clip model', () => {
  it.each(SUPPORTED_LOCALES)(
    'sends %s instructions without translating the question',
    async (locale) => {
      const c = context();
      const question = 'Lena 说 "Stay here." 后发生了什么？';
      await watchClipForOrganization(
        c.scopedDb,
        { url: '/r2/talent/t/clip.mp4', question },
        locale
      );
      const messages = mockStream.mock.calls[0]?.[0].messages;
      expect(messages?.[0]?.content).toContain(
        locale === 'zh-CN'
          ? '你正在为电影创作者观看'
          : 'You are watching a clip'
      );
      const content = messages?.[1]?.content;
      expect(Array.isArray(content) ? content[0] : undefined).toEqual({
        type: 'text',
        content: question,
      });
    }
  );
  it('resolves, watches and bills the server-selected model', async () => {
    const c = context();
    const result = await watchClipForOrganization(
      c.scopedDb,
      {
        url: '/r2/talent/t/clip.mp4',
        question: 'What moves?',
      },
      'en'
    );
    expect(c.get).toHaveBeenCalledOnce();
    expect(c.resolveOptionalKey).toHaveBeenCalledExactlyOnceWith('google');
    expect(c.resolveLlmKey).not.toHaveBeenCalled();
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL, apiKey: key })
    );
    expect(mockCost).toHaveBeenCalledWith(usage, MODEL, 'google');
    expect(c.deductCredits).toHaveBeenCalledWith(
      COST,
      expect.objectContaining({ metadata: { model: MODEL } })
    );
    expect(mockDelete).toHaveBeenCalledExactlyOnceWith('files/clip', key.key);
    expect(result.model).toBe(MODEL);
  });

  it('refuses a verdict from another model and deletes the file without billing', async () => {
    const c = context();
    servedModel = 'z-ai/glm-5.3-flash';
    await expect(
      watchClipForOrganization(
        c.scopedDb,
        {
          url: '/r2/talent/t/clip.mp4',
          question: 'What moves?',
        },
        'en'
      )
    ).rejects.toThrow('answered on');
    expect(c.deductCredits).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  it('requires native Google before uploading or billing', async () => {
    const c = context();
    c.resolveOptionalKey.mockResolvedValue(undefined);
    await expect(
      watchClipForOrganization(
        c.scopedDb,
        {
          url: '/r2/talent/t/clip.mp4',
          question: 'What moves?',
        },
        'en'
      )
    ).rejects.toThrow('Gemini API key');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(c.deductCredits).not.toHaveBeenCalled();
  });
});
