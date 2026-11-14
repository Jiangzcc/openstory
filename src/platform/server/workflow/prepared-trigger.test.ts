import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { EnforcementRow } from '@/platform/server/compliance/enforcement';
import { AccountRestrictedError } from '@/platform/errors';
import { buildInstanceId } from './instance-id';
import { WorkflowLaunchPendingError } from './launch-pending';
import {
  prepareWorkflowRun,
  triggerPreparedWorkflow,
  WorkflowLaunchPendingError as ReexportedLaunchPendingError,
  type PreparedWorkflowRun,
} from './prepared-trigger';

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  dispose: vi.fn(),
  generateId: vi.fn(),
  loadComplianceRecords: vi.fn(),
  loadModelRuntimeConfiguration: vi.fn(),
}));
vi.mock('#env', () => ({ getEnv: mocks.getEnv }));
vi.mock('@/platform/id', () => ({ generateId: mocks.generateId }));
vi.mock('@/platform/server/db/scoped', () => ({
  loadComplianceRecords: mocks.loadComplianceRecords,
  loadModelRuntimeConfiguration: mocks.loadModelRuntimeConfiguration,
}));
vi.mock('@/platform/server/storage/buckets', () => ({ toCdnUrl: () => null }));

const MAX_INSTANCE_ID_LENGTH = 100;
const FIRST_RUN = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SECOND_RUN = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const REQUEST = {
  userId: 'mock-user',
  organizationId: 'mock-organization',
  promptLocale: 'en' as const,
  sequenceId: 'mock-sequence',
};
const ENV = {
  VITE_APP_URL: 'https://prepared.example',
  IMAGE_WORKFLOW: { create: mocks.create, get: mocks.get },
  UPLOAD_CHECK_WORKFLOW: { create: mocks.create, get: mocks.get },
  SEQUENCE_EXPORT_WORKFLOW: { create: mocks.create, get: mocks.get },
};
const SNAPSHOT: ModelRuntimeConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  textModelRouting: [
    {
      modelId: 'custom:mock',
      name: 'Mock model',
      channelId: 'mock-channel',
      upstreamModel: 'mock-upstream',
      credentialId: 'mock-credential-v1',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://mock.invalid/v1',
      vision: false,
      structuredOutput: true,
      tools: true,
      contextWindow: 8_000,
      maxOutputTokens: 2_000,
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
      description: 'Mock catalog description',
      vendor: 'Mock vendor',
    },
  ],
};

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function suspension(action: EnforcementRow['action']): EnforcementRow {
  return {
    id: 'mock-enforcement',
    action,
    reason: 'portrait_rights',
    notes: null,
    effectiveAt: new Date('2020-01-01T00:00:00Z'),
    expiresAt: null,
    revokedAt: null,
  };
}

function alreadyExists(): Error {
  return new Error('(instance.already_exists) Instance already exists');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getEnv.mockReturnValue(ENV);
  mocks.generateId.mockReturnValue(FIRST_RUN);
  mocks.loadComplianceRecords.mockResolvedValue({ enforcement: [] });
  mocks.loadModelRuntimeConfiguration.mockResolvedValue(
    structuredClone(SNAPSHOT)
  );
  mocks.create.mockImplementation(async ({ id }: { id: string }) => ({
    id,
    [Symbol.dispose]: mocks.dispose,
  }));
});

describe('prepared workflow reservation', () => {
  it('reserves the final environment-scoped id without starting an instance', async () => {
    const prepared = await prepareWorkflowRun('/image', REQUEST, {
      deduplicationId: FIRST_RUN,
    });
    expect(prepared).toEqual({
      workflowRunId: buildInstanceId({
        env: ENV,
        workflowName: 'image',
        suffix: FIRST_RUN,
      }),
      triggerPath: '/image',
      body: {
        ...REQUEST,
        modelConfiguration: packModelRuntimeConfiguration(SNAPSHOT),
      },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateId).not.toHaveBeenCalled();
  });

  it('dispatches the reserved id and packed body after a JSON round trip', async () => {
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    const restored: PreparedWorkflowRun<typeof REQUEST> =
      jsonRoundTrip(prepared);
    expect(await triggerPreparedWorkflow(restored)).toBe(
      prepared.workflowRunId
    );
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      id: prepared.workflowRunId,
      params: restored.body,
    });
    expect(Object.keys(restored).sort()).toEqual([
      'body',
      'triggerPath',
      'workflowRunId',
    ]);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});

describe('prepared workflow configuration ownership', () => {
  it('replaces client-supplied settings with a trusted packed snapshot', async () => {
    const prepared = await prepareWorkflowRun(
      '/image',
      {
        ...REQUEST,
        modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
      },
      { modelConfiguration: SNAPSHOT, enforcement: [] }
    );
    expect(prepared.body.modelConfiguration).toEqual(
      packModelRuntimeConfiguration(SNAPSHOT)
    );
    expect(mocks.loadModelRuntimeConfiguration).not.toHaveBeenCalled();
    expect(mocks.loadComplianceRecords).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared)).not.toContain('Mock catalog description');
    expect(JSON.stringify(prepared)).not.toContain('Mock vendor');
  });

  it('detaches the request and configuration before the caller takes a claim', async () => {
    const request = { ...REQUEST, metadata: { prompt: 'original prompt' } };
    const configuration = structuredClone(SNAPSHOT);
    const prepared = await prepareWorkflowRun('/image', request, {
      modelConfiguration: configuration,
    });
    const original = jsonRoundTrip(prepared);
    request.metadata.prompt = 'changed prompt';
    configuration.sceneSplit = 'z-ai/glm-5.3-flash';
    configuration.textModelRouting = [];
    expect(prepared).toEqual(original);
    await triggerPreparedWorkflow(prepared);
    expect(mocks.create).toHaveBeenCalledWith({
      id: original.workflowRunId,
      params: original.body,
    });
  });
});

describe('prepared workflow snapshot replay', () => {
  it('never reloads or repacks the current catalog during dispatch or redispatch', async () => {
    const prepared = jsonRoundTrip(await prepareWorkflowRun('/image', REQUEST));
    const captured = jsonRoundTrip(prepared.body.modelConfiguration);
    mocks.loadModelRuntimeConfiguration.mockRejectedValue(
      new Error('catalog must not be read')
    );
    await triggerPreparedWorkflow(prepared);
    await triggerPreparedWorkflow(jsonRoundTrip(prepared));
    expect(mocks.loadModelRuntimeConfiguration).toHaveBeenCalledOnce();
    expect(mocks.loadComplianceRecords).toHaveBeenCalledTimes(3);
    for (const [call] of mocks.create.mock.calls) {
      expect(call).toEqual({
        id: prepared.workflowRunId,
        params: { ...REQUEST, modelConfiguration: captured },
      });
    }
  });

  it('rethrows a configuration load failure before any dispatch', async () => {
    const failure = new Error('configuration unavailable');
    mocks.loadModelRuntimeConfiguration.mockRejectedValue(failure);
    await expect(prepareWorkflowRun('/image', REQUEST)).rejects.toBe(failure);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a payload that cannot be persisted as JSON before dispatch', async () => {
    await expect(
      prepareWorkflowRun('/image', { ...REQUEST, unsupported: BigInt(1) })
    ).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('prepared workflow predispatch validation', () => {
  it('refuses an unmapped trigger path during preparation', async () => {
    await expect(
      prepareWorkflowRun('/not-a-workflow', REQUEST)
    ).rejects.toThrow(/no workflow binding mapped/);
    expect(mocks.loadModelRuntimeConfiguration).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a missing binding before the caller takes a claim', async () => {
    mocks.getEnv.mockReturnValue({ VITE_APP_URL: ENV.VITE_APP_URL });
    await expect(prepareWorkflowRun('/image', REQUEST)).rejects.toThrow(
      /missing or not a Workflow binding/
    );
    expect(mocks.loadModelRuntimeConfiguration).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a binding whose create method is not callable during preparation', async () => {
    mocks.getEnv.mockReturnValue({
      ...ENV,
      IMAGE_WORKFLOW: { create: 'mock-invalid-method' },
    });
    await expect(prepareWorkflowRun('/image', REQUEST)).rejects.toThrow(
      /missing or not a Workflow binding/
    );
    expect(mocks.loadModelRuntimeConfiguration).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports a prefix that cannot fit before returning a reservation', async () => {
    mocks.getEnv.mockReturnValue({
      ...ENV,
      VITE_APP_URL:
        'https://' + 'x'.repeat(MAX_INSTANCE_ID_LENGTH) + '.invalid',
    });
    await expect(prepareWorkflowRun('/image', REQUEST)).rejects.toThrow(
      /exceeds the 100-char limit/
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('prepared workflow instance identity', () => {
  it('keeps the ULID at the beginning of the suffix even with a long sequence id', async () => {
    const sequenceId = 'long-sequence-'.repeat(MAX_INSTANCE_ID_LENGTH);
    mocks.generateId
      .mockReturnValueOnce(FIRST_RUN)
      .mockReturnValueOnce(SECOND_RUN);
    const first = await prepareWorkflowRun('/image', {
      ...REQUEST,
      sequenceId,
    });
    const second = await prepareWorkflowRun('/image', {
      ...REQUEST,
      sequenceId,
    });
    expect(first.workflowRunId).toBe('prepared-example_image_' + FIRST_RUN);
    expect(second.workflowRunId).toBe('prepared-example_image_' + SECOND_RUN);
    expect(first.workflowRunId).not.toBe(second.workflowRunId);
  });

  it('preserves leading entropy when truncating a long deduplication suffix', async () => {
    const suffix = FIRST_RUN + '-sequence-'.repeat(MAX_INSTANCE_ID_LENGTH);
    const prepared = await prepareWorkflowRun('/image', REQUEST, {
      deduplicationId: suffix,
    });
    expect(prepared.workflowRunId).toHaveLength(MAX_INSTANCE_ID_LENGTH);
    expect(prepared.workflowRunId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(prepared.workflowRunId).toContain('_image_' + FIRST_RUN);
  });

  it('does not regenerate the id after environment metadata changes', async () => {
    const prepared = jsonRoundTrip(await prepareWorkflowRun('image', REQUEST));
    mocks.getEnv.mockReturnValue({
      ...ENV,
      VITE_APP_URL: 'https://changed.example',
    });
    expect(await triggerPreparedWorkflow(prepared)).toBe(
      prepared.workflowRunId
    );
    expect(mocks.create).toHaveBeenCalledWith({
      id: prepared.workflowRunId,
      params: prepared.body,
    });
  });
});

describe('prepared workflow already-existing instances', () => {
  it.each([
    'queued',
    'running',
    'paused',
    'waiting',
    'complete',
    'errored',
    'terminated',
    'unknown',
  ])(
    'accepts the exact reserved id for an existing %s instance without checking status',
    async (status) => {
      const prepared = jsonRoundTrip(
        await prepareWorkflowRun('/image', REQUEST)
      );
      mocks.create.mockRejectedValue(alreadyExists());
      mocks.get.mockResolvedValue({
        id: prepared.workflowRunId,
        status: async () => ({ status }),
      });
      expect(await triggerPreparedWorkflow(prepared)).toBe(
        prepared.workflowRunId
      );
      expect(await triggerPreparedWorkflow(jsonRoundTrip(prepared))).toBe(
        prepared.workflowRunId
      );
      expect(mocks.create).toHaveBeenCalledTimes(2);
      for (const [call] of mocks.create.mock.calls) {
        expect(call).toEqual({
          id: prepared.workflowRunId,
          params: prepared.body,
        });
      }
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.dispose).not.toHaveBeenCalled();
    }
  );

  it('accepts already_exists even when an instance lookup would fail', async () => {
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    mocks.create.mockRejectedValue(alreadyExists());
    mocks.get.mockRejectedValue(new Error('status unavailable'));
    await expect(triggerPreparedWorkflow(prepared)).resolves.toBe(
      prepared.workflowRunId
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('prepared workflow uncertain dispatch results', () => {
  it('rethrows a lost response and redelivers the original reservation', async () => {
    const prepared = jsonRoundTrip(await prepareWorkflowRun('/image', REQUEST));
    const responseLost = new Error(
      'mock create accepted but response was lost'
    );
    const acceptedIds = new Set<string>();
    mocks.create.mockImplementation(async ({ id }: { id: string }) => {
      if (acceptedIds.has(id)) throw alreadyExists();
      acceptedIds.add(id);
      throw responseLost;
    });
    await expect(triggerPreparedWorkflow(prepared)).rejects.toBe(responseLost);
    await expect(
      triggerPreparedWorkflow(jsonRoundTrip(prepared))
    ).resolves.toBe(prepared.workflowRunId);
    expect(acceptedIds).toEqual(new Set([prepared.workflowRunId]));
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('preserves other create errors without probing or changing the reservation', async () => {
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    const failure = new Error('mock upstream binding transport failure');
    mocks.create.mockRejectedValue(failure);
    await expect(triggerPreparedWorkflow(prepared)).rejects.toBe(failure);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      id: prepared.workflowRunId,
      params: prepared.body,
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('prepared workflow enforcement before claims', () => {
  it('refuses a generation suspension before loading configuration or reserving an id', async () => {
    mocks.loadComplianceRecords.mockResolvedValue({
      enforcement: [suspension('generation_suspended')],
    });
    await expect(prepareWorkflowRun('/image', REQUEST)).rejects.toBeInstanceOf(
      AccountRestrictedError
    );
    expect(mocks.getEnv).not.toHaveBeenCalled();
    expect(mocks.loadModelRuntimeConfiguration).not.toHaveBeenCalled();
    expect(mocks.generateId).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('honors caller-supplied enforcement rows during trusted preparation', async () => {
    await expect(
      prepareWorkflowRun('/image', REQUEST, {
        enforcement: [suspension('account_suspended')],
      })
    ).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(mocks.loadComplianceRecords).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('prepared workflow enforcement on replay', () => {
  it('checks live enforcement again instead of persisting an empty allowance', async () => {
    const prepared = jsonRoundTrip(
      await prepareWorkflowRun('/image', REQUEST, { enforcement: [] })
    );
    mocks.loadComplianceRecords.mockResolvedValue({
      enforcement: [suspension('generation_suspended')],
    });
    await expect(triggerPreparedWorkflow(prepared)).rejects.toBeInstanceOf(
      AccountRestrictedError
    );
    expect(mocks.loadComplianceRecords).toHaveBeenCalledExactlyOnceWith(
      REQUEST.userId,
      REQUEST.organizationId
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('checks enforcement on a redelivery even after an earlier accepted dispatch', async () => {
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    await triggerPreparedWorkflow(prepared);
    mocks.loadComplianceRecords.mockResolvedValue({
      enforcement: [suspension('account_suspended')],
    });
    await expect(
      triggerPreparedWorkflow(jsonRoundTrip(prepared))
    ).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('propagates enforcement read failures without dispatching', async () => {
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    const failure = new Error('mock enforcement unavailable');
    mocks.loadComplianceRecords.mockRejectedValue(failure);
    await expect(triggerPreparedWorkflow(prepared)).rejects.toBe(failure);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('prepared workflow export enforcement', () => {
  it('retains the write-only policy under a generation suspension', async () => {
    mocks.loadComplianceRecords.mockResolvedValue({
      enforcement: [suspension('generation_suspended')],
    });
    const prepared = await prepareWorkflowRun('/sequence-export', REQUEST);
    await expect(triggerPreparedWorkflow(prepared)).resolves.toBe(
      prepared.workflowRunId
    );
  });

  it('refuses export redispatch once the account becomes read-only', async () => {
    const prepared = await prepareWorkflowRun('/sequence-export', REQUEST);
    mocks.loadComplianceRecords.mockResolvedValue({
      enforcement: [suspension('account_suspended')],
    });
    await expect(triggerPreparedWorkflow(prepared)).rejects.toBeInstanceOf(
      AccountRestrictedError
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('prepared workflows in isolated E2E mode', () => {
  it('uses the reserved id for mocked dispatch and redelivery without starting a provider workflow', async () => {
    mocks.getEnv.mockReturnValue({
      VITE_APP_URL: ENV.VITE_APP_URL,
      E2E_TEST: 'true',
    });
    const prepared = jsonRoundTrip(
      await prepareWorkflowRun('/image', REQUEST, {
        deduplicationId: FIRST_RUN,
      })
    );
    await expect(triggerPreparedWorkflow(prepared)).resolves.toBe(
      prepared.workflowRunId
    );
    await expect(
      triggerPreparedWorkflow(jsonRoundTrip(prepared))
    ).resolves.toBe(prepared.workflowRunId);
    expect(prepared.workflowRunId).toBe('prepared-example_image_' + FIRST_RUN);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('still enforces a suspension while workflow dispatch is mocked', async () => {
    mocks.getEnv.mockReturnValue({ E2E_TEST: 'true' });
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    mocks.loadComplianceRecords.mockResolvedValue({
      enforcement: [suspension('generation_suspended')],
    });
    await expect(triggerPreparedWorkflow(prepared)).rejects.toBeInstanceOf(
      AccountRestrictedError
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('prepared workflows that must run under E2E', () => {
  it('retains RUNS_UNDER_E2E for upload-check using the same reserved id', async () => {
    mocks.getEnv.mockReturnValue({ ...ENV, E2E_TEST: 'true' });
    const prepared = await prepareWorkflowRun('/upload-check', REQUEST);
    await triggerPreparedWorkflow(prepared);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      id: prepared.workflowRunId,
      params: prepared.body,
    });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('dispatches through the mock binding when E2E_FULL_PIPELINE is enabled', async () => {
    mocks.getEnv.mockReturnValue({
      ...ENV,
      E2E_TEST: 'true',
      E2E_FULL_PIPELINE: 'true',
    });
    const prepared = await prepareWorkflowRun('/image', REQUEST);
    await triggerPreparedWorkflow(prepared);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      id: prepared.workflowRunId,
      params: prepared.body,
    });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});

describe('WorkflowLaunchPendingError', () => {
  it('re-exports the same lightweight error constructor', () => {
    expect(ReexportedLaunchPendingError).toBe(WorkflowLaunchPendingError);
  });

  it('keeps the exact workflow id, owning reservation and original cause', () => {
    const cause = new Error('mock dispatch response lost');
    const error = new WorkflowLaunchPendingError({
      workflowRunId: FIRST_RUN,
      reservationId: 'mock-reservation',
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorkflowLaunchPendingError');
    expect(error.message).toBe(
      "Couldn't verify whether a generation is still running — please try again in a moment."
    );
    expect(error.workflowRunId).toBe(FIRST_RUN);
    expect(error.reservationId).toBe('mock-reservation');
    expect(error.cause).toBe(cause);
  });

  it('supports no reservation and preserves non-Error causes verbatim', () => {
    const cause = { message: 'mock publish rejected' };
    const error = new WorkflowLaunchPendingError({
      workflowRunId: FIRST_RUN,
      cause,
    });
    expect(error.workflowRunId).toBe(FIRST_RUN);
    expect(error.reservationId).toBeUndefined();
    expect(error.cause).toBe(cause);
  });
});
