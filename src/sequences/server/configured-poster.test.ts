import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { micros } from '@/billing/money';
import { asStub } from '@/test/as-stub';

const generateImage = vi.fn();
const uploadPoster = vi.fn();
vi.doMock('@/stills/server/image-generation', () => ({
  generateImageWithProvider: generateImage,
}));
vi.doMock('@/stills/server/image-storage', () => ({
  uploadPosterToStorage: uploadPoster,
}));
const { generateConfiguredPoster } = await import('./configured-poster');

const MODEL = 'custom-image:qwen';
const STORED = {
  url: '/r2/thumbnails/mock-poster.png',
  path: 'mock-poster.png',
};
const GENERATION: ImageGenerationResult = {
  imageUrls: ['data:image/png;base64,bW9jay1pbWFnZQ=='],
  parameters: { model: MODEL, prompt: 'Mock poster' },
  generatedAt: '2026-11-07T00:00:00.000Z',
  processingTimeMs: 1,
  via: 'compatible',
  metadata: {
    prompt: 'Mock poster',
    model: MODEL,
    endpointId: 'mock-generate',
    dimensions: [{ width: 1024, height: 576 }],
    file_sizes: [10],
    cost: micros(100_000),
    usedOwnKey: false,
    configuredPricing: {
      priceCardId: 'generate',
      unitPriceUsd: 0.1,
      imageCount: 1,
      requestedCount: 1,
    },
  },
};
const INTERRUPTIONS = [
  'Aborting engine: Grace period complete',
  'Durable Object reset because its code was updated',
];

// Mock durable checkpoints, credentials, wallet and generation; no supplier or database is contacted.
function makeStep(
  checkpoints = new Map<string, unknown>(),
  interruptions: ReadonlyMap<string, unknown> = new Map()
) {
  const doStep = vi.fn(
    async (
      name: string,
      options: object | (() => Promise<unknown>),
      callback?: () => Promise<unknown>
    ) => {
      if (interruptions.has(name)) throw interruptions.get(name);
      if (checkpoints.has(name)) return structuredClone(checkpoints.get(name));
      const execute = typeof options === 'function' ? options : callback;
      if (!execute) throw new Error('Missing Mock step callback.');
      const result = await execute();
      checkpoints.set(name, structuredClone(result));
      return result;
    }
  );
  return { step: asStub<WorkflowStep>({ do: doStep }), checkpoints, doStep };
}

function makeScope() {
  const attempts = {
    getById: vi.fn(async () => undefined),
    claim: vi.fn(async () => ({ claimed: true })),
    complete: vi.fn(async () => {}),
    markUnknown: vi.fn(async () => {}),
  };
  const scopedDb = asStub<WorkflowScopedDb>({
    models: {
      ...DEFAULT_MODEL_CONFIGURATION,
      poster: MODEL,
      imageModelRouting: createImageModelRoutingSnapshot(
        imageConfigurationFixture()
      ),
    },
    credentials: {},
    claims: { imageGenerationAttempts: attempts },
    imageGenerationAttempts: attempts,
    liveRead: { billing: { hasEnoughCredits: vi.fn(async () => true) } },
  });
  return { scopedDb, attempts };
}

function posterInput(step: WorkflowStep, scopedDb: WorkflowScopedDb) {
  return {
    step,
    scopedDb,
    workflowRunId: 'mock-poster-run',
    organizationId: 'mock-org',
    sequenceId: 'mock-sequence',
    prompt: 'Mock poster',
    aspectRatio: '16:9' as const,
    reservationId: 'mock-reservation',
  };
}

beforeEach(() => {
  generateImage.mockReset().mockResolvedValue(GENERATION);
  uploadPoster.mockReset().mockResolvedValue(STORED);
});

it.each(INTERRUPTIONS)(
  'propagates the step-boundary interruption: %s',
  async (message) => {
    const abort = new Error(message);
    const run = makeStep(new Map(), new Map([['generate-poster', abort]]));
    const { scopedDb, attempts } = makeScope();

    await expect(
      generateConfiguredPoster(posterInput(run.step, scopedDb))
    ).rejects.toBe(abort);

    expect(generateImage).not.toHaveBeenCalled();
    expect(attempts.complete).not.toHaveBeenCalled();
  }
);

it('propagates an interruption during generation without marking the attempt unknown', async () => {
  const abort = new Error(INTERRUPTIONS[0]);
  generateImage.mockRejectedValueOnce(abort);
  const run = makeStep();
  const { scopedDb, attempts } = makeScope();

  await expect(
    generateConfiguredPoster(posterInput(run.step, scopedDb))
  ).rejects.toBe(abort);

  expect(attempts.claim).toHaveBeenCalledOnce();
  expect(attempts.markUnknown).not.toHaveBeenCalled();
  expect(uploadPoster).not.toHaveBeenCalled();
});

it('resumes the stored checkpoint after an interrupted metadata write without generating again', async () => {
  const abort = new Error(INTERRUPTIONS[1]);
  const run = makeStep();
  const { scopedDb, attempts } = makeScope();
  attempts.complete.mockRejectedValueOnce(abort);
  const input = posterInput(run.step, scopedDb);

  await expect(generateConfiguredPoster(input)).rejects.toBe(abort);
  await expect(generateConfiguredPoster(input)).resolves.toEqual({
    url: STORED.url,
    metadata: GENERATION.metadata,
  });

  expect(generateImage).toHaveBeenCalledOnce();
  expect(uploadPoster).toHaveBeenCalledOnce();
  expect(attempts.complete).toHaveBeenCalledTimes(2);
  expect(attempts.markUnknown).not.toHaveBeenCalled();
});

it('preserves the configured generate-poster checkpoint format and replays it unchanged', async () => {
  const checkpoint = {
    stored: [STORED],
    metadata: GENERATION.metadata,
    via: GENERATION.via,
  };
  const run = makeStep(
    new Map<string, unknown>([['generate-poster', checkpoint]])
  );
  const { scopedDb, attempts } = makeScope();
  const input = posterInput(run.step, scopedDb);

  await expect(generateConfiguredPoster(input)).resolves.toEqual({
    url: STORED.url,
    metadata: GENERATION.metadata,
  });
  await expect(generateConfiguredPoster(input)).resolves.toEqual({
    url: STORED.url,
    metadata: GENERATION.metadata,
  });

  expect(run.checkpoints.get('generate-poster')).toEqual(checkpoint);
  expect(attempts.complete).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: 'mock-poster-run:generate-poster' }),
    checkpoint
  );
  expect(generateImage).not.toHaveBeenCalled();
  expect(uploadPoster).not.toHaveBeenCalled();
  expect(attempts.claim).not.toHaveBeenCalled();
});

it.each(['generation', 'storage'] as const)(
  'keeps an ordinary %s failure non-critical',
  async (failure) => {
    const unavailable = new Error('Mock image service unavailable');
    if (failure === 'generation')
      generateImage.mockRejectedValueOnce(unavailable);
    else uploadPoster.mockRejectedValueOnce(unavailable);
    const run = makeStep();
    const { scopedDb, attempts } = makeScope();

    await expect(
      generateConfiguredPoster(posterInput(run.step, scopedDb))
    ).resolves.toBeNull();

    expect(attempts.markUnknown).toHaveBeenCalledOnce();
    expect(attempts.complete).not.toHaveBeenCalled();
  }
);
