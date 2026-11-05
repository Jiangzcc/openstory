import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { AnalyzeScriptWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import { withLlmAuthFailureSource } from '@/platform/server/workflow/llm-auth-failure-source';
import { sanitizeFailResponse } from '@/platform/server/workflow/sanitize-fail-response';

const { emit } = vi.hoisted(() => ({ emit: vi.fn(async () => undefined) }));
vi.mock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
}));

const { AnalyzeScriptWorkflow } = await import('./analyze-script-workflow');

class Probe extends AnalyzeScriptWorkflow {
  failed(error: string, scopedDb: WorkflowScopedDb) {
    const payload = asStub<AnalyzeScriptWorkflowInput>({
      sequenceId: 'mock-sequence',
      reservationId: 'mock-reservation',
      analysisModelId: 'anthropic/claude-sonnet-5.5',
    });
    const event = asStub<Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>>({
      payload,
    });
    return this.onFailure({ event, error, scopedDb });
  }
}

function makeWorkflow() {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function makeDb() {
  const updateStatus = vi.fn(async () => undefined);
  const markKeyInvalid = vi.fn(async () => undefined);
  const zeroReservation = vi.fn(async () => undefined);
  const resolveLlmKey = vi.fn(async () => ({
    source: 'team',
    via: 'openrouter',
    key: 'mock-team-key',
  }));
  const scopedDb = asStub<WorkflowScopedDb>({
    sequence: () => ({ updateStatus }),
    apiKeys: { markKeyInvalid },
    billing: { zeroReservation },
    credentials: { resolveLlmKey },
  });
  return {
    scopedDb,
    updateStatus,
    markKeyInvalid,
    zeroReservation,
    resolveLlmKey,
  };
}

function childFailure(error: unknown) {
  if (!(error instanceof Error))
    throw new Error('Expected mocked child failure');
  const wire: { name: string; message: string } = JSON.parse(
    JSON.stringify({ name: error.name, message: error.message })
  );
  return sanitizeFailResponse(
    'Child workflow mock-child failed: ' + wire.name + ': ' + wire.message
  );
}

describe('AnalyzeScriptWorkflow sanitized child auth failures (local mocks)', () => {
  beforeEach(() => emit.mockClear());

  test('uses a child split credential rather than the parent analysis model', async () => {
    const {
      scopedDb,
      updateStatus,
      markKeyInvalid,
      zeroReservation,
      resolveLlmKey,
    } = makeDb();
    const error = withLlmAuthFailureSource(new Error('401 Unauthorized'), {
      model: 'google/gemini-3-flash-preview',
      source: 'team',
      via: 'google',
    });
    await makeWorkflow().failed(childFailure(error), scopedDb);
    const message = 'Your Google API key is invalid — update it in Settings.';
    expect(markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
      'google',
      '401 Unauthorized'
    );
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith('failed', message);
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      message,
    });
    expect(zeroReservation).toHaveBeenCalledExactlyOnceWith('mock-reservation');
    expect(resolveLlmKey).not.toHaveBeenCalled();
  });

  test('does not reinterpret an untagged platform child 401 as the parent team key', async () => {
    const { scopedDb, updateStatus, markKeyInvalid, resolveLlmKey } = makeDb();
    await makeWorkflow().failed(
      childFailure(new Error('401 Unauthorized')),
      scopedDb
    );
    expect(markKeyInvalid).not.toHaveBeenCalled();
    expect(resolveLlmKey).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(
      'failed',
      '401 Unauthorized'
    );
  });

  test('removes platform source metadata from the existing failure message', async () => {
    const { scopedDb, updateStatus, markKeyInvalid, resolveLlmKey } = makeDb();
    const error = withLlmAuthFailureSource(new Error('401 Unauthorized'), {
      model: 'custom:platform-helper',
      source: 'platform',
      via: 'compatible',
    });
    await makeWorkflow().failed(childFailure(error), scopedDb);
    expect(markKeyInvalid).not.toHaveBeenCalled();
    expect(resolveLlmKey).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(
      'failed',
      '401 Unauthorized'
    );
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      message: '401 Unauthorized',
    });
  });
});
