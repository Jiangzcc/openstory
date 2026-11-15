import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { AnalyzeScriptWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import {
  createStoryboardLifecycleStub,
  storyboardFailureInput,
} from './storyboard-workflow.test.fixture';
import { withLlmAuthFailureSource } from '@/platform/server/workflow/llm-auth-failure-source';
import { sanitizeFailResponse } from '@/platform/server/workflow/sanitize-fail-response';

const { emit } = vi.hoisted(() => ({ emit: vi.fn(async () => undefined) }));
vi.mock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
}));

const { AnalyzeScriptWorkflow } = await import('./analyze-script-workflow');
const ANALYZE_INSTANCE_ID = 'synthetic-analyze-auth-instance';
const STORYBOARD_OWNER = {
  workflowRunId: 'synthetic-storyboard-auth-instance',
  workflowClaimId: 'synthetic-storyboard-auth-claim',
};
const AUTH_MESSAGE = 'Your Google API key is invalid — update it in Settings.';

class Probe extends AnalyzeScriptWorkflow {
  failed(
    error: string,
    scopedDb: WorkflowScopedDb,
    extras: Partial<AnalyzeScriptWorkflowInput> = {}
  ) {
    const payload = asStub<AnalyzeScriptWorkflowInput>({
      sequenceId: 'mock-sequence',
      reservationId: 'mock-reservation',
      analysisModelId: 'anthropic/claude-sonnet-5.5',
      ...extras,
    });
    const event = asStub<Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>>({
      payload,
      instanceId: ANALYZE_INSTANCE_ID,
    });
    return this.onFailure({ event, error, scopedDb });
  }
}

function makeWorkflow() {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function makeDb() {
  const methods = createStoryboardLifecycleStub();
  const updateStatus = vi.fn(async () => undefined);
  const markKeyInvalid = vi.fn(async () => undefined);
  const zeroReservation = vi.fn(async () => undefined);
  const resolveLlmKey = vi.fn(async () => ({
    source: 'organization',
    via: 'openrouter',
    key: 'mock-team-key',
  }));
  const scopedDb = asStub<WorkflowScopedDb>({
    sequence: () => ({ updateStatus }),
    sequences: methods,
    apiKeys: { markKeyInvalid },
    billing: { zeroReservation },
    credentials: { resolveLlmKey },
  });
  return {
    scopedDb,
    ...methods,
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

// Standalone assertions preserve CLI behavior without proving concurrent ownership.
describe('AnalyzeScriptWorkflow sanitized child auth failures (local mocks)', () => {
  beforeEach(() => {
    emit.mockReset();
    emit.mockResolvedValue(undefined);
  });

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
      source: 'organization',
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
      workflowOwner: undefined,
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
      workflowOwner: undefined,
      message: '401 Unauthorized',
    });
  });

  test('still emits failure when sequence status persistence fails', async () => {
    const { scopedDb, updateStatus } = makeDb();
    const persistenceError = new Error('database down');
    updateStatus.mockRejectedValueOnce(persistenceError);
    emit.mockClear();

    await expect(makeWorkflow().failed('boom', scopedDb)).rejects.toBe(
      persistenceError
    );

    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      workflowOwner: undefined,
      message: 'boom',
    });
  });
  test('keeps reservation release best effort for ordinary errors', async () => {
    const { scopedDb, zeroReservation, updateStatus } = makeDb();
    zeroReservation.mockRejectedValueOnce(new Error('reservation unavailable'));

    await expect(
      makeWorkflow().failed('boom', scopedDb)
    ).resolves.toBeUndefined();
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith('failed', 'boom');
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      workflowOwner: undefined,
      message: 'boom',
    });
  });

  test('propagates key invalidation errors after persisting and emitting the fallback', async () => {
    const { scopedDb, markKeyInvalid, updateStatus } = makeDb();
    const authError = new Error('key invalidation unavailable');
    markKeyInvalid.mockRejectedValueOnce(authError);
    const failure = withLlmAuthFailureSource(new Error('401 Unauthorized'), {
      model: 'google/gemini-3-flash-preview',
      source: 'organization',
      via: 'google',
    });

    await expect(
      makeWorkflow().failed(childFailure(failure), scopedDb)
    ).rejects.toBe(authError);
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith(
      'failed',
      '401 Unauthorized'
    );
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      workflowOwner: undefined,
      message: '401 Unauthorized',
    });
  });

  test.each(['zeroReservation', 'markKeyInvalid', 'updateStatus'] as const)(
    'stops later actions when %s aborts',
    async (phase) => {
      const db = makeDb();
      const abort = new Error(
        'Durable Object reset because its code was updated'
      );
      db[phase].mockRejectedValueOnce(abort);
      const failure = withLlmAuthFailureSource(new Error('401 Unauthorized'), {
        model: 'google/gemini-3-flash-preview',
        source: 'organization',
        via: 'google',
      });

      await expect(
        makeWorkflow().failed(childFailure(failure), db.scopedDb)
      ).rejects.toBe(abort);
      if (phase === 'zeroReservation')
        expect(db.markKeyInvalid).not.toHaveBeenCalled();
      if (phase !== 'updateStatus')
        expect(db.updateStatus).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    }
  );

  test.each([
    'channel unavailable',
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('propagates notification error: %s', async (message) => {
    const { scopedDb, updateStatus } = makeDb();
    const notificationError = new Error(message);
    emit.mockRejectedValueOnce(notificationError);

    await expect(makeWorkflow().failed('boom', scopedDb)).rejects.toBe(
      notificationError
    );
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith('failed', 'boom');
  });
});

function taggedAuthFailure() {
  return childFailure(
    withLlmAuthFailureSource(new Error('401 Unauthorized'), {
      model: 'google/gemini-3-flash-preview',
      source: 'organization',
      via: 'google',
    })
  );
}

// Credential, reservation, guard and realtime services are explicit substitutes here.
describe('AnalyzeScriptWorkflow parented auth failure actions (service substitutes)', () => {
  beforeEach(() => {
    emit.mockReset();
    emit.mockResolvedValue(undefined);
  });
  test(
    'guards the root owner while preserving the credential-specific message',
    verifyRootAuthFailure
  );
  test(
    'still handles credentials and reservations after ownership has moved',
    verifyLostOwnerAuthFailure
  );
  test(
    'does not notify an unpersisted failure and preserves the guard error',
    verifyGuardFailure
  );
  test.each([
    'Aborting engine: Grace period complete',
    'Durable Object reset because its code was updated',
  ])('stops notification when the guard aborts: %s', verifyGuardAbort);
  test(
    'an unknown parent still handles credentials and reservations without a terminal write',
    verifyUnknownParentAuthFailure
  );
});

async function verifyRootAuthFailure() {
  const db = makeDb();
  await makeWorkflow().failed(taggedAuthFailure(), db.scopedDb, {
    storyboardOwner: STORYBOARD_OWNER,
  });
  expect(db.failWorkflowIfCurrent).toHaveBeenCalledExactlyOnceWith(
    storyboardFailureInput(
      { id: 'mock-sequence', ...STORYBOARD_OWNER },
      AUTH_MESSAGE
    )
  );
  expect(db.updateStatus).not.toHaveBeenCalled();
  expect(db.markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
    'google',
    '401 Unauthorized'
  );
  expect(db.zeroReservation).toHaveBeenCalledExactlyOnceWith(
    'mock-reservation'
  );
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
    workflowOwner: STORYBOARD_OWNER,
    message: AUTH_MESSAGE,
  });
}

async function verifyLostOwnerAuthFailure() {
  const db = makeDb();
  db.failWorkflowIfCurrent.mockResolvedValueOnce(false);
  await makeWorkflow().failed(taggedAuthFailure(), db.scopedDb, {
    storyboardOwner: STORYBOARD_OWNER,
  });
  expect(db.markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
    'google',
    '401 Unauthorized'
  );
  expect(db.zeroReservation).toHaveBeenCalledExactlyOnceWith(
    'mock-reservation'
  );
  expect(db.updateStatus).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
}

async function verifyGuardFailure() {
  const db = makeDb();
  const failure = new Error('Synthetic ownership persistence failure');
  db.failWorkflowIfCurrent.mockRejectedValueOnce(failure);
  await expect(
    makeWorkflow().failed(taggedAuthFailure(), db.scopedDb, {
      storyboardOwner: STORYBOARD_OWNER,
    })
  ).rejects.toBe(failure);
  expect(db.updateStatus).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
}

async function verifyGuardAbort(message: string) {
  const db = makeDb();
  const failure = new Error(message);
  db.failWorkflowIfCurrent.mockRejectedValueOnce(failure);
  await expect(
    makeWorkflow().failed(taggedAuthFailure(), db.scopedDb, {
      storyboardOwner: STORYBOARD_OWNER,
    })
  ).rejects.toBe(failure);
  expect(db.markKeyInvalid).toHaveBeenCalledOnce();
  expect(db.zeroReservation).toHaveBeenCalledOnce();
  expect(db.updateStatus).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
}

async function verifyUnknownParentAuthFailure() {
  const db = makeDb();
  await makeWorkflow().failed(taggedAuthFailure(), db.scopedDb, {
    _parent: {
      bindingName: 'MOTION_BATCH_WORKFLOW',
      parentInstanceId: 'synthetic-unknown-parent',
      eventType: 'synthetic-unknown-parent-done',
    },
  });
  expect(db.markKeyInvalid).toHaveBeenCalledExactlyOnceWith(
    'google',
    '401 Unauthorized'
  );
  expect(db.zeroReservation).toHaveBeenCalledExactlyOnceWith(
    'mock-reservation'
  );
  expect(db.failWorkflowIfCurrent).not.toHaveBeenCalled();
  expect(db.updateStatus).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
}
