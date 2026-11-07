import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/platform/server/ai/prompts-index';
import { ZERO_MICROS } from '@/billing/money';

const mockStream = vi.fn((_options: { messages: ChatMessage[] }) =>
  (async function* () {
    yield {
      done: true,
      accumulated: 'Image1: Lena says "Stay here." She waits.',
      model: 'z-ai/glm-5.3-flash',
      via: 'openrouter',
    };
  })()
);
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream: mockStream,
  llmCostFromUsage: () => ZERO_MICROS,
}));
const { draftStudioPrompt } = await import('./studio-prompt-draft');

beforeEach(() => vi.clearAllMocks());

describe('Studio final prompt language', () => {
  it('isolates concurrent language choices and preserves user notes and model output', async () => {
    const currentPrompt = 'Lena says "Stay here." 雨声继续。';
    const shared = {
      model: 'z-ai/glm-5.3-flash',
      activity: 'video',
      references: [],
      currentPrompt,
    } satisfies Omit<Parameters<typeof draftStudioPrompt>[0], 'promptLocale'>;
    const [zh, en] = await Promise.all([
      draftStudioPrompt({ ...shared, promptLocale: 'zh-CN' }),
      draftStudioPrompt({ ...shared, promptLocale: 'en' }),
    ]);
    const requests = mockStream.mock.calls.map(([options]) => options.messages);
    const chinese = requests.find(
      (messages) =>
        typeof messages[0]?.content === 'string' &&
        messages[0].content.startsWith('你为 AI 视频')
    );
    const english = requests.find(
      (messages) =>
        typeof messages[0]?.content === 'string' &&
        messages[0].content.startsWith('You write prompts for an AI video')
    );
    expect(chinese).toBeDefined();
    expect(english).toBeDefined();
    for (const messages of requests) {
      const content = messages[1]?.content;
      expect(
        Array.isArray(content) && content[0]?.type === 'text'
          ? content[0].content
          : ''
      ).toContain(currentPrompt);
    }
    expect(zh.prompt).toBe('Image1: Lena says "Stay here." She waits.');
    expect(en.prompt).toBe(zh.prompt);
  });
});
