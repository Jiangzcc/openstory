import { describe, expect, test, vi } from 'vitest';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { asStub } from '@/test/as-stub';
import { handleLlmAuthFailure } from './llm-auth-failure';
import {
  llmAuthFailureMessage,
  readLlmAuthFailureSource,
  withLlmAuthFailureSource,
} from './llm-auth-failure-source';
import { sanitizeFailResponse } from './sanitize-fail-response';
import { withLlmAuthFailureStream } from '@/models/server/llm-auth-failure-stream';

const MODEL = 'anthropic/claude-sonnet-5.5';
const TEAM_KEY = {
  source: 'organization',
  via: 'fal',
  key: 'mock-secret',
} as const;
const TEAM_SOURCE = {
  model: MODEL,
  source: 'organization',
  via: 'fal',
} as const;

function makeDb() {
  const markKeyInvalid = vi.fn(async () => undefined);
  const resolveLlmKey = vi.fn(async () => TEAM_KEY);
  const scopedDb = asStub<WorkflowScopedDb>({
    apiKeys: { markKeyInvalid },
    credentials: { resolveLlmKey },
  });
  return { scopedDb, markKeyInvalid, resolveLlmKey };
}

function durableMessage(error: unknown): string {
  if (!(error instanceof Error)) throw new Error('Expected mock failure');
  const wire: { name: string; message: string } = JSON.parse(
    JSON.stringify({ name: error.name, message: error.message })
  );
  return sanitizeFailResponse(new Error(wire.message));
}

async function* rejectedStream(error: unknown): AsyncGenerator<string> {
  yield 'first chunk';
  throw error;
}

async function drain(stream: AsyncIterable<string>) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('LLM auth failure attribution (local mocks)', () => {
  test.each([
    ['openrouter', 'OpenRouter'],
    ['fal', 'fal.ai'],
    ['xai', 'xAI'],
    ['google', 'Google'],
    ['llmtr', 'LLMTR'],
  ] as const)(
    'marks only the captured team %s credential after a durable string round trip',
    async (via, label) => {
      const { scopedDb, markKeyInvalid, resolveLlmKey } = makeDb();
      const error = withLlmAuthFailureSource(new Error('401 Unauthorized'), {
        ...TEAM_SOURCE,
        via,
      });
      const message = durableMessage(error);
      await expect(
        handleLlmAuthFailure(scopedDb, message, 'custom:different-model')
      ).resolves.toBe(
        'Your ' + label + ' API key is invalid — update it in Settings.'
      );
      expect(markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
        via,
        '401 Unauthorized'
      );
      expect(resolveLlmKey).not.toHaveBeenCalled();
    }
  );

  test('recognizes a durable Error.toString boundary after sanitization', async () => {
    const { scopedDb, markKeyInvalid } = makeDb();
    const error = withLlmAuthFailureSource(
      new Error('401 Unauthorized'),
      TEAM_SOURCE
    );
    const message = sanitizeFailResponse(String(error));
    await handleLlmAuthFailure(scopedDb, message);
    expect(markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
      'fal',
      '401 Unauthorized'
    );
    expect(llmAuthFailureMessage(message)).toBe('401 Unauthorized');
  });

  test.each(['compatible', 'openrouter', 'fal', 'google'] as const)(
    'does not mark a team key for captured platform %s auth failures',
    async (via) => {
      const { scopedDb, markKeyInvalid, resolveLlmKey } = makeDb();
      const message = durableMessage(
        withLlmAuthFailureSource(new Error('401 Unauthorized'), {
          model: 'custom:platform-model',
          source: 'platform',
          via,
        })
      );
      await expect(
        handleLlmAuthFailure(scopedDb, message, MODEL)
      ).resolves.toBeUndefined();
      expect(markKeyInvalid).not.toHaveBeenCalled();
      expect(resolveLlmKey).not.toHaveBeenCalled();
      expect(llmAuthFailureMessage(message)).toBe('401 Unauthorized');
    }
  );

  test.each([undefined, MODEL])(
    'leaves unattributed 401 failures unmarked with model=%s',
    async (model) => {
      const { scopedDb, markKeyInvalid, resolveLlmKey } = makeDb();
      await expect(
        handleLlmAuthFailure(scopedDb, '401 Unauthorized', model)
      ).resolves.toBeUndefined();
      expect(markKeyInvalid).not.toHaveBeenCalled();
      expect(resolveLlmKey).not.toHaveBeenCalled();
    }
  );

  test('carries only non-secret fields through child wrapping and the 500-character sanitizer', async () => {
    const { scopedDb, markKeyInvalid } = makeDb();
    const original = new Error(
      '401 Unauthorized: ' + 'provider detail '.repeat(80)
    );
    const captured = withLlmAuthFailureSource(original, {
      ...TEAM_SOURCE,
      ...TEAM_KEY,
    });
    const message = sanitizeFailResponse(
      'Child workflow split-child failed: Error: ' + durableMessage(captured)
    );
    expect(message).not.toContain(TEAM_KEY.key);
    expect(readLlmAuthFailureSource(message)).toMatchObject(TEAM_SOURCE);
    await handleLlmAuthFailure(scopedDb, message);
    expect(markKeyInvalid).toHaveBeenCalledOnce();
    expect(llmAuthFailureMessage(message)).toMatch(/^401 Unauthorized:/);
    expect(llmAuthFailureMessage(message)).not.toContain('[llm-auth:');
  });

  test('normalizes a durable legacy team source to its organization credential', async () => {
    const { scopedDb, markKeyInvalid, resolveLlmKey } = makeDb();
    const message = '[llm-auth:v1:team:fal:mock-model] 401 Unauthorized';
    expect(readLlmAuthFailureSource(message)).toMatchObject({
      model: 'mock-model',
      source: 'organization',
      via: 'fal',
    });
    await handleLlmAuthFailure(scopedDb, message);
    expect(markKeyInvalid).toHaveBeenCalledWith('fal', '401 Unauthorized');
    expect(resolveLlmKey).not.toHaveBeenCalled();
  });

  test.each([
    '[llm-auth:v1:team:compatible:model] 401 Unauthorized',
    '[llm-auth:v1:team:unknown:model] 401 Unauthorized',
    '[llm-auth:v1:team:fal:%] 401 Unauthorized',
    '[llm-auth:v1:team:fal:model',
  ])('ignores malformed or impossible source context: %s', async (message) => {
    const { scopedDb, markKeyInvalid } = makeDb();
    await expect(
      handleLlmAuthFailure(scopedDb, message)
    ).resolves.toBeUndefined();
    expect(markKeyInvalid).not.toHaveBeenCalled();
  });
});

describe('auth source capture at the LLM stream boundary', () => {
  test('adds source to an explicit team HTTP 401 while retaining the cause and error name', async () => {
    const original = Object.assign(new Error('Rejected credential'), {
      status: 401,
      name: 'ProviderError',
    });
    const result = await drain(
      withLlmAuthFailureStream(MODEL, TEAM_KEY, rejectedStream(original))
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    if (!(result instanceof Error)) throw new Error('Expected mock failure');
    expect(result.cause).toBe(original);
    expect(result.name).toBe(original.name);
    expect(readLlmAuthFailureSource(result.message)).toMatchObject(TEAM_SOURCE);
    expect(result.message).not.toContain(TEAM_KEY.key);
  });

  test.each([{ statusCode: 401 }, { status: undefined, statusCode: 401 }])(
    'captures an explicit SDK statusCode: %s',
    (status) => {
      const error = Object.assign(new Error('Rejected credential'), status);
      const captured = withLlmAuthFailureSource(error, TEAM_SOURCE);
      expect(readLlmAuthFailureSource(durableMessage(captured))).toMatchObject(
        TEAM_SOURCE
      );
    }
  );

  test.each([
    'LLM stream error [401, model=example]: Invalid API key',
    'LLM stream error: 401 Unauthorized',
    'HTTP 401: credential rejected',
  ])(
    'recognizes an explicit normalized provider HTTP failure: %s',
    (message) => {
      const captured = withLlmAuthFailureSource(
        new Error(message),
        TEAM_SOURCE
      );
      expect(readLlmAuthFailureSource(durableMessage(captured))).toMatchObject(
        TEAM_SOURCE
      );
    }
  );

  test.each([
    new Error('503 upstream unavailable'),
    new Error('Parsed 401 tokens before failing'),
    new Error('403 Forbidden'),
    Object.assign(new Error('401 Unauthorized in response body'), {
      status: 500,
    }),
    '401 Unauthorized',
  ])(
    'rethrows an unrelated or unproven failure unchanged',
    async (original) => {
      await expect(
        drain(
          withLlmAuthFailureStream(MODEL, TEAM_KEY, rejectedStream(original))
        )
      ).rejects.toBe(original);
    }
  );

  test('keeps a platform failure unchanged, including internal Google via fallback', async () => {
    const original = new Error('401 Unauthorized');
    const key = {
      source: 'platform',
      via: 'google',
      key: 'mock-platform-secret',
    } as const;
    await expect(
      drain(withLlmAuthFailureStream(MODEL, key, rejectedStream(original)))
    ).rejects.toBe(original);
  });

  test('preserves successful stream chunks', async () => {
    async function* successfulStream() {
      yield 'one';
      yield 'two';
    }
    await expect(
      drain(withLlmAuthFailureStream(MODEL, TEAM_KEY, successfulStream()))
    ).resolves.toEqual(['one', 'two']);
  });
});
