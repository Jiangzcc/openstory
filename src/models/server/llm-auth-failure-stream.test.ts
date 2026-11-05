import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as tanstackAi from '@tanstack/ai';
import type { ResolvedLlmKey } from './db/api-keys';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { resetGoogleRegionBlock } from '@/models/google-region';
import { REGION_FALLBACK_MODEL } from '@/models/region-policy';
import { asStub } from '@/test/as-stub';
import { handleLlmAuthFailure } from '@/platform/server/workflow/llm-auth-failure';
import { sanitizeFailResponse } from '@/platform/server/workflow/sanitize-fail-response';
import { withLlmAuthFailureStream } from './llm-auth-failure-stream';

const mockChat = vi.fn();
const mockCreateAdapter = vi.fn((_model: string, key?: ResolvedLlmKey) => ({
  kind: 'text',
  name: 'mock-' + (key?.via ?? 'openrouter'),
}));
vi.doMock('@tanstack/ai', () => ({ ...tanstackAi, chat: mockChat }));
vi.doMock('./create-adapter', () => ({
  createAdapter: mockCreateAdapter,
  resolveNativeGrokModel: () => undefined,
  resolveNativeGeminiModel: () => undefined,
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: () => [],
}));
const { callLLMStream } = await import('./llm-client');

async function* providerFailure(message: string, code: string) {
  yield { type: 'RUN_ERROR', message, code };
}

function makeDb() {
  const markKeyInvalid = vi.fn(async () => undefined);
  const resolveLlmKey = vi.fn(async () => ({
    source: 'organization',
    via: 'fal',
    key: 'mock-unrelated-team-key',
  }));
  return {
    markKeyInvalid,
    resolveLlmKey,
    scopedDb: asStub<WorkflowScopedDb>({
      apiKeys: { markKeyInvalid },
      credentials: { resolveLlmKey },
    }),
  };
}

async function streamFailure(
  model: Parameters<typeof callLLMStream>[0]['model'],
  key: ResolvedLlmKey
) {
  try {
    for await (const chunk of withLlmAuthFailureStream(
      model,
      key,
      callLLMStream({
        model,
        apiKey: key,
        messages: [{ role: 'user', content: 'local mock' }],
      })
    )) {
      void chunk;
    }
  } catch (error) {
    return sanitizeFailResponse(error);
  }
  throw new Error('Expected mocked provider failure');
}

describe('auth ownership across real LLM region retry control flow (mock providers)', () => {
  beforeEach(() => {
    resetGoogleRegionBlock();
    mockChat.mockReset();
    mockCreateAdapter.mockClear();
  });
  afterEach(() => resetGoogleRegionBlock());

  test('platform Google retries on platform OpenRouter; its 401 never marks a team key', async () => {
    const db = makeDb();
    const key = {
      source: 'platform',
      via: 'google',
      key: 'mock-platform-google',
    } as const;
    mockChat
      .mockReturnValueOnce(
        providerFailure(
          '400 User location is not supported for the API use.',
          '400'
        )
      )
      .mockReturnValueOnce(providerFailure('401 Unauthorized', '401'));
    const message = await streamFailure('google/gemini-3.8-flash', key);
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockCreateAdapter).toHaveBeenNthCalledWith(
      2,
      'google/gemini-3.8-flash',
      undefined
    );
    expect(message).toContain('401');
    await handleLlmAuthFailure(db.scopedDb, message);
    expect(db.markKeyInvalid).not.toHaveBeenCalled();
    expect(db.resolveLlmKey).not.toHaveBeenCalled();
  });

  test('team Google region refusal does not cross to a platform payer', async () => {
    const db = makeDb();
    const key = {
      source: 'organization',
      via: 'google',
      key: 'mock-team-google',
    } as const;
    mockChat.mockReturnValueOnce(
      providerFailure(
        '400 User location is not supported for the API use.',
        '400'
      )
    );
    const message = await streamFailure('google/gemini-3.8-flash', key);
    expect(mockChat).toHaveBeenCalledOnce();
    expect(message).toContain('User location is not supported');
    await handleLlmAuthFailure(db.scopedDb, message);
    expect(db.markKeyInvalid).not.toHaveBeenCalled();
    expect(db.resolveLlmKey).not.toHaveBeenCalled();
  });

  test('a model region retry keeps its actual team via when the retry returns 401', async () => {
    const db = makeDb();
    const key = {
      source: 'organization',
      via: 'openrouter',
      key: 'mock-team-openrouter',
    } as const;
    mockChat
      .mockReturnValueOnce(
        providerFailure('This model is not available in your region.', '403')
      )
      .mockReturnValueOnce(providerFailure('401 Unauthorized', '401'));
    const message = await streamFailure('anthropic/claude-opus-5-fast', key);
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockCreateAdapter).toHaveBeenNthCalledWith(
      2,
      REGION_FALLBACK_MODEL,
      key
    );
    await handleLlmAuthFailure(db.scopedDb, message);
    expect(db.markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
      'openrouter',
      expect.stringContaining('401')
    );
    expect(db.resolveLlmKey).not.toHaveBeenCalled();
  });
});
