import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { asStub } from '@/test/as-stub';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type {
  ImageGenerationAttempt,
  ImageAttemptIdentity,
} from '../configured-image-attempt';
import type { ImageGenerationResult } from '../image-generation';
import { runConfiguredImageStep } from './configured-image-step';

const { generate, requireCredits } = vi.hoisted(() => ({
  generate: vi.fn<() => Promise<ImageGenerationResult>>(),
  requireCredits: vi.fn(async () => undefined),
}));
vi.mock('../image-generation', () => ({ generateImageWithProvider: generate }));
vi.mock('@/billing/server/preflight', () => ({ requireCredits }));

const ENGINE_ABORT_MESSAGE = 'Aborting engine: Grace period complete';
const MOCK_STORED_IMAGE = {
  url: '/r2/mock/result.png',
  path: 'mock/result.png',
};

// In-memory workflow and attempt mocks; no provider, wallet or application data writes.
function mockAttemptMethods() {
  const rows = new Map<string, ImageGenerationAttempt>();
  const getById = vi.fn(async (identity: ImageAttemptIdentity) =>
    rows.get(identity.id)
  );
  const claim = vi.fn(async (identity: ImageAttemptIdentity) => {
    const attempt: ImageGenerationAttempt = {
      ...identity,
      status: 'submitted',
    };
    rows.set(identity.id, attempt);
    return { claimed: true, attempt };
  });
  const markUnknown = vi.fn(async () => undefined);
  const complete = vi.fn(async () => undefined);
  return { rows, getById, claim, markUnknown, complete };
}

function mockWorkflowStep() {
  const checkpoints = new Map<string, unknown>();
  const runStep = async <T>(
    name: string,
    _configuration: unknown,
    callback: () => Promise<T>
  ) => {
    if (checkpoints.has(name)) return asStub<T>(checkpoints.get(name));
    const result = await callback();
    checkpoints.set(name, result);
    return result;
  };
  return asStub<WorkflowStep>({ do: runStep });
}

function harness() {
  const attempts = mockAttemptMethods();
  const routing = createImageModelRoutingSnapshot(imageConfigurationFixture());
  const scopedDb = asStub<WorkflowScopedDb>({
    models: { imageModelRouting: routing },
    imageGenerationAttempts: attempts,
    claims: { imageGenerationAttempts: attempts },
  });
  const store = vi.fn(async () => [MOCK_STORED_IMAGE]);
  const step = mockWorkflowStep();
  return {
    attempts,
    store,
    run: () =>
      runConfiguredImageStep({
        step,
        scopedDb,
        store,
        stepName: 'mock-image',
        workflowRunId: 'mock-run',
        params: {
          model: 'custom-image:qwen',
          prompt: 'Mock interruption test',
        },
      }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  generate.mockResolvedValue(
    asStub<ImageGenerationResult>({
      imageUrls: ['mock-image'],
      via: 'compatible',
      metadata: {
        prompt: 'Mock interruption test',
        model: 'custom-image:qwen',
        endpointId: 'mock-generate',
        dimensions: [{ width: 1024, height: 1024 }],
        file_sizes: [10],
        cost: 100000,
        usedOwnKey: false,
      },
    })
  );
});

it('preserves generation interruption and refuses automatic resubmission on replay', async () => {
  const test = harness();
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  generate.mockRejectedValueOnce(interruption);
  await expect(test.run()).rejects.toBe(interruption);
  expect(test.attempts.markUnknown).not.toHaveBeenCalled();
  expect(test.store).not.toHaveBeenCalled();
  expect(test.attempts.rows.get('mock-run:mock-image')?.status).toBe(
    'submitted'
  );
  await expect(test.run()).rejects.toThrow(
    'Automatic resubmission is disabled'
  );
  expect(generate).toHaveBeenCalledTimes(1);
});

it('preserves interruption while storing generated image bytes', async () => {
  const test = harness();
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  test.store.mockRejectedValueOnce(interruption);
  await expect(test.run()).rejects.toBe(interruption);
  expect(test.attempts.markUnknown).not.toHaveBeenCalled();
  expect(test.attempts.complete).not.toHaveBeenCalled();
});

it('replays only metadata persistence after its engine interruption', async () => {
  const test = harness();
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  test.attempts.complete.mockRejectedValueOnce(interruption);
  await expect(test.run()).rejects.toBe(interruption);
  const result = await test.run();
  expect(result.stored).toEqual([MOCK_STORED_IMAGE]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(test.store).toHaveBeenCalledTimes(1);
  expect(test.attempts.complete).toHaveBeenCalledTimes(2);
});

it('preserves interruption while recording the uncertain attempt', async () => {
  const test = harness();
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  generate.mockRejectedValueOnce(new Error('Mock storage failure'));
  test.attempts.markUnknown.mockRejectedValueOnce(interruption);
  await expect(test.run()).rejects.toBe(interruption);
});
