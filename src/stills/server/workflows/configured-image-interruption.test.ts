import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { asStub } from '@/test/as-stub';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type { ImageGenerationResult } from '../image-generation';
import { runConfiguredImageStep } from './configured-image-step';

const { generate, requireCredits } = vi.hoisted(() => ({
  generate: vi.fn<() => Promise<ImageGenerationResult>>(),
  requireCredits: vi.fn(async () => undefined),
}));
vi.mock('../configured-image-generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../configured-image-generation')>()),
  generateConfiguredImage: generate,
}));
vi.mock('@/billing/server/preflight', () => ({ requireCredits }));

const ENGINE_ABORT_MESSAGE = 'Aborting engine: Grace period complete';
const MOCK_STORED_IMAGE = {
  url: '/r2/mock/result.png',
  path: 'mock/result.png',
};

// Mock workflow checkpoints; provider and wallet calls are substituted.
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
  const routing = createImageModelRoutingSnapshot(imageConfigurationFixture());
  const scopedDb = asStub<WorkflowScopedDb>({
    models: { imageModelRouting: routing },
  });
  const store = vi.fn(async () => [MOCK_STORED_IMAGE]);
  const step = mockWorkflowStep();
  return {
    store,
    run: () =>
      runConfiguredImageStep({
        step,
        scopedDb,
        store,
        stepName: 'mock-image',
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

it('preserves generation interruption before storage', async () => {
  const test = harness();
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  generate.mockRejectedValueOnce(interruption);
  await expect(test.run()).rejects.toBe(interruption);
  expect(test.store).not.toHaveBeenCalled();
  expect(generate).toHaveBeenCalledTimes(1);
});

it('preserves interruption while storing generated image bytes', async () => {
  const test = harness();
  const interruption = new Error(ENGINE_ABORT_MESSAGE);
  test.store.mockRejectedValueOnce(interruption);
  await expect(test.run()).rejects.toBe(interruption);
});
