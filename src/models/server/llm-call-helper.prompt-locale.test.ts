import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import type { Locale } from '@/platform/i18n/locale';
import { getChatPrompt } from '@/platform/server/ai/prompts-index';
import { asStub } from '@/test/as-stub';
import { z } from 'zod';
import * as tanstackAi from '@tanstack/ai';
import * as adapterModule from './create-adapter';
import * as realtimeModule from '@/platform/realtime';

type CapturedRequest = {
  systemPrompts: string[];
  messages: { role: string; content: unknown }[];
  outputSchema: unknown;
};

const result = {
  prompt: 'A quiet street. BONDI_SCREEN. "Do not translate me."',
};
async function* completion() {
  yield {
    type: 'CUSTOM',
    name: 'structured-output.complete',
    value: { object: result, raw: JSON.stringify(result) },
  };
}
const mockChat = vi.fn((_options: CapturedRequest) => completion());
const mockChannel = vi.fn(() => ({ emit: vi.fn(async () => undefined) }));

vi.doMock('@tanstack/ai', () => ({ ...tanstackAi, chat: mockChat }));
vi.doMock('./create-adapter', () => ({
  ...adapterModule,
  createAdapter: vi.fn(() => ({ kind: 'text', name: 'mock' })),
  getPlatformLlmKey: () => ({
    key: 'mock-key',
    source: 'platform',
    via: 'openrouter',
  }),
}));
vi.doMock('@/platform/realtime', () => ({
  ...realtimeModule,
  getShotPromptChannel: mockChannel,
}));

const { durableLLMCallCf, durableStreamingLLMCallCf } =
  await import('./llm-call-helper');

const originalPrompt = '雨夜，BONDI_SCREEN。Alice says: "Do not translate me."';
const variables = { prompt: originalPrompt, rejection: 'unexpected result' };
const responseSchema = z.object({ prompt: z.string() });
const config = {
  name: 'mock-localized-rewrite',
  phase: { number: 1, name: 'Mock rewrite' },
  promptName: 'phase/soften-image-prompt-chat',
  promptVariables: variables,
  modelId: 'x-ai/grok-4.7' as const,
  responseSchema,
};
const step = asStub<WorkflowStep>({
  do: (_name: string, fn: () => Promise<unknown>) => fn(),
});

beforeEach(() => vi.clearAllMocks());

async function expectActualTemplate(locale: Locale, streaming: boolean) {
  const context = { promptLocale: locale, workflowRunId: 'mock-run' };
  const output = streaming
    ? await durableStreamingLLMCallCf(step, config, {
        ...context,
        shotPromptStream: { shotId: 'mock-shot', promptType: 'visual' },
      })
    : await durableLLMCallCf(step, config, context);
  expect(output).toEqual(result);
  const request = mockChat.mock.calls[0]?.[0];
  if (!request) throw new Error('Mock model did not receive a request');
  const template = await getChatPrompt(config.promptName, variables, locale);
  expect(request.systemPrompts).toEqual(
    template.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
  );
  expect(request.systemPrompts[0]).toContain(
    locale === 'zh-CN' ? '你要改写被图片模型拒绝' : 'You rewrite a cinematic'
  );
  expect(request.messages).toEqual(
    template.messages.filter((message) => message.role !== 'system')
  );
  expect(JSON.stringify(request.messages)).toContain(
    JSON.stringify(originalPrompt).slice(1, -1)
  );
  expect(request.outputSchema).toBe(responseSchema);
  expect(mockChannel).toHaveBeenCalledTimes(streaming ? 1 : 0);
}

describe('real localized templates reach the mocked model', () => {
  it.each(['en', 'zh-CN'] as const)(
    'uses %s for the durable structured call and preserves user text',
    async (locale) => expectActualTemplate(locale, false)
  );

  it.each(['en', 'zh-CN'] as const)(
    'uses %s for the shot streaming call and preserves user text',
    async (locale) => expectActualTemplate(locale, true)
  );
});
