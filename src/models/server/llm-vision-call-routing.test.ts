import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as tanstackAi from '@tanstack/ai';
import * as compatibleSdk from '@tanstack/ai-openai/compatible';
import * as openRouterSdk from '@tanstack/ai-openrouter';
import * as geminiSdk from '@tanstack/ai-gemini';
import * as grokSdk from '@tanstack/ai-grok';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { TextModel } from '@/models/models';
import type { TextModelRoute } from '@/models/text-channels';
import type { ResolvedLlmKey } from './db/api-keys';
import type {
  ChatMessage,
  getChatPrompt,
} from '@/platform/server/ai/prompts-index';
import type { toVisionImageSource } from '@/platform/server/storage/external-url';
import type { geminiStillSource, releaseGeminiFiles } from './gemini-files';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { analysisModelSupportsVision } from '@/models/models.config';
import { resetGoogleRegionBlock } from '@/models/google-region';
import { asStub } from '@/test/as-stub';

const MODES = ['durable', 'streaming'] as const;
const TEXT_MODEL = 'deepseek/deepseek-v3.2';
const ADMIN_VISION_MODEL = 'x-ai/grok-4.7';
const CUSTOM_MODEL = 'custom:mock-vision-boundary';
const IMAGE_URL = 'https://vision-boundary.invalid/still.png';
const SYSTEM_PROMPT = 'Mock vision boundary instructions';
const USER_PROMPT = 'Mock vision boundary request';
const CONFIGURED_OUTPUT_BUDGET = 2_000;
const NATIVE_OUTPUT_BUDGET = 250_000;
const RESULT = { visual: { fullPrompt: 'Mock local vision result' } };
const RESULT_TEXT = JSON.stringify(RESULT);
const RESPONSE_SCHEMA = z.object({
  visual: z.object({ fullPrompt: z.string() }),
});

type Mode = (typeof MODES)[number];
type MockChatOptions = {
  adapter: unknown;
  messages: ChatMessage[];
  systemPrompts: string[];
  stream: boolean;
  modelOptions: Record<string, unknown>;
};
type Scenario = {
  label: string;
  requestedModel: TextModel;
  expectedModel: TextModel;
  snapshot: TextModelRoute[];
  key: ResolvedLlmKey;
  attachesImage: boolean;
  modelOptions: Record<string, unknown>;
};

// Provider chat, image reads, billing, realtime and observability are test doubles.
const mockChat =
  vi.fn<
    (options: MockChatOptions) => AsyncGenerator<Record<string, unknown>>
  >();
const mockCompatibleText = vi.fn(compatibleSdk.openaiCompatibleText);
const mockCreateOpenRouterText = vi.fn(openRouterSdk.createOpenRouterText);
const mockOpenRouterText = vi.fn(openRouterSdk.openRouterText);
const mockCreateGeminiChat = vi.fn(geminiSdk.createGeminiChat);
const mockCreateGrokText = vi.fn(grokSdk.createGrokText);
const mockDeduct = vi.fn(async () => undefined);
const mockEmit = vi.fn(async () => undefined);
const mockFetch = vi.fn<typeof fetch>();
const mockImageSource = vi.fn<typeof toVisionImageSource>(async (value) => ({
  type: 'url',
  value,
}));
const mockGeminiStill = vi.fn<typeof geminiStillSource>();
const mockReleaseGemini = vi.fn<typeof releaseGeminiFiles>(
  async () => undefined
);
const mockGetChatPrompt = vi.fn<typeof getChatPrompt>(async () => ({
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT },
  ],
}));

vi.doMock('#env', () => ({ getEnv: () => ({ E2E_TEST: 'true' }) }));
vi.doMock('@tanstack/ai', () => ({ ...tanstackAi, chat: mockChat }));
vi.doMock('@tanstack/ai-openai/compatible', () => ({
  ...compatibleSdk,
  openaiCompatibleText: mockCompatibleText,
}));
vi.doMock('@tanstack/ai-openrouter', () => ({
  ...openRouterSdk,
  createOpenRouterText: mockCreateOpenRouterText,
  openRouterText: mockOpenRouterText,
}));
vi.doMock('@tanstack/ai-gemini', () => ({
  ...geminiSdk,
  createGeminiChat: mockCreateGeminiChat,
}));
vi.doMock('@tanstack/ai-grok', () => ({
  ...grokSdk,
  createGrokText: mockCreateGrokText,
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: mockDeduct,
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: () => [],
}));
vi.doMock('@/platform/server/ai/prompts-index', () => ({
  getChatPrompt: mockGetChatPrompt,
}));
vi.doMock('@/platform/server/storage/external-url', () => ({
  toVisionImageSource: mockImageSource,
}));
vi.doMock('./gemini-files', () => ({
  geminiStillSource: mockGeminiStill,
  releaseGeminiFiles: mockReleaseGemini,
}));
vi.doMock('@/platform/realtime', () => ({
  getShotPromptChannel: () => ({ emit: mockEmit }),
}));

const { durableLLMCallCf, durableStreamingLLMCallCf } =
  await import('./llm-call-helper');

function route(
  modelId: TextModel,
  vision: boolean,
  protocol: TextModelRoute['protocol'] = 'openai-chat-completions'
): TextModelRoute {
  return {
    modelId,
    name: 'Mock vision boundary deployment',
    channelId: 'mock-vision-channel',
    credentialId: 'mock-vision-credential',
    upstreamModel: 'mock-vision-deployment',
    protocol,
    baseUrl: 'https://vision-boundary.invalid/v1',
    vision,
    structuredOutput: true,
    tools: false,
    contextWindow: 8_000,
    maxOutputTokens: CONFIGURED_OUTPUT_BUDGET,
    inputPricePerMillion: 1,
    outputPricePerMillion: 2,
  };
}

function compatibleKey(route: TextModelRoute): ResolvedLlmKey {
  return {
    key: 'mock-configured-vision-key',
    source: 'platform',
    via: 'compatible',
    route,
  };
}

const WITH_IMAGE_SCENARIOS: Scenario[] = [
  {
    label: 'drops images when the actual compatible route disallows them',
    requestedModel: CUSTOM_MODEL,
    expectedModel: CUSTOM_MODEL,
    snapshot: [route(CUSTOM_MODEL, true)],
    key: compatibleKey(route(CUSTOM_MODEL, false)),
    attachesImage: false,
    modelOptions: {
      max_tokens: CONFIGURED_OUTPUT_BUDGET,
      stream_options: { include_usage: true },
    },
  },
  {
    label: 'uses native fallback vision even when its snapshot says text-only',
    requestedModel: TEXT_MODEL,
    expectedModel: ADMIN_VISION_MODEL,
    snapshot: [route(ADMIN_VISION_MODEL, false)],
    key: { key: 'mock-native-vision-key', source: 'platform', via: 'xai' },
    attachesImage: true,
    modelOptions: {
      reasoning: { effort: 'low' },
      max_output_tokens: NATIVE_OUTPUT_BUDGET,
    },
  },
  {
    label: 'uses compatible vision for a statically text-only model',
    requestedModel: TEXT_MODEL,
    expectedModel: TEXT_MODEL,
    snapshot: [route(TEXT_MODEL, true, 'openai-responses')],
    key: compatibleKey(route(TEXT_MODEL, true, 'openai-responses')),
    attachesImage: true,
    modelOptions: { max_output_tokens: CONFIGURED_OUTPUT_BUDGET },
  },
];

const NO_IMAGE_SCENARIO: Scenario = {
  label: 'keeps the requested text-only model without image input',
  requestedModel: CUSTOM_MODEL,
  expectedModel: CUSTOM_MODEL,
  snapshot: [route(CUSTOM_MODEL, false)],
  key: compatibleKey(route(CUSTOM_MODEL, false)),
  attachesImage: false,
  modelOptions: {
    max_tokens: CONFIGURED_OUTPUT_BUDGET,
    stream_options: { include_usage: true },
  },
};

async function* successfulChat() {
  yield { type: 'TEXT_MESSAGE_CONTENT', delta: RESULT_TEXT };
  yield {
    type: 'CUSTOM',
    name: 'structured-output.complete',
    value: { object: RESULT, raw: RESULT_TEXT },
  };
  yield {
    type: 'RUN_FINISHED',
    usage: {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cost: 1,
    },
  };
}

function workflowCall(scenario: Scenario, mode: Mode, withImage = true) {
  let inStep = false;
  const resolveLlmKey = vi.fn(
    async (model?: string): Promise<ResolvedLlmKey> => {
      expect(inStep).toBe(true);
      expect(model).toBe(scenario.expectedModel);
      return scenario.key;
    }
  );
  const scopedDb = asStub<WorkflowScopedDb>({
    models: {
      ...DEFAULT_MODEL_CONFIGURATION,
      vision: ADMIN_VISION_MODEL,
      textModelRouting: scenario.snapshot,
    },
    credentials: { resolveLlmKey },
  });
  const step = asStub<WorkflowStep>({
    do: async (_name: string, run: () => Promise<unknown>) => {
      inStep = true;
      try {
        return await run();
      } finally {
        inStep = false;
      }
    },
  });
  const config = {
    name: 'vision-boundary',
    phase: { number: 1, name: 'Mock vision boundary' },
    promptName: 'mock-vision-boundary',
    modelId: scenario.requestedModel,
    responseSchema: RESPONSE_SCHEMA,
    ...(withImage && { visionImageUrls: [IMAGE_URL] }),
  };
  const context = {
    promptLocale: 'en' as const,
    workflowRunId: 'mock-vision-boundary-run',
    scopedDb,
    ...(mode === 'streaming' && {
      shotPromptStream: { shotId: 'mock-shot', promptType: 'visual' as const },
    }),
  };
  const run =
    mode === 'streaming' ? durableStreamingLLMCallCf : durableLLMCallCf;
  return { run: () => run(step, config, context), resolveLlmKey };
}

function expectChatInput(scenario: Scenario) {
  expect(mockChat).toHaveBeenCalledOnce();
  const options = mockChat.mock.calls[0]?.[0];
  if (!options) throw new Error('Expected one mock chat call');
  const content = scenario.attachesImage
    ? [
        { type: 'text', content: USER_PROMPT },
        { type: 'image', source: { type: 'url', value: IMAGE_URL } },
      ]
    : USER_PROMPT;
  expect(options.messages).toEqual([{ role: 'user', content }]);
  expect(options.systemPrompts).toEqual([SYSTEM_PROMPT]);
  expect(options.stream).toBe(true);
  expect(options.modelOptions).toEqual(scenario.modelOptions);
  expect(mockImageSource.mock.calls).toEqual(
    scenario.attachesImage ? [[IMAGE_URL]] : []
  );
  expect(mockReleaseGemini).toHaveBeenCalledExactlyOnceWith(
    [],
    scenario.key.key
  );
}

function expectProvider(scenario: Scenario) {
  if (scenario.key.via === 'compatible') {
    const { route } = scenario.key;
    expect(mockCompatibleText).toHaveBeenCalledExactlyOnceWith(
      route.upstreamModel,
      expect.objectContaining({
        baseURL: route.baseUrl,
        apiKey: scenario.key.key,
        api:
          route.protocol === 'openai-responses'
            ? 'responses'
            : 'chat-completions',
        maxRetries: 0,
      })
    );
    expect(mockCreateGrokText).not.toHaveBeenCalled();
    expect(mockChat.mock.calls[0]?.[0].adapter).toBe(
      mockCompatibleText.mock.results[0]?.value
    );
    return;
  }
  expect(scenario.key.via).toBe('xai');
  expect(mockCreateGrokText).toHaveBeenCalledExactlyOnceWith(
    'grok-4.7',
    scenario.key.key,
    expect.objectContaining({ fetch: expect.any(Function) })
  );
  expect(mockCompatibleText).not.toHaveBeenCalled();
  expect(mockChat.mock.calls[0]?.[0].adapter).toBe(
    mockCreateGrokText.mock.results[0]?.value
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGoogleRegionBlock();
  mockChat.mockImplementation(successfulChat);
  mockFetch.mockRejectedValue(new Error('Unexpected real network request'));
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockCreateOpenRouterText).not.toHaveBeenCalled();
  expect(mockOpenRouterText).not.toHaveBeenCalled();
  expect(mockCreateGeminiChat).not.toHaveBeenCalled();
  expect(mockGeminiStill).not.toHaveBeenCalled();
  resetGoogleRegionBlock();
  vi.unstubAllGlobals();
});

describe.each(MODES)('%s actual-key vision boundary', (mode) => {
  it.each(WITH_IMAGE_SCENARIOS)('$label', async (scenario) => {
    expect(analysisModelSupportsVision(TEXT_MODEL)).toBe(false);
    expect(analysisModelSupportsVision(ADMIN_VISION_MODEL)).toBe(true);
    const call = workflowCall(scenario, mode);
    await expect(call.run()).resolves.toEqual(RESULT);
    expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
      scenario.expectedModel
    );
    expectChatInput(scenario);
    expectProvider(scenario);
    expect(mockDeduct).toHaveBeenCalledOnce();
  });

  it(NO_IMAGE_SCENARIO.label, async () => {
    const call = workflowCall(NO_IMAGE_SCENARIO, mode, false);
    await expect(call.run()).resolves.toEqual(RESULT);
    expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(CUSTOM_MODEL);
    expectChatInput(NO_IMAGE_SCENARIO);
    expectProvider(NO_IMAGE_SCENARIO);
  });
});
