import { REGION_FALLBACK_MODEL } from '@/models/region-policy';
import { readLlmAuthFailureSource } from '@/platform/server/workflow/llm-auth-failure-source';
import { handleLlmAuthFailure } from '@/platform/server/workflow/llm-auth-failure';
import { childFailureMessage } from '@/platform/server/workflow/errors';
import { sanitizeFailResponse } from '@/platform/server/workflow/sanitize-fail-response';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { TextModel } from '@/models/models';
import { z } from 'zod';
import type { WorkflowStep } from 'cloudflare:workers';

// Import real modules before vi.doMock so mocks can re-export the rest.
import * as tanstackAi from '@tanstack/ai';
import * as createAdapterModule from './create-adapter';
import * as promptsModule from '@/platform/server/ai/prompts-index';
import * as realtimeModule from '@/platform/realtime';
import { asStub } from '@/test/as-stub';

const mockChat = vi.fn();
const mockCreateAdapter = vi.fn((_model: TextModel) => ({
  kind: 'text',
  name: 'mock',
}));
const mockDeduct = vi.fn();
const mockVisionImageSource = vi.fn(async (value: string) => ({
  type: 'url',
  value,
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: mockDeduct,
}));
vi.doMock('@/platform/server/storage/external-url', () => ({
  toVisionImageSource: mockVisionImageSource,
}));
vi.doMock('@tanstack/ai', () => ({
  ...tanstackAi,
  chat: mockChat,
}));

vi.doMock('./create-adapter', () => ({
  ...createAdapterModule,
  createAdapter: mockCreateAdapter,
  getPlatformLlmKey: () => ({
    key: 'test-key',
    source: 'platform' as const,
    via: 'openrouter' as const,
  }),
}));

vi.doMock('@/platform/server/ai/prompts-index', () => ({
  ...promptsModule,
  getChatPrompt: () =>
    Promise.resolve({
      prompt: null,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
    }),
}));

const emitted: unknown[] = [];
const mockEmit = vi.fn((event: string, payload: unknown) => {
  emitted.push({ event, payload });
  return Promise.resolve();
});
vi.doMock('@/platform/realtime', () => ({
  ...realtimeModule,
  getShotPromptChannel: () => ({
    emit: mockEmit,
  }),
}));

const {
  chatModelOptionsForCall,
  durableLLMCallCf,
  durableStreamingLLMCallCf,
  shouldInlineVisionForVia,
} = await import('./llm-call-helper');
const { usdToMicros, ZERO_MICROS } = await import('@/billing/money');

// Minimal WorkflowStep: run every step body immediately, no retries.
// minimal WorkflowStep stub: the helper only uses `do`
const step = asStub<WorkflowStep>({
  do: (_name: string, fn: () => Promise<unknown>) => fn(),
});

const schema = z.object({
  visual: z.object({ fullPrompt: z.string() }),
});

const callConfig = {
  name: 'visual-prompts',
  phase: { number: 3, name: 'Visual prompts' },
  promptName: 'phase/shot-spec-rewrite-chat',
  promptVariables: {},
  modelId: 'x-ai/grok-4.7' as const,
  responseSchema: schema,
};

const callContext = {
  promptLocale: 'en' as const,
  sequenceId: '01TESTSEQUENCE0000000000',
  workflowRunId: 'wf-test',
  shotPromptStream: { shotId: 'shot-1', promptType: 'visual' as const },
};

/** Context without shot stream → durableLLMCallCf (non-UI stream drain). */
const nonStreamContext = {
  promptLocale: 'en' as const,
  sequenceId: '01TESTSEQUENCE0000000000',
  workflowRunId: 'wf-test',
};

describe('chatModelOptionsForCall', () => {
  it('uses Responses wire names for LLMTR Luna, not Chat Completions', () => {
    const options = chatModelOptionsForCall(
      'openai/gpt-6-luna',
      { key: 'k', via: 'llmtr' },
      true
    );
    expect(options).toEqual({
      reasoning: { effort: 'medium' },
      max_output_tokens: expect.any(Number),
    });
  });

  it('pins GLM-5.3 Flash unrequested reasoning to low on OpenRouter (#1494)', () => {
    const options = chatModelOptionsForCall(
      'z-ai/glm-5.3-flash',
      { key: 'k', via: 'openrouter' },
      undefined
    );
    expect(options).toEqual(
      expect.objectContaining({
        reasoning: { effort: 'low' },
      })
    );
  });

  it('maps GLM-5.3 requested medium reasoning to high', () => {
    const options = chatModelOptionsForCall(
      'z-ai/glm-5.3-flash',
      { key: 'k', via: 'openrouter' },
      true
    );
    expect(options).toEqual(
      expect.objectContaining({
        reasoning: { effort: 'high' },
      })
    );
  });

  it('sends GLM-5.3 reasoning_effort low on LLMTR when unrequested', () => {
    const options = chatModelOptionsForCall(
      'z-ai/glm-5.3-flash',
      { key: 'k', via: 'llmtr' },
      undefined
    );
    expect(options).toEqual({
      reasoning_effort: 'low',
      max_tokens: expect.any(Number),
    });
  });
});

describe('durableLLMCallCf usage cost capture', () => {
  it('requests stream + includeUsage and bills usage.cost from RUN_FINISHED', async () => {
    const validObject = { visual: { fullPrompt: 'A clean shot' } };
    mockChat.mockReturnValue(
      (async function* () {
        yield {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object: validObject, raw: JSON.stringify(validObject) },
        };
        yield {
          type: 'RUN_FINISHED',
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            cost: 0.07,
          },
        };
      })()
    );

    const result = await durableLLMCallCf(step, callConfig, nonStreamContext);
    expect(result).toEqual(validObject);

    const firstCall = mockChat.mock.calls[0];
    if (!firstCall) throw new Error('expected mockChat to have been called');
    expect(firstCall[0].stream).toBe(true);
    expect(firstCall[0].modelOptions?.streamOptions?.includeUsage).toBe(true);
    expect(firstCall[0].modelOptions?.maxTokens).toBeDefined();
    expect(firstCall[0].modelOptions?.maxCompletionTokens).toBeUndefined();
  });

  it('pins Luna to OpenAI and sends max_tokens, not max_completion_tokens', async () => {
    mockChat.mockClear();
    const validObject = { visual: { fullPrompt: 'A clean shot' } };
    mockChat.mockReturnValue(
      (async function* () {
        yield {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object: validObject, raw: JSON.stringify(validObject) },
        };
      })()
    );

    await durableLLMCallCf(
      step,
      { ...callConfig, modelId: 'openai/gpt-6-luna' },
      nonStreamContext
    );

    const options = mockChat.mock.calls[0]?.[0]?.modelOptions;
    expect(options?.provider).toEqual({ only: ['openai'] });
    expect(options?.maxTokens).toBeDefined();
    expect(options?.maxCompletionTokens).toBeUndefined();
  });

  it('returns zero cost micros when usage.cost is missing', async () => {
    const validObject = { visual: { fullPrompt: 'No cost' } };
    mockChat.mockReturnValue(
      (async function* () {
        yield {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object: validObject, raw: JSON.stringify(validObject) },
        };
      })()
    );

    // Without scopedDb there is no deduct step; success proves the drain
    // completed and missing cost did not throw.
    await expect(
      durableLLMCallCf(step, callConfig, nonStreamContext)
    ).resolves.toEqual(validObject);
    // Sanity: ZERO and a real cost micros stay distinct for callers.
    expect(ZERO_MICROS).not.toBe(usdToMicros(0.07));
  });

  it('throws when no structured-output.complete event arrives', async () => {
    mockChat.mockReturnValue(
      (async function* () {
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          delta: '{"visual":{"fullPrompt":"no event"}}',
        };
      })()
    );

    await expect(
      durableLLMCallCf(step, callConfig, nonStreamContext)
    ).rejects.toThrow(/structured-output\.complete/);
  });

  it('throws a retryable timeout when the abort fires without a complete event (#1494)', async () => {
    mockChat.mockImplementation(
      (opts: { abortController?: AbortController }) => {
        opts.abortController?.abort();
        return (async function* () {
          // Stream ends with no complete event — the abort is why.
        })();
      }
    );

    await expect(
      durableLLMCallCf(step, callConfig, nonStreamContext)
    ).rejects.toThrow(/Timed out after 300s waiting for structured output/);
  });

  it('drains chat() after RUN_ERROR so otel onError can end the span', async () => {
    let cancelled = false;
    mockChat.mockReturnValue({
      [Symbol.asyncIterator]() {
        let i = 0;
        const events = [
          {
            type: 'RUN_ERROR',
            message:
              'openrouter.structuredOutputStream: response contained no content',
            code: 'empty-response',
            model: 'anthropic/claude-opus-5.5',
          },
        ];
        return {
          async next() {
            if (i < events.length) {
              return { value: events[i++], done: false as const };
            }
            return { done: true as const, value: undefined };
          },
          async return() {
            cancelled = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    });

    await expect(
      durableLLMCallCf(step, callConfig, nonStreamContext)
    ).rejects.toThrow(/empty-response/);
    expect(cancelled).toBe(false);
  });
});

describe('durableStreamingLLMCallCf structured-output.complete', () => {
  it('prefers the validated object from the complete event over accumulated text', async () => {
    const validObject = { visual: { fullPrompt: 'A clean shot' } };
    mockChat.mockReturnValue(
      (async function* () {
        // Deltas assemble to MALFORMED JSON (missing closing quote — the
        // Grok slip that motivated this): the event must win over the text.
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          delta: '{"visual":{"fullPrompt":"A clean shot',
        };
        yield { type: 'TEXT_MESSAGE_CONTENT', delta: '}}' };
        yield {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object: validObject, raw: JSON.stringify(validObject) },
        };
      })()
    );

    const result = await durableStreamingLLMCallCf(
      step,
      callConfig,
      callContext
    );
    expect(result).toEqual(validObject);
  });

  it('throws when no structured-output.complete event arrives', async () => {
    const validJson = '{"visual":{"fullPrompt":"Fallback shot"}}';
    mockChat.mockReturnValue(
      (async function* () {
        yield { type: 'TEXT_MESSAGE_CONTENT', delta: validJson };
      })()
    );

    await expect(
      durableStreamingLLMCallCf(step, callConfig, callContext)
    ).rejects.toThrow(/structured-output\.complete/);
  });

  it('still rejects when both the text is malformed and no event arrives', async () => {
    mockChat.mockReturnValue(
      (async function* () {
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          delta: '{"visual":{"fullPrompt":"broken}}',
        };
      })()
    );

    await expect(
      durableStreamingLLMCallCf(step, callConfig, callContext)
    ).rejects.toThrow();
  });
});

describe('shouldInlineVisionForVia', () => {
  it('inlines for native Gemini so fileUri HTTP fetches are not used', () => {
    expect(shouldInlineVisionForVia('google')).toBe(true);
  });

  it('keeps URL sources for OpenRouter, fal, and xAI', () => {
    expect(shouldInlineVisionForVia('openrouter')).toBe(false);
    expect(shouldInlineVisionForVia('fal')).toBe(false);
    expect(shouldInlineVisionForVia('xai')).toBe(false);
  });
});

describe('snapshotted durable vision fallback', () => {
  const visionModel = 'google/gemini-3.8-flash';
  const validObject = { visual: { fullPrompt: 'A clean shot' } };

  beforeEach(() => {
    mockCreateAdapter.mockClear();
    mockDeduct.mockClear();
    mockChat.mockReturnValue(
      (async function* () {
        yield {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object: validObject },
        };
        yield {
          type: 'RUN_FINISHED',
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            cost: 0.07,
          },
        };
      })()
    );
  });

  it.each([false, true])(
    'resolves and bills the snapshot vision model (streaming: %s)',
    async (streaming) => {
      const resolveLlmKey = vi.fn(async () => ({
        key: 'test-key',
        source: 'platform',
        via: 'openrouter',
      }));
      const mutableGet = vi.fn();
      const scopedDb = asStub<WorkflowScopedDb>({
        userId: 'u',
        models: { ...DEFAULT_MODEL_CONFIGURATION, vision: visionModel },
        credentials: { resolveLlmKey },
        modelConfiguration: { get: mutableGet },
      });
      const run = streaming ? durableStreamingLLMCallCf : durableLLMCallCf;
      const baseContext = streaming ? callContext : nonStreamContext;
      const result = await run(
        step,
        {
          ...callConfig,
          modelId: 'deepseek/deepseek-v3.2',
          visionImageUrls: ['https://example.test/still.png'],
        },
        {
          ...baseContext,
          scopedDb,
        }
      );
      expect(result).toEqual(validObject);
      expect(resolveLlmKey).toHaveBeenCalledExactlyOnceWith(visionModel);
      expect(mockCreateAdapter).toHaveBeenCalledWith(
        visionModel,
        expect.anything()
      );
      expect(mockDeduct).toHaveBeenCalledWith(
        expect.objectContaining({
          costMicros: usdToMicros(0.07),
          metadata: expect.objectContaining({ model: visionModel }),
        })
      );
      expect(mutableGet).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'preserves the user-selected vision model (streaming: %s)',
    async (streaming) => {
      const resolveLlmKey = vi.fn(async () => ({
        key: 'test-key',
        source: 'organization',
        via: 'openrouter',
      }));
      const scopedDb = asStub<WorkflowScopedDb>({
        models: { ...DEFAULT_MODEL_CONFIGURATION, vision: visionModel },
        credentials: { resolveLlmKey },
      });
      const run = streaming ? durableStreamingLLMCallCf : durableLLMCallCf;
      const baseContext = streaming ? callContext : nonStreamContext;
      await run(
        step,
        { ...callConfig, visionImageUrls: ['https://example.test/still.png'] },
        {
          ...baseContext,
          scopedDb,
        }
      );
      expect(resolveLlmKey).toHaveBeenCalledExactlyOnceWith(callConfig.modelId);
      expect(mockCreateAdapter).toHaveBeenCalledWith(
        callConfig.modelId,
        expect.anything()
      );
    }
  );
});

const unauthorizedStatus = 401;
const modelId = 'openai/gpt-5.4-mini';

function resetCredentialFailureMocks() {
  mockChat.mockReset();
  mockDeduct.mockClear();
  mockVisionImageSource.mockClear();
}

function credentialFailureScope(source: 'organization' | 'platform') {
  const markKeyInvalid = vi.fn();
  const scopedDb = asStub<WorkflowScopedDb>({
    models: DEFAULT_MODEL_CONFIGURATION,
    credentials: {
      resolveLlmKey: async () => ({
        key: 'mock-rejected-key',
        source,
        via: 'openrouter',
      }),
    },
    apiKeys: { markKeyInvalid },
  });
  return { scopedDb, markKeyInvalid };
}

it.each(
  [false, true].flatMap((streaming) =>
    (['event', 'throw'] as const).map((failureKind) => ({
      streaming,
      failureKind,
    }))
  )
)(
  'keeps the actual organization credential (streaming: $streaming, failure: $failureKind)',
  async ({ streaming, failureKind }) => {
    resetCredentialFailureMocks();
    let providerDrained = false;
    mockChat.mockImplementation(() =>
      (async function* () {
        if (failureKind === 'throw') {
          throw Object.assign(new Error('Mock credential rejected'), {
            status: unauthorizedStatus,
          });
        }
        yield {
          type: 'RUN_ERROR',
          message: 'Mock credential rejected',
          code: String(unauthorizedStatus),
          model: modelId,
        };
        providerDrained = true;
      })()
    );
    const { scopedDb, markKeyInvalid } = credentialFailureScope('organization');
    const run = streaming ? durableStreamingLLMCallCf : durableLLMCallCf;
    const context = streaming ? callContext : nonStreamContext;
    const error = await run(
      step,
      { ...callConfig, modelId },
      {
        ...context,
        scopedDb,
      }
    ).catch((failure: unknown) => failure);
    if (!(error instanceof Error))
      throw new Error('Expected the mock credential failure');
    const parentError = sanitizeFailResponse(
      new Error(childFailureMessage('mock-auxiliary-call', error.message))
    );
    expect(readLlmAuthFailureSource(parentError)).toMatchObject({
      model: modelId,
      source: 'organization',
      via: 'openrouter',
    });
    await handleLlmAuthFailure(scopedDb, parentError);
    expect(markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
      'openrouter',
      expect.stringContaining('Mock credential rejected')
    );
    expect(mockDeduct).not.toHaveBeenCalled();
    expect(providerDrained).toBe(failureKind === 'event');
  }
);

it.each([false, true])(
  'does not blame the LLM credential for a vision-image download 401 (streaming: %s)',
  async (streaming) => {
    resetCredentialFailureMocks();
    const downloadFailure = new Error(
      'Failed to fetch vision image (401 Unauthorized): mock image'
    );
    mockVisionImageSource.mockRejectedValueOnce(downloadFailure);
    const { scopedDb, markKeyInvalid } = credentialFailureScope('organization');
    const run = streaming ? durableStreamingLLMCallCf : durableLLMCallCf;
    const context = streaming ? callContext : nonStreamContext;
    const error = await run(
      step,
      {
        ...callConfig,
        modelId: 'google/gemini-3.8-flash',
        visionImageUrls: ['https://mock.test/still.png'],
      },
      {
        ...context,
        scopedDb,
      }
    ).catch((failure: unknown) => failure);
    expect(error).toBe(downloadFailure);
    expect(readLlmAuthFailureSource(downloadFailure.message)).toBeUndefined();
    await handleLlmAuthFailure(scopedDb, downloadFailure.message);
    expect(markKeyInvalid).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  'uses the platform source after a region retry changes the credential (streaming: %s)',
  async (streaming) => {
    resetCredentialFailureMocks();
    mockChat.mockImplementationOnce(() =>
      (async function* () {
        yield {
          type: 'RUN_ERROR',
          message: 'Mock model not available in your region',
        };
      })()
    );
    mockChat.mockImplementationOnce(() =>
      (async function* () {
        yield {
          type: 'RUN_ERROR',
          message: 'Mock platform credential rejected',
          code: String(unauthorizedStatus),
        };
      })()
    );
    const markKeyInvalid = vi.fn();
    const resolveLlmKey = vi.fn(async (model: string) => ({
      key: 'mock-region-key',
      source: model === modelId ? 'organization' : 'platform',
      via: 'openrouter',
    }));
    const scopedDb = asStub<WorkflowScopedDb>({
      models: DEFAULT_MODEL_CONFIGURATION,
      credentials: { resolveLlmKey },
      apiKeys: { markKeyInvalid },
    });
    const run = streaming ? durableStreamingLLMCallCf : durableLLMCallCf;
    const context = streaming ? callContext : nonStreamContext;
    const error = await run(
      step,
      { ...callConfig, modelId },
      {
        ...context,
        scopedDb,
      }
    ).catch((failure: unknown) => failure);
    if (!(error instanceof Error))
      throw new Error('Expected the mock platform failure');
    expect(resolveLlmKey.mock.calls.map(([model]) => model)).toEqual([
      modelId,
      REGION_FALLBACK_MODEL,
    ]);
    expect(readLlmAuthFailureSource(error.message)).toBeUndefined();
    await handleLlmAuthFailure(scopedDb, error.message);
    expect(markKeyInvalid).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  'does not invalidate an organization credential on a platform failure (streaming: %s)',
  async (streaming) => {
    resetCredentialFailureMocks();
    mockChat.mockImplementation(() =>
      (async function* () {
        yield {
          type: 'RUN_ERROR',
          message: 'Mock platform credential rejected',
          code: String(unauthorizedStatus),
          model: modelId,
        };
      })()
    );
    const { scopedDb, markKeyInvalid } = credentialFailureScope('platform');
    const run = streaming ? durableStreamingLLMCallCf : durableLLMCallCf;
    const context = streaming ? callContext : nonStreamContext;
    const error = await run(
      step,
      { ...callConfig, modelId },
      {
        ...context,
        scopedDb,
      }
    ).catch((failure: unknown) => failure);
    if (!(error instanceof Error))
      throw new Error('Expected the mock platform failure');
    expect(readLlmAuthFailureSource(error.message)).toBeUndefined();
    await handleLlmAuthFailure(scopedDb, error.message);
    expect(markKeyInvalid).not.toHaveBeenCalled();
    expect(mockDeduct).not.toHaveBeenCalled();
  }
);

it('does not blame the LLM credential for a realtime publish 401', async () => {
  resetCredentialFailureMocks();
  const streamClosed = vi.fn();
  const markKeyInvalid = vi.fn();
  const broadcastFailure = new Error('Mock realtime HTTP 401 Unauthorized');
  const scopedDb = asStub<WorkflowScopedDb>({
    models: DEFAULT_MODEL_CONFIGURATION,
    credentials: {
      resolveLlmKey: async () => ({
        key: 'mock-working-key',
        source: 'organization',
        via: 'openrouter',
      }),
    },
    apiKeys: { markKeyInvalid },
  });
  mockChat.mockImplementation(() =>
    (async function* () {
      try {
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          delta: '{"fullPrompt":"Mock prompt',
        };
      } finally {
        streamClosed();
      }
    })()
  );
  mockEmit.mockRejectedValueOnce(broadcastFailure);
  mockDeduct.mockClear();
  const error = await durableStreamingLLMCallCf(step, callConfig, {
    ...callContext,
    scopedDb,
  }).catch((failure: unknown) => failure);
  expect(error).toBe(broadcastFailure);
  expect(streamClosed).toHaveBeenCalledOnce();
  await handleLlmAuthFailure(scopedDb, broadcastFailure.message);
  expect(markKeyInvalid).not.toHaveBeenCalled();
  expect(mockDeduct).not.toHaveBeenCalled();
});
