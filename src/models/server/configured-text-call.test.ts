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
import type { TextModelRoute } from '@/models/text-channels';
import type { ResolvedLlmKey } from './db/api-keys';
import type { LLMRequestParams, StreamChunk } from './llm-client';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  isGoogleRegionBlockedHere,
  resetGoogleRegionBlock,
} from '@/models/google-region';
import { usdToMicros, ZERO_MICROS } from '@/billing/money';
import { asStub } from '@/test/as-stub';

const MODEL_IDS = {
  custom: 'custom:configured-call-test',
  grok: 'x-ai/grok-4.7',
  gemini: 'google/gemini-3.8-flash',
  anthropic: 'anthropic/claude-sonnet-5.5',
} as const;
const COST_MODELS = [MODEL_IDS.custom, MODEL_IDS.grok, MODEL_IDS.gemini];
const MOCK_API_KEY = 'mock-configured-text-key';
const PROVIDER_COST = 999;
const EXPECTED_USD = 0.0008;
const SUPPLIER_USAGE: TokenUsage = {
  promptTokens: 1_000,
  completionTokens: 200,
  totalTokens: 1_200,
  cost: PROVIDER_COST,
};
const MOCK_RESULT = { visual: { fullPrompt: 'Mock configured text output' } };
const RESULT_TEXT = JSON.stringify(MOCK_RESULT);
const RESPONSE_SCHEMA = z.object({
  visual: z.object({ fullPrompt: z.string() }),
});
const ROUTE_DEFAULTS = {
  name: 'Mock configured text model',
  channelId: 'mock-channel',
  credentialId: 'mock-credential',
  upstreamModel: 'mock-upstream-deployment',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://configured-text.invalid/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 8_000,
  maxOutputTokens: 2_000,
  inputPricePerMillion: 0.5,
  outputPricePerMillion: 1.5,
} as const;
const WORKFLOW_MODES = ['durable', 'streaming'] as const;
type WorkflowMode = (typeof WORKFLOW_MODES)[number];
type MockChatOptions = {
  adapter: unknown;
  stream: boolean;
  modelOptions: Record<string, unknown>;
  outputSchema?: unknown;
};

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

vi.doMock('#env', () => ({
  getEnv: () => ({
    OPENROUTER_KEY: 'mock-openrouter-key',
    FAL_KEY: 'mock-fal-key',
    XAI_API_KEY: 'mock-xai-key',
    GEMINI_API_KEY: 'mock-google-key',
    VITE_APP_URL: 'http://localhost:3000',
    VITE_APP_NAME: 'Mock configured text tests',
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
    messages: [{ role: 'user', content: 'Mock prompt without paid requests' }],
  }),
}));
vi.doMock('@/platform/realtime', () => ({
  getShotPromptChannel: () => ({ emit: mockEmit }),
}));

const { callLLM, callLLMStream, llmCostFromUsage } =
  await import('./llm-client');
const { durableLLMCallCf, durableStreamingLLMCallCf } =
  await import('./llm-call-helper');

// SDK events, workflow steps, billing and realtime are local test doubles.
async function* successfulSdkStream(usage: TokenUsage | undefined) {
  yield { type: 'TEXT_MESSAGE_CONTENT', delta: RESULT_TEXT };
  yield {
    type: 'CUSTOM',
    name: 'structured-output.complete',
    value: { object: MOCK_RESULT, raw: RESULT_TEXT },
  };
  yield { type: 'RUN_FINISHED', usage };
}

function configuredRoute(
  modelId: TextModelRoute['modelId'] = MODEL_IDS.custom,
  overrides: Partial<TextModelRoute> = {}
): TextModelRoute {
  return { ...ROUTE_DEFAULTS, modelId, ...overrides };
}

function configuredKey(route: TextModelRoute): ResolvedLlmKey {
  return { key: MOCK_API_KEY, source: 'platform', via: 'compatible', route };
}

function clientRequest(
  route: TextModelRoute
): LLMRequestParams & { responseSchema?: undefined } {
  return {
    model: route.modelId,
    apiKey: configuredKey(route),
    messages: [{ role: 'user', content: 'Mock request' }],
  };
}

async function completedClientCall(route: TextModelRoute) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of callLLMStream({
    ...clientRequest(route),
    responseSchema: undefined,
  })) {
    chunks.push(chunk);
  }
  const completed = chunks.find((chunk) => chunk.done);
  if (!completed) throw new Error('Expected a completed mock call');
  return completed;
}

function workflowCall(route: TextModelRoute, mode: WorkflowMode) {
  const resolveLlmKey = vi.fn(async () => configuredKey(route));
  const scopedDb = asStub<WorkflowScopedDb>({
    userId: 'mock-user',
    models: {
      ...DEFAULT_MODEL_CONFIGURATION,
      textModelRouting: [route],
    },
    credentials: { resolveLlmKey },
  });
  const step = asStub<WorkflowStep>({
    do: (_name: string, run: () => Promise<unknown>) => run(),
  });
  const config = {
    name: 'configured-text-regression',
    phase: { number: 1, name: 'Mock configured text' },
    promptName: 'mock-configured-text',
    modelId: route.modelId,
    responseSchema: RESPONSE_SCHEMA,
  };
  const context = {
    scopedDb,
    workflowRunId: 'mock-workflow',
    ...(mode === 'streaming' && {
      shotPromptStream: { shotId: 'mock-shot', promptType: 'visual' as const },
    }),
  };
  const run =
    mode === 'streaming' ? durableStreamingLLMCallCf : durableLLMCallCf;
  return { run: () => run(step, config, context), resolveLlmKey };
}

function expectConfiguredAdapter(route: TextModelRoute) {
  expect(mockCompatibleText).toHaveBeenCalledExactlyOnceWith(
    route.upstreamModel,
    expect.objectContaining({
      name: 'configured-text-channel',
      baseURL: route.baseUrl,
      apiKey: MOCK_API_KEY,
      api:
        route.protocol === 'openai-responses'
          ? 'responses'
          : 'chat-completions',
      maxRetries: 0,
      fetch: expect.any(Function),
    })
  );
  expect(mockChat).toHaveBeenCalledTimes(1);
}

function expectMissingConfiguredCost(modelId: string) {
  expect(mockMissingCost).toHaveBeenCalledWith({
    source: 'llm-cost-from-usage',
    modelId,
    metadata: expect.objectContaining({ via: 'compatible' }),
  });
}

function expectWorkflowCharge(modelId: string, costUsd: number) {
  expect(mockDeduct).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      costMicros: usdToMicros(costUsd),
      usedOwnKey: false,
      idempotencyKey: 'mock-workflow:llm-configured-text-regression',
      metadata: expect.objectContaining({ model: modelId }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGoogleRegionBlock();
  mockChat.mockImplementation(() => successfulSdkStream(SUPPLIER_USAGE));
  mockFetch.mockRejectedValue(new Error('Unexpected real network request'));
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockCreateOpenRouterText).not.toHaveBeenCalled();
  expect(mockOpenRouterText).not.toHaveBeenCalled();
  expect(mockCreateGeminiChat).not.toHaveBeenCalled();
  expect(mockCreateGrokText).not.toHaveBeenCalled();
  expect(isGoogleRegionBlockedHere()).toBe(false);
});

it.each(COST_MODELS)(
  'normalizes third-party cost 999 to configured USD rates for %s',
  async (modelId) => {
    const route = configuredRoute(modelId);
    const completed = await completedClientCall(route);
    expect(completed).toMatchObject({
      accumulated: RESULT_TEXT,
      model: modelId,
      via: 'compatible',
      usage: { ...SUPPLIER_USAGE, cost: EXPECTED_USD },
    });
    expect(llmCostFromUsage(completed.usage, modelId, completed.via)).toBe(
      usdToMicros(EXPECTED_USD)
    );
    expect(
      llmCostFromUsage(SUPPLIER_USAGE, modelId, configuredKey(route))
    ).toBe(usdToMicros(EXPECTED_USD));
    expectConfiguredAdapter(route);
    expect(mockMissingCost).not.toHaveBeenCalled();
  }
);

it('uses compatible wire options and clamps an excessive requested token budget', async () => {
  const route = configuredRoute();
  const excessiveTokens = ROUTE_DEFAULTS.contextWindow * 2;
  await callLLM({ ...clientRequest(route), max_tokens: excessiveTokens });
  expect(mockChat.mock.calls[0]?.[0]).toMatchObject({
    stream: true,
    modelOptions: {
      max_tokens: route.maxOutputTokens,
      stream_options: { include_usage: true },
    },
  });
  expect(mockChat.mock.calls[0]?.[0].modelOptions).not.toHaveProperty(
    'streamOptions'
  );
  expectConfiguredAdapter(route);
});

const DURABLE_COST_CASES = WORKFLOW_MODES.flatMap((mode) =>
  COST_MODELS.map((modelId) => ({ mode, modelId }))
);

it.each(DURABLE_COST_CASES)(
  'deducts configured USD cost for $modelId through $mode',
  async ({ mode, modelId }) => {
    const route = configuredRoute(modelId);
    const call = workflowCall(route, mode);
    expect(await call.run()).toEqual(MOCK_RESULT);
    expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(modelId);
    expectWorkflowCharge(modelId, EXPECTED_USD);
    expect(mockChat.mock.calls[0]?.[0]).toMatchObject({
      stream: true,
      outputSchema: RESPONSE_SCHEMA,
      modelOptions: {
        max_tokens: route.maxOutputTokens,
        stream_options: { include_usage: true },
      },
    });
    expectConfiguredAdapter(route);
    expect(mockMissingCost).not.toHaveBeenCalled();
  }
);

const INVALID_TOKEN_CASES = [
  { label: 'negative input', patch: { promptTokens: -1 } },
  { label: 'negative output', patch: { completionTokens: -1 } },
  { label: 'NaN input', patch: { promptTokens: Number.NaN } },
  {
    label: 'infinite output',
    patch: { completionTokens: Number.POSITIVE_INFINITY },
  },
];
const INVALID_CLIENT_CASES = COST_MODELS.flatMap((modelId) =>
  INVALID_TOKEN_CASES.map((testCase) => ({ modelId, ...testCase }))
);

it.each(INVALID_CLIENT_CASES)(
  'discards cost 999 and never uses native rates for $modelId with $label tokens',
  async ({ modelId, patch }) => {
    const route = configuredRoute(modelId);
    const invalidUsage = { ...SUPPLIER_USAGE, ...patch };
    mockChat.mockImplementation(() => successfulSdkStream(invalidUsage));
    const completed = await completedClientCall(route);
    expect(completed.usage).toEqual({ ...invalidUsage, cost: undefined });
    expect(llmCostFromUsage(completed.usage, modelId, completed.via)).toBe(
      ZERO_MICROS
    );
    expect(llmCostFromUsage(invalidUsage, modelId, configuredKey(route))).toBe(
      ZERO_MICROS
    );
    expectMissingConfiguredCost(modelId);
    expectConfiguredAdapter(route);
  }
);

const INVALID_DURABLE_CASES = WORKFLOW_MODES.flatMap((mode) =>
  INVALID_CLIENT_CASES.map((testCase) => ({ mode, ...testCase }))
);

it.each(INVALID_DURABLE_CASES)(
  'reports missing cost for $modelId with $label tokens through $mode',
  async ({ mode, modelId, patch }) => {
    const route = configuredRoute(modelId);
    mockChat.mockImplementation(() =>
      successfulSdkStream({ ...SUPPLIER_USAGE, ...patch })
    );
    expect(await workflowCall(route, mode).run()).toEqual(MOCK_RESULT);
    expectWorkflowCharge(modelId, 0);
    expectMissingConfiguredCost(modelId);
    expectConfiguredAdapter(route);
  }
);

it.each(WORKFLOW_MODES)(
  'preserves configured free rates without missing-cost reports through %s',
  async (mode) => {
    const route = configuredRoute(MODEL_IDS.gemini, {
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });
    expect(await workflowCall(route, mode).run()).toEqual(MOCK_RESULT);
    expectWorkflowCharge(route.modelId, 0);
    expect(mockMissingCost).not.toHaveBeenCalled();
  }
);

it.each(COST_MODELS)(
  'reports missing usage without inferring native rates for %s',
  async (modelId) => {
    const route = configuredRoute(modelId);
    mockChat.mockImplementation(() => successfulSdkStream(undefined));
    const completed = await completedClientCall(route);
    expect(completed.usage).toBeUndefined();
    expect(llmCostFromUsage(completed.usage, modelId, completed.via)).toBe(
      ZERO_MICROS
    );
    expectMissingConfiguredCost(modelId);
  }
);

type ProviderFailure = {
  label: string;
  modelId: TextModelRoute['modelId'];
  code: string;
  message: string;
};
const PROVIDER_FAILURES: ProviderFailure[] = [
  {
    label: 'model region block',
    modelId: MODEL_IDS.anthropic,
    code: '403',
    message: 'This model is not available in your region.',
  },
  {
    label: 'Google location refusal',
    modelId: MODEL_IDS.gemini,
    code: '400',
    message: 'User location is not supported for the API use.',
  },
  {
    label: 'invalid credentials',
    modelId: MODEL_IDS.custom,
    code: '401',
    message: 'Incorrect API key provided.',
  },
  {
    label: 'permission denial',
    modelId: MODEL_IDS.grok,
    code: '403',
    message: 'Permission denied for this deployment.',
  },
];
const FAILURE_DELIVERIES = ['event', 'throw'] as const;
type FailureDelivery = (typeof FAILURE_DELIVERIES)[number];
const CLIENT_FAILURE_CASES = PROVIDER_FAILURES.flatMap((failure) =>
  FAILURE_DELIVERIES.map((delivery) => ({ ...failure, delivery }))
);

async function* failedSdkStream(
  failure: ProviderFailure,
  delivery: FailureDelivery
) {
  if (delivery === 'throw') throw new Error(failure.message);
  yield {
    type: 'RUN_ERROR',
    code: failure.code,
    message: failure.message,
    model: failure.modelId,
  };
}

it.each(CLIENT_FAILURE_CASES)(
  'propagates $label via $delivery without resolving another client route',
  async (failure) => {
    const route = configuredRoute(failure.modelId);
    const resolveApiKey = vi.fn();
    mockChat.mockImplementation(() =>
      failedSdkStream(failure, failure.delivery)
    );
    await expect(
      callLLM({ ...clientRequest(route), resolveApiKey })
    ).rejects.toThrow(failure.message);
    expect(resolveApiKey).not.toHaveBeenCalled();
    expectConfiguredAdapter(route);
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);

const DURABLE_FAILURE_CASES = WORKFLOW_MODES.flatMap((mode) =>
  CLIENT_FAILURE_CASES.map((failure) => ({ mode, ...failure }))
);

it.each(DURABLE_FAILURE_CASES)(
  'propagates $label via $delivery without changing the $mode route',
  async (failure) => {
    const route = configuredRoute(failure.modelId);
    const call = workflowCall(route, failure.mode);
    mockChat.mockImplementation(() =>
      failedSdkStream(failure, failure.delivery)
    );
    await expect(call.run()).rejects.toThrow(failure.message);
    expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(route.modelId);
    expectConfiguredAdapter(route);
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);

it('rejects unsupported structured output before invoking SDK chat', async () => {
  const route = configuredRoute(MODEL_IDS.custom, { structuredOutput: false });
  await expect(
    callLLM({ ...clientRequest(route), responseSchema: RESPONSE_SCHEMA })
  ).rejects.toThrow('required capability: structuredOutput');
  expect(mockChat).not.toHaveBeenCalled();
  expect(mockDeduct).not.toHaveBeenCalled();
});

it.each(WORKFLOW_MODES)(
  'rejects unsupported structured output before SDK chat through %s',
  async (mode) => {
    const route = configuredRoute(MODEL_IDS.custom, {
      structuredOutput: false,
    });
    const call = workflowCall(route, mode);
    await expect(call.run()).rejects.toThrow(
      'required capability: structuredOutput'
    );
    expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(route.modelId);
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);

it('uses Responses and normalizes its supplier usage through the common client', async () => {
  const route = configuredRoute(MODEL_IDS.custom, {
    protocol: 'openai-responses',
  });
  const completed = await completedClientCall(route);
  expectConfiguredAdapter(route);
  expect(mockChat.mock.calls[0]?.[0].modelOptions).toEqual({
    max_output_tokens: route.maxOutputTokens,
  });
  expect(completed.usage).toEqual({ ...SUPPLIER_USAGE, cost: EXPECTED_USD });
});

it.each(WORKFLOW_MODES)(
  'keeps Responses options, structured output and rates in the %s helper',
  async (mode) => {
    const route = configuredRoute(MODEL_IDS.custom, {
      protocol: 'openai-responses',
    });
    const call = workflowCall(route, mode);
    expect(await call.run()).toEqual(MOCK_RESULT);
    expectConfiguredAdapter(route);
    expect(mockChat.mock.calls[0]?.[0]).toMatchObject({
      outputSchema: RESPONSE_SCHEMA,
      modelOptions: { max_output_tokens: route.maxOutputTokens },
    });
    expect(mockChat.mock.calls[0]?.[0].modelOptions).not.toHaveProperty(
      'stream_options'
    );
    expectWorkflowCharge(route.modelId, EXPECTED_USD);
  }
);

it.each(WORKFLOW_MODES)(
  'propagates a Responses failure without changing the %s route',
  async (mode) => {
    const route = configuredRoute(MODEL_IDS.custom, {
      protocol: 'openai-responses',
    });
    const call = workflowCall(route, mode);
    mockChat.mockImplementation(() =>
      failedSdkStream(
        {
          label: 'responses-region-error',
          modelId: route.modelId,
          code: '403',
          message: 'Country, region, or territory not supported',
        },
        'event'
      )
    );
    await expect(call.run()).rejects.toThrow(
      'Country, region, or territory not supported'
    );
    expectConfiguredAdapter(route);
    expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(route.modelId);
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);
