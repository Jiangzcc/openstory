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
// Mock paid generation while retaining configured quotes.
vi.doMock(
  '@/stills/server/configured-image-generation',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/stills/server/configured-image-generation')
    >()),
    generateConfiguredImage: generateImage,
  })
);
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
  let active: string | undefined;
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
      active = name;
      try {
        const result = await execute();
        checkpoints.set(name, structuredClone(result));
        return result;
      } finally {
        active = undefined;
      }
    }
  );
  return {
    step: asStub<WorkflowStep>({ do: doStep }),
    checkpoints,
    doStep,
    active: () => active,
  };
}

function makeScope(creditsAvailable = true) {
  const scopedDb = asStub<WorkflowScopedDb>({
    models: {
      ...DEFAULT_MODEL_CONFIGURATION,
      poster: MODEL,
      imageModelRouting: createImageModelRoutingSnapshot(
        imageConfigurationFixture()
      ),
    },
    credentials: {},
    liveRead: {
      billing: { hasEnoughCredits: vi.fn(async () => creditsAvailable) },
    },
  });
  return { scopedDb };
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
    const { scopedDb } = makeScope();

    await expect(
      generateConfiguredPoster(posterInput(run.step, scopedDb))
    ).rejects.toBe(abort);

    expect(generateImage).not.toHaveBeenCalled();
    expect(uploadPoster).not.toHaveBeenCalled();
  }
);

it('propagates an interruption during generation without storing a poster', async () => {
  const abort = new Error(INTERRUPTIONS[0]);
  generateImage.mockRejectedValueOnce(abort);
  const run = makeStep();
  const { scopedDb } = makeScope();

  await expect(
    generateConfiguredPoster(posterInput(run.step, scopedDb))
  ).rejects.toBe(abort);

  expect(generateImage).toHaveBeenCalledOnce();
  expect(run.checkpoints.has('generate-poster')).toBe(false);
  expect(uploadPoster).not.toHaveBeenCalled();
});

it('propagates an interruption during storage without checkpointing an output', async () => {
  const abort = new Error(INTERRUPTIONS[1]);
  const run = makeStep();
  const { scopedDb } = makeScope();
  uploadPoster.mockRejectedValueOnce(abort);
  const input = posterInput(run.step, scopedDb);

  await expect(generateConfiguredPoster(input)).rejects.toBe(abort);

  expect(generateImage).toHaveBeenCalledOnce();
  expect(uploadPoster).toHaveBeenCalledOnce();
  expect(run.checkpoints.has('generate-poster')).toBe(false);
});

it('stores the poster inside generation and replays its completed checkpoint unchanged', async () => {
  const run = makeStep();
  const { scopedDb } = makeScope();
  const input = posterInput(run.step, scopedDb);
  generateImage.mockImplementationOnce(async () => {
    expect(run.active()).toBe('generate-poster');
    return GENERATION;
  });
  uploadPoster.mockImplementationOnce(async () => {
    expect(run.active()).toBe('generate-poster');
    return STORED;
  });

  await expect(generateConfiguredPoster(input)).resolves.toEqual({
    url: STORED.url,
    metadata: GENERATION.metadata,
  });
  const checkpoint = run.checkpoints.get('generate-poster');
  expect(checkpoint).toEqual({
    stored: [STORED],
    metadata: GENERATION.metadata,
    via: GENERATION.via,
  });
  await expect(generateConfiguredPoster(input)).resolves.toEqual({
    url: STORED.url,
    metadata: GENERATION.metadata,
  });

  expect(run.checkpoints.get('generate-poster')).toEqual(checkpoint);
  expect(generateImage).toHaveBeenCalledOnce();
  expect(uploadPoster).toHaveBeenCalledOnce();
  expect(JSON.stringify(checkpoint)).not.toContain('data:image');
});

it('does not generate or store a poster when the balance guard fails', async () => {
  const run = makeStep();
  const { scopedDb } = makeScope(false);

  await expect(
    generateConfiguredPoster(posterInput(run.step, scopedDb))
  ).resolves.toBeNull();

  expect(generateImage).not.toHaveBeenCalled();
  expect(uploadPoster).not.toHaveBeenCalled();
  expect(run.checkpoints.has('generate-poster')).toBe(false);
});

it.each(['generation', 'storage'] as const)(
  'keeps an ordinary %s failure non-critical',
  async (failure) => {
    const unavailable = new Error('Mock image service unavailable');
    if (failure === 'generation')
      generateImage.mockRejectedValueOnce(unavailable);
    else uploadPoster.mockRejectedValueOnce(unavailable);
    const run = makeStep();
    const { scopedDb } = makeScope();

    await expect(
      generateConfiguredPoster(posterInput(run.step, scopedDb))
    ).resolves.toBeNull();

    expect(generateImage).toHaveBeenCalledOnce();
    expect(uploadPoster).toHaveBeenCalledTimes(
      failure === 'generation' ? 0 : 1
    );
    expect(run.checkpoints.has('generate-poster')).toBe(false);
  }
);
