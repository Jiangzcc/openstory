import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as tanstackAi from '@tanstack/ai';
import * as adapterModule from './create-adapter';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { TextModelRoute } from '@/models/text-channels';
import type { TextModel } from '@/models/models';
import type { ResolvedLlmKey } from './db/api-keys';
import type { OrganizationLlmKeyLookup } from './llm-key-routing';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { REGION_FALLBACK_MODEL } from '@/models/region-policy';
import {
  isGoogleRegionBlockedHere,
  markGoogleRegionBlocked,
  resetGoogleRegionBlock,
} from '@/models/google-region';
import { usdToMicros } from '@/billing/money';
import { asStub } from '@/test/as-stub';
import { z } from 'zod';

const MODEL = 'anthropic/claude-sonnet-5.5';
const GOOGLE_MODEL = 'google/gemini-3.8-flash';
const MODES = ['durable', 'streaming'] as const;
const RESULT = { fullPrompt: 'Mock recovered prompt' };
const USAGE = {
  promptTokens: 100,
  completionTokens: 20,
  totalTokens: 120,
  cost: 0.0123,
};
const REGION_ERROR = 'This model is not available in your region.';
const GOOGLE_ERROR = 'User location is not supported for the API use.';
const CHANNEL_KEY = 'mock-channel-secret';
const ORG_KEY = 'mock-organization-secret';
const PLATFORM_KEY = 'mock-platform-secret';

const mockChat = vi.fn();
const mockAdapter = vi.fn(() => ({
  kind: 'text',
  name: 'mock-region-adapter',
}));
const mockDeduct = vi.fn();
const mockEmit = vi.fn(async () => undefined);
const mockFetch = vi.fn<typeof fetch>();
vi.doMock('#env', () => ({ getEnv: () => ({ E2E_TEST: 'true' }) }));
vi.doMock('@tanstack/ai', () => ({ ...tanstackAi, chat: mockChat }));
vi.doMock('./create-adapter', () => ({
  ...adapterModule,
  createAdapter: mockAdapter,
  getPlatformLlmKey: () => ({
    key: PLATFORM_KEY,
    source: 'platform',
    via: 'openrouter',
  }),
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: mockDeduct,
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: () => [],
}));
vi.doMock('@/platform/server/ai/prompts-index', () => ({
  getChatPrompt: async () => ({
    messages: [{ role: 'user', content: 'Mock local request' }],
  }),
}));
vi.doMock('@/platform/realtime', () => ({
  getShotPromptChannel: () => ({ emit: mockEmit }),
}));

const { durableLLMCallCf, durableStreamingLLMCallCf } =
  await import('./llm-call-helper');
const { resolveLlmKeyForModel } = await import('./llm-key-routing');

function route(modelId: TextModel): TextModelRoute {
  return {
    modelId,
    name: 'Mock dormant binding',
    channelId: 'mock-channel',
    credentialId: 'mock-credential',
    upstreamModel: 'mock-upstream',
    protocol: 'openai-chat-completions',
    baseUrl: 'https://mock-region.invalid/v1',
    vision: true,
    structuredOutput: true,
    tools: true,
    contextWindow: 8000,
    maxOutputTokens: 2000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 4,
  };
}

async function* success() {
  yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(RESULT) };
  yield {
    type: 'CUSTOM',
    name: 'structured-output.complete',
    value: { object: RESULT },
  };
  yield { type: 'RUN_FINISHED', usage: USAGE };
}

async function* failure(
  message = REGION_ERROR,
  delivery: 'event' | 'throw' = 'event'
) {
  if (delivery === 'throw') throw new Error(message);
  yield { type: 'RUN_ERROR', message };
}

type OrganizationProvider = Exclude<ResolvedLlmKey['via'], 'compatible'>;
type OrganizationKey = (
  model: string | undefined,
  via: OrganizationProvider
) => boolean;

function workflowSteps() {
  let inStep = false;
  const checkpoints: unknown[] = [];
  const step = asStub<WorkflowStep>({
    do: async (_name: string, run: () => Promise<unknown>) => {
      inStep = true;
      try {
        const result = await run();
        checkpoints.push(result);
        return result;
      } finally {
        inStep = false;
      }
    },
  });
  return { step, checkpoints, isInStep: () => inStep };
}

function workflowCall(
  mode: (typeof MODES)[number],
  routing: TextModelRoute[],
  organizationKey: OrganizationKey,
  modelId: TextModel = MODEL
) {
  const { step, checkpoints, isInStep } = workflowSteps();
  const channelSecret = vi.fn(async () => CHANNEL_KEY);
  const resolveLlmKey = vi.fn(async (model?: string) => {
    expect(isInStep()).toBe(true);
    return resolveLlmKeyForModel(model, routing, {
      organizationKey: async (via): Promise<OrganizationLlmKeyLookup> =>
        organizationKey(model, via) ? { key: ORG_KEY } : {},
      channelSecret,
    });
  });
  const scopedDb = asStub<WorkflowScopedDb>({
    models: { ...DEFAULT_MODEL_CONFIGURATION, textModelRouting: routing },
    credentials: { resolveLlmKey },
  });
  const context = {
    promptLocale: 'en' as const,
    workflowRunId: 'mock-region-run',
    reservationId: 'mock-reservation',
    scopedDb,
    ...(mode === 'streaming' && {
      shotPromptStream: { shotId: 'mock-shot', promptType: 'visual' as const },
    }),
  };
  const config = {
    name: 'region-regression',
    phase: { number: 1, name: 'Mock region recovery' },
    promptName: 'mock-region',
    modelId,
    responseSchema: z.object({ fullPrompt: z.string() }),
  };
  const run =
    mode === 'streaming' ? durableStreamingLLMCallCf : durableLLMCallCf;
  return {
    run: () => run(step, config, context),
    resolveLlmKey,
    channelSecret,
    checkpoints,
  };
}

function expectCharge(usedOwnKey: boolean, costUsd = USAGE.cost) {
  expect(mockDeduct).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      usedOwnKey,
      costMicros: usdToMicros(costUsd),
      idempotencyKey: 'mock-region-run:llm-region-regression',
      reservationId: 'mock-reservation',
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGoogleRegionBlock();
  mockChat.mockImplementation(() => success());
  mockFetch.mockRejectedValue(new Error('Unexpected real network request'));
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  expect(mockFetch).not.toHaveBeenCalled();
  resetGoogleRegionBlock();
  vi.unstubAllGlobals();
});

describe.each(MODES)('%s actual credential region recovery', (mode) => {
  it.each([false, true])(
    'recovers organization OpenRouter with dormant binding=%s',
    async (bound) => {
      mockChat.mockImplementationOnce(() => failure());
      const call = workflowCall(
        mode,
        bound ? [route(MODEL)] : [],
        (_model, via) => via === 'openrouter'
      );
      await expect(call.run()).resolves.toEqual(RESULT);
      expect(call.resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
        MODEL,
        REGION_FALLBACK_MODEL,
      ]);
      expect(mockAdapter).toHaveBeenNthCalledWith(2, REGION_FALLBACK_MODEL, {
        key: ORG_KEY,
        source: 'organization',
        via: 'openrouter',
      });
      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(call.channelSecret).not.toHaveBeenCalled();
      expectCharge(true);
      const serialized = JSON.stringify(call.checkpoints);
      for (const secret of [ORG_KEY, CHANNEL_KEY, PLATFORM_KEY])
        expect(serialized).not.toContain(secret);
    }
  );

  it('preserves unbound platform recovery and charges the successful attempt', async () => {
    mockChat.mockImplementationOnce(() => failure());
    const call = workflowCall(mode, [], () => false);
    await expect(call.run()).resolves.toEqual(RESULT);
    expect(call.resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
      MODEL,
      REGION_FALLBACK_MODEL,
    ]);
    expect(mockChat).toHaveBeenCalledTimes(2);
    expectCharge(false);
  });

  it('re-resolves the same Google model after native location refusal despite a dormant binding', async () => {
    mockChat.mockImplementationOnce(() => failure(GOOGLE_ERROR));
    const call = workflowCall(
      mode,
      [route(GOOGLE_MODEL)],
      (_model, via) => via === 'google' || via === 'openrouter',
      GOOGLE_MODEL
    );
    await expect(call.run()).resolves.toEqual(RESULT);
    expect(call.resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
      GOOGLE_MODEL,
      GOOGLE_MODEL,
    ]);
    expect(mockAdapter).toHaveBeenNthCalledWith(1, GOOGLE_MODEL, {
      key: ORG_KEY,
      source: 'organization',
      via: 'google',
    });
    expect(mockAdapter).toHaveBeenNthCalledWith(2, GOOGLE_MODEL, {
      key: ORG_KEY,
      source: 'organization',
      via: 'openrouter',
    });
    expect(isGoogleRegionBlockedHere()).toBe(true);
    expect(call.channelSecret).not.toHaveBeenCalled();
    expectCharge(true);
  });

  it.each([false, true])(
    'preserves Google recovery when another call marks it during credential resolution, binding=%s',
    async (bound) => {
      mockChat.mockImplementationOnce(() => failure(GOOGLE_ERROR));
      const call = workflowCall(
        mode,
        bound ? [route(GOOGLE_MODEL)] : [],
        (_model, via) => via === 'google' || via === 'openrouter',
        GOOGLE_MODEL
      );
      const resolve = call.resolveLlmKey.getMockImplementation();
      if (!resolve) throw new Error('Expected a mock credential resolver');
      call.resolveLlmKey.mockImplementationOnce(async (model) => {
        const key = await resolve(model);
        markGoogleRegionBlocked(
          'mock concurrent call',
          new Error(GOOGLE_ERROR)
        );
        return key;
      });
      await expect(call.run()).resolves.toEqual(RESULT);
      expect(call.resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
        GOOGLE_MODEL,
        GOOGLE_MODEL,
      ]);
      expect(mockAdapter).toHaveBeenNthCalledWith(1, GOOGLE_MODEL, {
        key: ORG_KEY,
        source: 'organization',
        via: 'google',
      });
      expect(mockAdapter).toHaveBeenNthCalledWith(2, GOOGLE_MODEL, {
        key: ORG_KEY,
        source: 'organization',
        via: 'openrouter',
      });
      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(call.channelSecret).not.toHaveBeenCalled();
      expectCharge(true);
    }
  );

  it.each(['event', 'throw'] as const)(
    'keeps actual compatible calls pinned on %s errors',
    async (delivery) => {
      mockChat.mockImplementation(() => failure(REGION_ERROR, delivery));
      const call = workflowCall(mode, [route(MODEL)], () => false);
      await expect(call.run()).rejects.toThrow(REGION_ERROR);
      expect(call.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(MODEL);
      expect(call.channelSecret).toHaveBeenCalledExactlyOnceWith(
        'mock-credential'
      );
      expect(mockAdapter).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(mockDeduct).not.toHaveBeenCalled();
    }
  );

  it('uses a compatible fallback target and its platform source and configured rates', async () => {
    mockChat.mockImplementationOnce(() => failure());
    const fallbackRoute = route(REGION_FALLBACK_MODEL);
    const call = workflowCall(
      mode,
      [fallbackRoute],
      (model, via) => model === MODEL && via === 'openrouter'
    );
    await expect(call.run()).resolves.toEqual(RESULT);
    expect(call.resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
      MODEL,
      REGION_FALLBACK_MODEL,
    ]);
    expect(mockAdapter).toHaveBeenNthCalledWith(2, REGION_FALLBACK_MODEL, {
      key: CHANNEL_KEY,
      source: 'platform',
      via: 'compatible',
      route: fallbackRoute,
    });
    expect(call.channelSecret).toHaveBeenCalledExactlyOnceWith(
      'mock-credential'
    );
    expect(mockChat).toHaveBeenCalledTimes(2);
    expectCharge(false, 0.00028);
  });

  it('propagates a compatible fallback target failure without a third attempt', async () => {
    mockChat.mockImplementation(() => failure());
    const call = workflowCall(
      mode,
      [route(REGION_FALLBACK_MODEL)],
      (model, via) => model === MODEL && via === 'openrouter'
    );
    await expect(call.run()).rejects.toThrow(REGION_ERROR);
    expect(call.resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
      MODEL,
      REGION_FALLBACK_MODEL,
    ]);
    expect(call.channelSecret).toHaveBeenCalledTimes(1);
    expect(mockAdapter).toHaveBeenCalledTimes(2);
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockDeduct).not.toHaveBeenCalled();
  });
});
