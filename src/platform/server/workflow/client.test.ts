import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';

const mocks = vi.hoisted(() => ({
  loadModelConfiguration: vi.fn(),
  loadComplianceRecords: vi.fn(),
  triggerCfWorkflow: vi.fn(),
  env: { E2E_TEST: undefined as string | undefined },
}));
vi.mock('#env', () => ({ getEnv: () => mocks.env }));
vi.mock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: mocks.loadModelConfiguration,
  loadComplianceRecords: mocks.loadComplianceRecords,
}));
vi.mock('./trigger-bindings', () => ({
  getCfBindingForTriggerPath: vi.fn(() => ({})),
  triggerCfWorkflow: mocks.triggerCfWorkflow,
}));
vi.mock('@/platform/server/compliance/enforcement', () => ({
  assertCanGenerate: vi.fn(),
  assertCanWrite: vi.fn(),
  resolveEnforcementState: vi.fn(),
}));
vi.mock('@/platform/server/storage/buckets', () => ({
  toCdnUrl: () => null,
}));

import { triggerWorkflowRun } from './client';

const REQUEST = { userId: 'user-1', organizationId: 'team-1' };
const SNAPSHOT: ModelRuntimeConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  sceneSplit: 'z-ai/glm-5.3-flash',
  textModelRouting: [
    {
      modelId: 'custom:mock',
      name: 'Mock model',
      channelId: 'mock-channel',
      upstreamModel: 'upstream-mock',
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
      description: 'Mock request catalog description',
      vendor: 'Mock request catalog vendor',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.E2E_TEST = undefined;
  mocks.loadComplianceRecords.mockResolvedValue({ enforcement: [] });
  mocks.loadModelConfiguration.mockResolvedValue(structuredClone(SNAPSHOT));
  mocks.triggerCfWorkflow.mockResolvedValue({
    workflowRunId: 'run-1',
    reused: false,
  });
});

describe('workflow model configuration snapshots (1)', () => {
  test('replaces a client-supplied configuration with the server snapshot', async () => {
    await triggerWorkflowRun('/storyboard', {
      ...REQUEST,
      modelConfiguration: DEFAULT_MODEL_CONFIGURATION,
    });

    expect(mocks.loadModelConfiguration).toHaveBeenCalledOnce();
    expect(mocks.triggerCfWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          ...REQUEST,
          modelConfiguration: packModelRuntimeConfiguration(SNAPSHOT),
        },
      })
    );
  });

  test('keeps the parent snapshot when current administrator settings change', async () => {
    mocks.loadModelConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
    const options = { modelConfiguration: SNAPSHOT, enforcement: [] };
    await triggerWorkflowRun('/image', REQUEST, options);
    await triggerWorkflowRun('/image', REQUEST, options);

    expect(mocks.loadModelConfiguration).not.toHaveBeenCalled();
    expect(mocks.loadComplianceRecords).not.toHaveBeenCalled();
    for (const [args] of mocks.triggerCfWorkflow.mock.calls) {
      expect(args).toEqual(
        expect.objectContaining({
          body: expect.objectContaining({
            modelConfiguration: packModelRuntimeConfiguration(SNAPSHOT),
          }),
        })
      );
    }

    await triggerWorkflowRun('/image', REQUEST);
    expect(mocks.loadModelConfiguration).toHaveBeenCalledOnce();
    expect(mocks.triggerCfWorkflow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: { ...REQUEST, modelConfiguration: DEFAULT_MODEL_CONFIGURATION },
      })
    );
  });
});

describe('workflow model configuration snapshots (2)', () => {
  test('does not start a new run if its configuration cannot be loaded', async () => {
    mocks.loadModelConfiguration.mockRejectedValueOnce(
      new Error('configuration unavailable')
    );
    await expect(triggerWorkflowRun('/storyboard', REQUEST)).rejects.toThrow(
      'configuration unavailable'
    );
    expect(mocks.triggerCfWorkflow).not.toHaveBeenCalled();
  });

  test('keeps the existing E2E mock path free of configuration reads', async () => {
    mocks.env.E2E_TEST = 'true';
    await expect(
      triggerWorkflowRun('/storyboard', REQUEST, {
        deduplicationId: 'mock-run',
      })
    ).resolves.toEqual({ workflowRunId: 'mock-run', reused: false });
    expect(mocks.loadModelConfiguration).not.toHaveBeenCalled();
    expect(mocks.triggerCfWorkflow).not.toHaveBeenCalled();
  });
});
