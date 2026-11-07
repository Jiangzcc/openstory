import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { Locale } from '@/platform/i18n/locale';

const callLLMStream = vi.fn();
vi.doMock('@/models/server/llm-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callLLMStream,
}));
vi.doMock('@/platform/server/storage/external-url', () => ({
  toVisionImageSource: async (value: string) => ({ type: 'url', value }),
}));

const { describeElementImage } = await import('./element-vision');

beforeEach(() => {
  vi.clearAllMocks();
  callLLMStream.mockImplementation(async function* () {
    yield {
      done: true,
      parsed: {
        description: 'An English description.',
        consistencyTag: 'silver-water-bottle',
        suggestedToken: 'WATER_BOTTLE',
      },
      model: DEFAULT_MODEL_CONFIGURATION.vision,
      via: 'openrouter',
    };
  });
});

describe('element vision prompt language', () => {
  it('selects real bilingual messages while preserving uploaded data and output', async () => {
    const filename = 'English_中文.png';
    const imageUrl = 'https://example.test/reference.png';
    const results = await Promise.all(
      (['zh-CN', 'en'] satisfies Locale[]).map((promptLocale) =>
        describeElementImage({
          promptLocale,
          model: DEFAULT_MODEL_CONFIGURATION.vision,
          filename,
          imageUrl,
        })
      )
    );
    const chinese = callLLMStream.mock.calls[0]?.[0];
    const english = callLLMStream.mock.calls[1]?.[0];
    expect(chinese.messages[0].content).toContain('你负责描述视觉参考素材');
    expect(english.messages[0].content).toContain(
      'You are a visual reference describer'
    );
    expect(chinese.messages[0].content).toContain('UPPERCASE_SNAKE_CASE');
    expect(chinese.messages[1].content[0].content).toContain(filename);
    expect(english.messages[1].content[0].content).toContain(filename);
    expect(chinese.messages[1].content[1]).toEqual({
      type: 'image',
      source: { type: 'url', value: imageUrl },
    });
    expect(results.map((result) => result.description)).toEqual([
      'An English description.',
      'An English description.',
    ]);
    expect(results.map((result) => result.suggestedToken)).toEqual([
      'WATER_BOTTLE',
      'WATER_BOTTLE',
    ]);
  });
});
