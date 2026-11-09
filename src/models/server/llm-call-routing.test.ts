import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as tanstackAi from '@tanstack/ai';
import * as compatibleSdk from '@tanstack/ai-openai/compatible';
import * as openRouterSdk from '@tanstack/ai-openrouter';
import * as geminiSdk from '@tanstack/ai-gemini';
import * as grokSdk from '@tanstack/ai-grok';
import type { TokenUsage } from '@tanstack/ai';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { TextModel } from '@/models/models';
import type { TextModelRoute } from '@/models/text-channels';
import type { ResolvedLlmKey } from './db/api-keys';
import type { StreamChunk } from './llm-client';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  DEFAULT_TEXT_CHANNEL_USER_AGENT,
  TEXT_CHANNEL_PROTOCOLS,
} from '@/models/text-channels';
import { resetGoogleRegionBlock } from '@/models/google-region';
import { usdToMicros } from '@/billing/money';
import { asStub } from '@/test/as-stub';

const MODEL_IDS = {
  grok: 'x-ai/grok-4.7',
  gemini: 'google/gemini-3.8-flash',
  llmtrChat: 'z-ai/glm-5.3-flash',
  llmtrResponses: 'x-ai/grok-4.20',
} as const;
const TOKENS = {
  requested: 1_024,
  excessive: 12_000,
  configured: 2_000,
  grok: 250_000,
  gemini: 65_536,
  glm: 131_072,
  llmtrGrok: 1_000_000,
};
const COST_USD = {
  grok: 0.00256,
  gemini: 0.0015,
  router: 0.027,
  llmtrChat: 0.000125,
  llmtrResponses: 0.00175,
  configured: 0.0008,
};
const MOCK_SUPPLIER_COST_USD = 999;
const MOCK_USAGE: TokenUsage = {
  promptTokens: 1_000,
  completionTokens: 200,
  totalTokens: 1_200,
};
const MOCK_RESULT = { visual: { fullPrompt: 'Mock validated result' } };
const MOCK_DRAFT = { visual: { fullPrompt: 'Mock streamed draft' } };
const MOCK_TEXT = JSON.stringify(MOCK_DRAFT);
const RESPONSE_SCHEMA = z.object({
  visual: z.object({ fullPrompt: z.string() }),
});
const MOCK_APP_URL = 'http://localhost:3000';
const MOCK_APP_NAME = 'Mock route regression';
const MOCK_STEP_NAME = 'route-regression';
const MOCK_WORKFLOW_ID = 'mock-routing-workflow';
const MOCK_PHASE = { number: 1, name: 'Mock routing phase' };
const EXECUTORS = [
  'callLLM',
  'callLLMStream',
  'durableLLMCallCf',
  'durableStreamingLLMCallCf',
] as const;
type Executor = (typeof EXECUTORS)[number];
type MockFinalChunk = Extract<StreamChunk<typeof MOCK_RESULT>, { done: true }>;
type MockChatOptions = {
  adapter: unknown;
  stream: boolean;
  modelOptions: Record<string, unknown>;
  outputSchema?: unknown;
};

function mockConfiguredRoute(
  modelId: TextModel,
  protocol: TextModelRoute['protocol']
): TextModelRoute {
  return {
    modelId,
    protocol,
    name: 'Mock administrator binding',
    channelId: 'mock-channel',
    credentialId: 'mock-admin-credential',
    upstreamModel: 'mock-admin-deployment',
    baseUrl: 'https://mock-routing.invalid/v1',
    vision: true,
    structuredOutput: true,
    tools: true,
    contextWindow: 8_000,
    maxOutputTokens: TOKENS.configured,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
  };
}

const MOCK_KEYS = {
  xai: { key: 'mock-native-xai-key', source: 'platform', via: 'xai' },
  google: { key: 'mock-native-google-key', source: 'platform', via: 'google' },
  openrouter: {
    key: 'mock-organization-router-key',
    source: 'organization',
    via: 'openrouter',
  },
  fal: { key: 'mock-organization-fal-key', source: 'organization', via: 'fal' },
  llmtr: {
    key: 'mock-organization-llmtr-key',
    source: 'organization',
    via: 'llmtr',
  },
  compatibleGrok: {
    key: 'mock-administrator-grok-key',
    source: 'platform',
    via: 'compatible',
    route: mockConfiguredRoute(
      MODEL_IDS.grok,
      TEXT_CHANNEL_PROTOCOLS.chatCompletions
    ),
  },
  compatibleGemini: {
    key: 'mock-administrator-gemini-key',
    source: 'platform',
    via: 'compatible',
    route: mockConfiguredRoute(
      MODEL_IDS.gemini,
      TEXT_CHANNEL_PROTOCOLS.responses
    ),
  },
} satisfies Record<string, ResolvedLlmKey>;

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
const mockMissingCost = vi.fn();
const mockEmit = vi.fn(async () => undefined);
const mockFetch = vi.fn<typeof fetch>();
const MOCK_FACTORIES = {
  xai: mockCreateGrokText,
  google: mockCreateGeminiChat,
  openrouter: mockCreateOpenRouterText,
  compatible: mockCompatibleText,
};

vi.doMock('#env', () => ({
  getEnv: () => ({
    OPENROUTER_KEY: 'mock-platform-router-key',
    FAL_KEY: 'mock-platform-fal-key',
    XAI_API_KEY: MOCK_KEYS.xai.key,
    GEMINI_API_KEY: MOCK_KEYS.google.key,
    VITE_APP_URL: MOCK_APP_URL,
    VITE_APP_NAME: MOCK_APP_NAME,
    E2E_TEST: 'true',
  }),
}));
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
vi.doMock('@/billing/billing-observability', () => ({
  reportMissingBillingCost: mockMissingCost,
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: () => [],
}));
vi.doMock('@/platform/server/ai/prompts-index', () => ({
  getChatPrompt: async () => ({
    messages: [{ role: 'user', content: 'Mock routing request' }],
  }),
}));
vi.doMock('@/platform/realtime', () => ({
  getShotPromptChannel: () => ({ emit: mockEmit }),
}));

const { callLLM, callLLMStream, llmCostFromUsage } =
  await import('./llm-client');
const { durableLLMCallCf, durableStreamingLLMCallCf } =
  await import('./llm-call-helper');

// SDK factories stay real; SDK execution, workflow steps, billing and realtime are mocks.
async function* mockSdkStream(usage: TokenUsage) {
  yield { type: 'TEXT_MESSAGE_CONTENT', delta: MOCK_TEXT };
  yield {
    type: 'CUSTOM',
    name: 'structured-output.complete',
    value: { object: MOCK_RESULT, raw: JSON.stringify(MOCK_RESULT) },
  };
  yield { type: 'RUN_FINISHED', usage };
}

type RoutingScenario = {
  label: string;
  model: TextModel;
  key: ResolvedLlmKey;
  factory: keyof typeof MOCK_FACTORIES;
  wireModel: string;
  api?: 'chat-completions' | 'responses';
  costUsd: number;
  usage: TokenUsage;
  dormantBinding?: boolean;
  reasoning?: boolean;
  clientOptions: Record<string, unknown>;
  durableOptions: Record<string, unknown>;
};
const ROUTING_SCENARIOS: RoutingScenario[] = [
  {
    label: 'native Grok',
    model: MODEL_IDS.grok,
    key: MOCK_KEYS.xai,
    factory: 'xai',
    wireModel: 'grok-4.7',
    usage: MOCK_USAGE,
    costUsd: COST_USD.grok,
    clientOptions: {
      max_output_tokens: TOKENS.requested,
      temperature: undefined,
      top_p: undefined,
    },
    durableOptions: {
      max_output_tokens: TOKENS.grok,
      reasoning: { effort: 'low' },
    },
  },
  {
    label: 'native Gemini',
    model: MODEL_IDS.gemini,
    key: MOCK_KEYS.google,
    factory: 'google',
    wireModel: 'gemini-3.8-flash',
    usage: MOCK_USAGE,
    costUsd: COST_USD.gemini,
    clientOptions: {
      maxOutputTokens: TOKENS.requested,
      temperature: undefined,
      topP: undefined,
      frequencyPenalty: undefined,
      presencePenalty: undefined,
    },
    durableOptions: { maxOutputTokens: TOKENS.gemini },
  },
  {
    label: 'Grok with organization OpenRouter',
    model: MODEL_IDS.grok,
    key: MOCK_KEYS.openrouter,
    factory: 'openrouter',
    wireModel: MODEL_IDS.grok,
    dormantBinding: true,
    usage: { ...MOCK_USAGE, cost: COST_USD.router },
    costUsd: COST_USD.router,
    clientOptions: {
      provider: { requireParameters: true },
      serviceTier: 'priority',
      maxTokens: TOKENS.requested,
      streamOptions: { includeUsage: true },
    },
    durableOptions: {
      provider: { requireParameters: true },
      maxTokens: TOKENS.grok,
      streamOptions: { includeUsage: true },
    },
  },
  {
    label: 'Gemini with organization fal',
    model: MODEL_IDS.gemini,
    key: MOCK_KEYS.fal,
    factory: 'openrouter',
    wireModel: MODEL_IDS.gemini,
    dormantBinding: true,
    usage: { ...MOCK_USAGE, cost: COST_USD.router },
    costUsd: COST_USD.router,
    clientOptions: {
      provider: { requireParameters: true },
      serviceTier: 'priority',
      maxTokens: TOKENS.requested,
      streamOptions: { includeUsage: true },
    },
    durableOptions: {
      provider: { requireParameters: true },
      maxTokens: TOKENS.gemini,
      streamOptions: { includeUsage: true },
    },
  },
  {
    label: 'LLMTR Chat Completions',
    model: MODEL_IDS.llmtrChat,
    key: MOCK_KEYS.llmtr,
    factory: 'compatible',
    wireModel: 'zai/glm-5.3-flash',
    api: 'chat-completions',
    usage: MOCK_USAGE,
    costUsd: COST_USD.llmtrChat,
    clientOptions: { max_tokens: TOKENS.requested, reasoning_effort: 'low' },
    durableOptions: { max_tokens: TOKENS.glm, reasoning_effort: 'low' },
  },
  {
    label: 'LLMTR Responses',
    model: MODEL_IDS.llmtrResponses,
    key: MOCK_KEYS.llmtr,
    factory: 'compatible',
    wireModel: 'xai/grok-4.20-0309-reasoning',
    api: 'responses',
    reasoning: true,
    usage: MOCK_USAGE,
    costUsd: COST_USD.llmtrResponses,
    clientOptions: {
      max_output_tokens: TOKENS.requested,
      reasoning: { effort: 'medium' },
    },
    durableOptions: {
      max_output_tokens: TOKENS.llmtrGrok,
      reasoning: { effort: 'medium' },
    },
  },
  {
    label: 'compatible Grok Chat Completions',
    model: MODEL_IDS.grok,
    key: MOCK_KEYS.compatibleGrok,
    factory: 'compatible',
    wireModel: 'mock-admin-deployment',
    api: 'chat-completions',
    usage: { ...MOCK_USAGE, cost: MOCK_SUPPLIER_COST_USD },
    costUsd: COST_USD.configured,
    clientOptions: {
      max_tokens: TOKENS.configured,
      stream_options: { include_usage: true },
    },
    durableOptions: {
      max_tokens: TOKENS.configured,
      stream_options: { include_usage: true },
    },
  },
  {
    label: 'compatible Gemini Responses',
    model: MODEL_IDS.gemini,
    key: MOCK_KEYS.compatibleGemini,
    factory: 'compatible',
    wireModel: 'mock-admin-deployment',
    api: 'responses',
    usage: { ...MOCK_USAGE, cost: MOCK_SUPPLIER_COST_USD },
    costUsd: COST_USD.configured,
    clientOptions: { max_output_tokens: TOKENS.configured },
    durableOptions: { max_output_tokens: TOKENS.configured },
  },
];

function mockWorkflow(scenario: RoutingScenario, dormant: boolean) {
  const mockResolveLlmKey = vi.fn(async () => scenario.key);
  const textModelRouting =
    scenario.key.via === 'compatible'
      ? [scenario.key.route]
      : dormant
        ? [
            mockConfiguredRoute(
              scenario.model,
              TEXT_CHANNEL_PROTOCOLS.responses
            ),
          ]
        : [];
  const scopedDb = asStub<WorkflowScopedDb>({
    userId: 'mock-user',
    models: { ...DEFAULT_MODEL_CONFIGURATION, textModelRouting },
    credentials: { resolveLlmKey: mockResolveLlmKey },
  });
  const mockStepDo = vi.fn((_name: string, run: () => Promise<unknown>) =>
    run()
  );
  const step = asStub<WorkflowStep>({ do: mockStepDo });
  const config = {
    name: MOCK_STEP_NAME,
    phase: MOCK_PHASE,
    promptName: 'mock-routing-prompt',
    modelId: scenario.model,
    responseSchema: RESPONSE_SCHEMA,
    reasoning: scenario.reasoning,
  };
  const context = {
    promptLocale: 'en' as const,
    scopedDb,
    workflowRunId: MOCK_WORKFLOW_ID,
    shotPromptStream: { shotId: 'mock-shot', promptType: 'visual' as const },
  };
  return { scopedDb, mockResolveLlmKey, mockStepDo, step, config, context };
}

type MockWorkflow = ReturnType<typeof mockWorkflow>;
async function runExecutor(
  scenario: RoutingScenario,
  executor: Executor,
  workflow: MockWorkflow
): Promise<{ result: unknown; completed?: MockFinalChunk }> {
  const params = {
    model: scenario.model,
    apiKey: scenario.key,
    responseSchema: RESPONSE_SCHEMA,
    messages: [{ role: 'user' as const, content: 'Mock routing request' }],
    max_tokens:
      scenario.key.via === 'compatible' ? TOKENS.excessive : TOKENS.requested,
    ...(scenario.reasoning && {
      reasoning: { enabled: true, effort: 'medium' as const },
    }),
  };
  if (executor === 'callLLM') return { result: await callLLM(params) };
  if (executor === 'callLLMStream') {
    const chunks: StreamChunk<typeof MOCK_RESULT>[] = [];
    for await (const chunk of callLLMStream(params)) chunks.push(chunk);
    expect(chunks.filter((chunk) => !chunk.done)).toEqual([
      { delta: MOCK_TEXT, accumulated: MOCK_TEXT, done: false },
    ]);
    const completed = chunks.find((chunk) => chunk.done);
    if (!completed) throw new Error('Expected completed mock SDK stream');
    return { result: completed.parsed, completed };
  }
  const run =
    executor === 'durableLLMCallCf'
      ? durableLLMCallCf
      : durableStreamingLLMCallCf;
  return {
    result: await run(workflow.step, workflow.config, workflow.context),
  };
}

function expectCompatibleFactory(scenario: RoutingScenario) {
  const route =
    scenario.key.via === 'compatible' ? scenario.key.route : undefined;
  expect(mockCompatibleText).toHaveBeenCalledExactlyOnceWith(
    scenario.wireModel,
    {
      name: route ? 'configured-text-channel' : 'llmtr',
      baseURL: route?.baseUrl ?? 'https://llmtr.com/v1',
      apiKey: scenario.key.key,
      api: scenario.api,
      fetch: expect.any(Function),
      ...(route && {
        maxRetries: 0,
        defaultHeaders: { 'User-Agent': DEFAULT_TEXT_CHANNEL_USER_AGENT },
      }),
    }
  );
}

function expectRouterFactory(scenario: RoutingScenario) {
  expect(mockCreateOpenRouterText).toHaveBeenCalledExactlyOnceWith(
    scenario.wireModel,
    scenario.key.key,
    {
      httpReferer: MOCK_APP_URL,
      xTitle: MOCK_APP_NAME,
      ...(scenario.key.via === 'fal' && {
        serverURL: 'https://fal.run/openrouter/router/openai/v1',
        httpClient: expect.any(Object),
      }),
    }
  );
}

function expectAdapter(scenario: RoutingScenario) {
  for (const [name, factory] of Object.entries(MOCK_FACTORIES)) {
    expect(factory).toHaveBeenCalledTimes(name === scenario.factory ? 1 : 0);
  }
  expect(mockOpenRouterText).not.toHaveBeenCalled();
  const factory = MOCK_FACTORIES[scenario.factory];
  expect(mockChat.mock.calls[0]?.[0].adapter).toBe(
    factory.mock.results[0]?.value
  );
  if (scenario.factory === 'compatible')
    return expectCompatibleFactory(scenario);
  if (scenario.factory === 'openrouter') return expectRouterFactory(scenario);
  const factoryConfig =
    scenario.factory === 'xai' ? { fetch: expect.any(Function) } : {};
  expect(factory).toHaveBeenCalledExactlyOnceWith(
    scenario.wireModel,
    scenario.key.key,
    factoryConfig
  );
}

function expectCompletedUsage(
  scenario: RoutingScenario,
  completed: MockFinalChunk | undefined
) {
  if (!completed) return;
  const expectedUsage =
    scenario.key.via === 'compatible'
      ? { ...scenario.usage, cost: scenario.costUsd }
      : scenario.usage;
  expect(completed).toStrictEqual({
    done: true,
    delta: '',
    accumulated: MOCK_TEXT,
    parsed: MOCK_RESULT,
    model: scenario.model,
    via: scenario.key.via,
    usage: expectedUsage,
  });
  expect(
    llmCostFromUsage(completed.usage, completed.model, completed.via)
  ).toBe(usdToMicros(scenario.costUsd));
}

async function expectWorkflowBilling(
  scenario: RoutingScenario,
  executor: Executor,
  workflow: MockWorkflow
) {
  const durable =
    executor === 'durableLLMCallCf' || executor === 'durableStreamingLLMCallCf';
  if (!durable) {
    expect(workflow.mockResolveLlmKey).not.toHaveBeenCalled();
    expect(workflow.mockStepDo).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
    return;
  }
  expect(workflow.mockResolveLlmKey).toHaveBeenCalledExactlyOnceWith(
    scenario.model
  );
  const costMicros = usdToMicros(scenario.costUsd);
  expect(await workflow.mockStepDo.mock.results[1]?.value).toEqual({
    jsonText: JSON.stringify(MOCK_RESULT),
    costMicros,
    keySource: scenario.key.source,
  });
  expect(mockDeduct).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      scopedDb: workflow.scopedDb,
      costMicros,
      usedOwnKey: scenario.key.source === 'organization',
      idempotencyKey: MOCK_WORKFLOW_ID + ':llm-' + MOCK_STEP_NAME,
      metadata: expect.objectContaining({
        model: scenario.model,
        costMicros,
        phase: MOCK_PHASE.number,
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGoogleRegionBlock();
  mockFetch.mockRejectedValue(
    new Error('Unexpected real network request in routing regression')
  );
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockMissingCost).not.toHaveBeenCalled();
});

const ROUTING_CASES = ROUTING_SCENARIOS.flatMap((scenario) =>
  EXECUTORS.flatMap((executor) =>
    (scenario.dormantBinding &&
    (executor === 'durableLLMCallCf' ||
      executor === 'durableStreamingLLMCallCf')
      ? [false, true]
      : [false]
    ).map((dormant) => ({
      scenario,
      executor,
      dormant,
      label: scenario.label,
      binding:
        scenario.key.via === 'compatible'
          ? 'captured compatible route'
          : dormant
            ? 'dormant administrator binding'
            : 'no administrator routes',
    }))
  )
);
it.each(ROUTING_CASES)(
  '$label / $executor / $binding',
  async ({ scenario, executor, dormant }) => {
    mockChat.mockImplementation(() => mockSdkStream(scenario.usage));
    const workflow = mockWorkflow(scenario, dormant);
    const completed = await runExecutor(scenario, executor, workflow);
    expect(completed.result).toEqual(MOCK_RESULT);
    expectAdapter(scenario);
    const durable =
      executor === 'durableLLMCallCf' ||
      executor === 'durableStreamingLLMCallCf';
    expect(mockChat).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        stream: true,
        outputSchema: RESPONSE_SCHEMA,
        modelOptions: durable
          ? scenario.durableOptions
          : scenario.clientOptions,
      })
    );
    expect(mockChat.mock.calls[0]?.[0].modelOptions).toStrictEqual(
      durable ? scenario.durableOptions : scenario.clientOptions
    );
    expectCompletedUsage(scenario, completed.completed);
    await expectWorkflowBilling(scenario, executor, workflow);
    if (executor === 'durableStreamingLLMCallCf') {
      expect(mockEmit).toHaveBeenCalledExactlyOnceWith('shotPrompt.streaming', {
        promptType: 'visual',
        delta: MOCK_DRAFT.visual.fullPrompt,
      });
    } else expect(mockEmit).not.toHaveBeenCalled();
  }
);
