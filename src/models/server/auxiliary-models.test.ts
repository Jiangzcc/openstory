import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micros } from '@/billing/money';
import type { AnalysisModelId } from '@/models/models.config';

const CONFIGURED_MODEL: AnalysisModelId = 'google/gemini-3.8-flash';
const ANSWERING_MODEL: AnalysisModelId = 'z-ai/glm-5.3-flash';
let servedModel: AnalysisModelId = ANSWERING_MODEL;
let servedVia: 'google' | 'llmtr' = 'llmtr';
const COST = micros(235);
const usage = { inputTokens: 20, outputTokens: 10 };
const mockCost = vi.fn(() => COST);
const mockStream = vi.fn(() =>
  (async function* () {
    yield {
      done: true,
      accumulated: 'A slow camera move past Image1.',
      model: servedModel,
      via: servedVia,
      usage,
      parsed: {
        description: 'A red cup.',
        consistencyTag: 'red-cup',
        suggestedToken: 'CUP',
      },
    };
  })()
);
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream: mockStream,
  llmCostFromUsage: mockCost,
}));
vi.doMock('@/platform/server/storage/external-url', () => ({
  toVisionImageSource: async (value: string) => ({ type: 'url', value }),
}));

const { describeElementImage } = await import('@/cast/server/element-vision');
const { analyzeTalentMedia, analyzeTalentClip } =
  await import('@/cast/server/talent-vision');
const { draftStudioPrompt } =
  await import('@/studio/server/studio-prompt-draft');

beforeEach(() => {
  vi.clearAllMocks();
  servedModel = ANSWERING_MODEL;
  servedVia = 'llmtr';
});

describe('configured auxiliary image models', () => {
  it.each([
    [
      'element',
      () =>
        describeElementImage({
          promptLocale: 'en' as const,
          model: CONFIGURED_MODEL,
          imageUrl: '/r2/a.png',
          filename: 'cup.png',
        }),
    ],
    [
      'talent',
      () =>
        analyzeTalentMedia({
          promptLocale: 'en' as const,
          model: CONFIGURED_MODEL,
          imageUrls: ['/r2/a.png'],
        }),
    ],
    [
      'Studio draft',
      () =>
        draftStudioPrompt({
          promptLocale: 'en' as const,
          model: CONFIGURED_MODEL,
          activity: 'video',
          references: [],
        }),
    ],
  ] as const)(
    '%s calls the supplied model and prices the answering model and via',
    async (_name, run) => {
      const result = await run();
      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ model: CONFIGURED_MODEL })
      );
      expect(mockCost).toHaveBeenCalledWith(usage, ANSWERING_MODEL, 'llmtr');
      expect(result.model).toBe(ANSWERING_MODEL);
      expect(result.costMicros).toBe(COST);
    }
  );
});

describe('configured native talent clip model', () => {
  it('accepts a verdict from the configured Gemini model instead of requiring the old default', async () => {
    const model: AnalysisModelId = 'google/gemini-4-argon';
    servedModel = model;
    servedVia = 'google';
    const result = await analyzeTalentClip({
      promptLocale: 'en' as const,
      model,
      clip: { uri: 'https://files.example/clip', mimeType: 'video/mp4' },
      llmKey: { key: 'test-google', source: 'platform', via: 'google' },
    });
    expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ model }));
    expect(result.model).toBe(model);
    expect(mockCost).toHaveBeenCalledWith(usage, model, 'google');
  });
});
