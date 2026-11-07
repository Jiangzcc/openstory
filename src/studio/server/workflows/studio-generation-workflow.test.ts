/**
 * Step sequence and money path of StudioGenerationWorkflow (#1274).
 *
 * Pins the step names (replay dedup keys), deduct-before-upload ordering,
 * the own-key skip, the content-flag retry loop and the failure hook.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micros } from '@/billing/money';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StudioRunInput } from '@/studio/schema';
import type { StudioGenerationWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { CompatibleImageError } from '@/stills/server/compatible-image-error';

const mockGenerateImageWithProvider = vi.fn();
const mockDeductWorkflowCredits = vi.fn();
const mockRecordProvenance = vi.fn();
const mockSubmit = vi.fn();
const mockPoll = vi.fn();
const mockCost = vi.fn();
const mockRecordMediaGenerationSpan = vi.fn();
const mockResolveMotionVia = vi.fn(
  async (): Promise<'fal' | 'google' | 'byteplus'> => 'fal'
);
const mockIngestArkAssets = vi.fn(
  async (_step: unknown, _args: { owner: string }) => ({})
);

vi.doMock('@/stills/server/image-generation', () => ({
  generateImageWithProvider: mockGenerateImageWithProvider,
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: mockDeductWorkflowCredits,
  recordFalUsageStep: vi.fn(async () => ({})),
}));
vi.doMock('@/platform/server/compliance/provenance', () => ({
  recordProvenance: mockRecordProvenance,
}));
vi.doMock('@/studio/server/upload', () => ({
  uploadStudioImage: vi.fn(async () => ({
    url: '/r2/thumbnails/a.png',
    path: 'a.png',
    contentType: 'image/png',
  })),
  uploadStudioVideo: vi.fn(async () => ({
    url: '/r2/videos/a.mp4',
    path: 'a.mp4',
    contentType: 'video/mp4',
  })),
}));
vi.doMock('@/studio/server/studio-video-generation', () => ({
  submitStudioVideoJob: mockSubmit,
  pollStudioVideoJob: mockPoll,
  studioVideoCostFromUsage: mockCost,
  arkStillsForStudio: () => [],
}));
vi.doMock('@/models/server/byteplus-asset-steps', () => ({
  ingestArkAssets: mockIngestArkAssets,
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  recordMediaGenerationSpan: mockRecordMediaGenerationSpan,
}));
vi.doMock('@/motion/server/motion-generation', () => ({
  resolveMotionVia: mockResolveMotionVia,
}));
const mockCaptureStudioGenerationCompleted = vi.fn();
vi.doMock('@/platform/server/observability/content-feed', () => ({
  captureStudioGenerationCompleted: mockCaptureStudioGenerationCompleted,
}));

const { StudioGenerationWorkflow } =
  await import('./studio-generation-workflow');
const { uploadStudioImage } = await import('../upload');

class Probe extends StudioGenerationWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<StudioGenerationWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
  fail(
    event: Readonly<WorkflowEvent<StudioGenerationWorkflowInput>>,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error: 'boom', scopedDb });
  }
}

function makeWorkflow(): Probe {
  type Ctor = ConstructorParameters<typeof Probe>;
  // runImpl never reads ctx
  const ctx = asStub<Ctor[0]>(undefined);
  // runImpl never reads bindings
  const env = asStub<Ctor[1]>({});
  return new Probe(ctx, env);
}

function makeStep(cachedResults: ReadonlyMap<string, unknown> = new Map()) {
  const names: string[] = [];
  const doStep = vi.fn(
    (
      name: string,
      ...args: [() => Promise<unknown>] | [object, () => Promise<unknown>]
    ) => {
      names.push(name);
      if (cachedResults.has(name))
        return Promise.resolve(cachedResults.get(name));
      const fn = args.length === 1 ? args[0] : args[1];
      return fn();
    }
  );
  // Mock both step overloads while keeping the spy callable without `this`.
  const step = asStub<WorkflowStep>({
    do: doStep,
    sleep: vi.fn(async () => {}),
  });
  return Object.assign(step, { names, doStep });
}

function makeScopedDb() {
  const generatedAssets = {
    markRunning: vi.fn(async () => {}),
    markCompleted: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  };
  const bytePlusAssets = {
    releaseOwner: vi.fn(async (_owner: string) => {}),
  };
  // stub covering only the surface runImpl touches
  const scopedDb = asStub<WorkflowScopedDb>({
    generatedAssets,
    bytePlusAssets,
    models: { imageModelRouting: [] },
    provenance: {},
    credentials: {},
  });
  return { scopedDb, generatedAssets, bytePlusAssets };
}

function makeConfiguredImageScope() {
  const scope = makeScopedDb();
  const imageModelRouting = createImageModelRoutingSnapshot(
    imageConfigurationFixture()
  );
  // Mock attempt and wallet surfaces; no database or supplier is contacted.
  const attempts = {
    getById: vi.fn(async () => undefined),
    claim: vi.fn(async () => ({ claimed: true })),
    complete: vi.fn(async () => {}),
    markUnknown: vi.fn(async () => {}),
  };
  return {
    ...scope,
    attempts,
    scopedDb: asStub<WorkflowScopedDb>({
      ...scope.scopedDb,
      models: { imageModelRouting },
      liveRead: { billing: { hasEnoughCredits: vi.fn(async () => true) } },
      imageGenerationAttempts: attempts,
      claims: { imageGenerationAttempts: attempts },
    }),
  };
}

function configuredImageResult() {
  return {
    imageUrls: ['https://example.com/mock.png'],
    via: 'compatible',
    metadata: {
      prompt: 'Mock image',
      model: 'custom-image:qwen',
      endpointId: 'mock-generate',
      dimensions: [{ width: 1024, height: 576 }],
      file_sizes: [16],
      cost: micros(100_000),
      usedOwnKey: false,
    },
  };
}

const IMAGE: StudioRunInput = {
  activity: 'image',
  prompt: 'a red fox',
  imageModel: 'gpt_image_2',
  aspectRatio: '16:9',
  resolution: '720p' as const,
  count: 1,
  referenceImages: [],
};

const VIDEO: StudioRunInput = {
  activity: 'video',
  prompt: 'the fox turns',
  videoModel: 'seedance_v2',
  aspectRatio: '16:9',
  resolution: '720p' as const,
  duration: 5,
  count: 1,
  mode: 'text',
  referenceImages: [],
  referenceVideos: [],
  referenceAudio: [],
};

function makeEvent(
  input: StudioRunInput,
  extra: Partial<StudioGenerationWorkflowInput> = {}
): Readonly<WorkflowEvent<StudioGenerationWorkflowInput>> {
  return {
    payload: {
      userId: 'u1',
      organizationId: 'organization-1',
      assetId: 'asset-1',
      reservationId: 'res-studio-1',
      ownsReservation: true,
      input,
      noPersonImages: [],
      ...extra,
    },
    instanceId: 'run-1',
    workflowName: 'studio',
    timestamp: new Date(0),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateImageWithProvider.mockResolvedValue({
    imageUrls: ['https://fal.media/a.png'],
    via: 'fal',
    metadata: { cost: micros(12_000), usedOwnKey: false, endpointId: 'e' },
  });
  mockRecordProvenance.mockResolvedValue(undefined);
  mockSubmit.mockResolvedValue({
    jobId: 'job-1',
    modelKey: 'seedance_v2',
    endpointId: 'bytedance/seedance-2.0/enterprise/v2/text-to-video',
    via: 'fal',
    usedOwnKey: false,
  });
  mockPoll.mockResolvedValue({
    status: 'completed',
    url: 'https://fal.media/a.mp4',
  });
  mockCost.mockResolvedValue({
    endpointId: 'bytedance/seedance-2.0/enterprise/v2/text-to-video',
    cost: micros(70_000),
    recordFalUsage: false,
  });
});

describe('StudioGenerationWorkflow image', () => {
  it('stores inside the generate step and persists last', async () => {
    const step = makeStep();
    const { scopedDb, generatedAssets } = makeScopedDb();

    await makeWorkflow().runBody(makeEvent(IMAGE), step, scopedDb);

    expect(step.names).toEqual([
      'set-running',
      // The upload rides `generate-image`: an inline-bytes result has no URL
      // to hand to a separate step, and the image would ride the 1 MiB
      // checkpoint between them (#1645).
      'generate-image',
      'deduct-credits',
      'record-provenance',
      'persist-result',
      'notify-content-feed',
    ]);
    expect(mockDeductWorkflowCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        costMicros: 12_000,
        idempotencyKey: 'run-1:studio-image',
        reservationId: 'res-studio-1',
      })
    );
    expect(generatedAssets.markCompleted).toHaveBeenCalledWith('asset-1', {
      outputs: [{ url: '/r2/thumbnails/a.png', contentType: 'image/png' }],
      costMicros: 12_000,
      provider: 'fal',
    });
    expect(mockCaptureStudioGenerationCompleted).toHaveBeenCalledWith({
      distinctId: 'u1',
      organizationId: 'organization-1',
      assetId: 'asset-1',
      activity: 'image',
      model: 'gpt_image_2',
      mediaUrl: '/r2/thumbnails/a.png',
      contentType: 'image/png',
      prompt: 'a red fox',
      aspectRatio: '16:9',
    });
  });

  it('skips deduction on the organization key but still records the cost', async () => {
    mockGenerateImageWithProvider.mockResolvedValue({
      imageUrls: ['https://fal.media/a.png'],
      via: 'fal',
      metadata: { cost: micros(12_000), usedOwnKey: true, endpointId: 'e' },
    });
    const step = makeStep();
    const { scopedDb, generatedAssets } = makeScopedDb();

    await makeWorkflow().runBody(makeEvent(IMAGE), step, scopedDb);

    expect(step.names).not.toContain('deduct-credits');
    expect(mockDeductWorkflowCredits).not.toHaveBeenCalled();
    expect(generatedAssets.markCompleted).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({ costMicros: 12_000 })
    );
  });
});

it('configured images use a 15-minute generate/store step and charge after storage', async () => {
  const step = makeStep();
  const { scopedDb, generatedAssets, attempts } = makeConfiguredImageScope();
  mockGenerateImageWithProvider.mockResolvedValue(configuredImageResult());
  const input = { ...IMAGE, imageModel: 'custom-image:qwen' as const };

  await makeWorkflow().runBody(makeEvent(input), step, scopedDb);

  expect(step.doStep).toHaveBeenCalledWith(
    'generate-image',
    { retries: { limit: 0, delay: '1 second' }, timeout: '15 minutes' },
    expect.any(Function)
  );
  expect(step.names).toEqual([
    'set-running',
    'generate-image',
    'generate-image:record',
    'deduct-credits',
    'record-provenance',
    'persist-result',
    'notify-content-feed',
  ]);
  expect(vi.mocked(uploadStudioImage)).toHaveBeenCalledBefore(
    attempts.complete
  );
  expect(attempts.complete).toHaveBeenCalledBefore(mockDeductWorkflowCredits);
  expect(mockDeductWorkflowCredits).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      costMicros: 100_000,
      idempotencyKey: 'run-1:studio-image',
      reservationId: 'res-studio-1',
    })
  );
  expect(generatedAssets.markCompleted).toHaveBeenCalledWith(
    'asset-1',
    expect.objectContaining({ provider: 'compatible', costMicros: 100_000 })
  );
  expect(attempts.markUnknown).not.toHaveBeenCalled();
});

it.each(['upload', 'uploads'] as const)(
  'restores a cached %s result without generating or uploading again',
  async (field) => {
    const upload = {
      url: '/r2/thumbnails/mock-cached.png',
      path: 'mock-cached.png',
      contentType: 'image/png',
    };
    const metadata = {
      cost: micros(12_000),
      usedOwnKey: false,
      endpointId: 'mock-native-image',
    };
    const checkpoint = {
      [field]: field === 'upload' ? upload : [upload],
      metadata,
      via: 'fal',
    };
    const step = makeStep(
      new Map<string, unknown>([
        ['generate-image', checkpoint],
        ['deduct-credits', undefined],
      ])
    );
    const { scopedDb, generatedAssets } = makeScopedDb();

    const result = await makeWorkflow().runBody(
      makeEvent(IMAGE),
      step,
      scopedDb
    );

    expect(result.outputs).toEqual([
      { url: upload.url, contentType: upload.contentType },
    ]);
    expect(generatedAssets.markCompleted).toHaveBeenCalledWith('asset-1', {
      outputs: result.outputs,
      costMicros: metadata.cost,
      provider: 'fal',
    });
    expect(mockGenerateImageWithProvider).not.toHaveBeenCalled();
    expect(uploadStudioImage).not.toHaveBeenCalled();
    expect(mockDeductWorkflowCredits).not.toHaveBeenCalled();
  }
);

it('restores the configured stored checkpoint and retries only metadata persistence', async () => {
  const generation = configuredImageResult();
  const stored = [
    {
      url: '/r2/thumbnails/mock-configured.png',
      path: 'mock-configured.png',
      contentType: 'image/png',
    },
  ];
  const checkpoint = {
    stored,
    metadata: generation.metadata,
    via: generation.via,
  };
  const step = makeStep(
    new Map<string, unknown>([['generate-image', checkpoint]])
  );
  const { scopedDb, attempts, generatedAssets } = makeConfiguredImageScope();
  const input = { ...IMAGE, imageModel: 'custom-image:qwen' as const };

  const result = await makeWorkflow().runBody(makeEvent(input), step, scopedDb);

  expect(result.outputs).toEqual(
    stored.map(({ url, contentType }) => ({ url, contentType }))
  );
  expect(attempts.complete).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: 'run-1:generate-image' }),
    checkpoint
  );
  expect(generatedAssets.markCompleted).toHaveBeenCalledWith('asset-1', {
    outputs: result.outputs,
    costMicros: generation.metadata.cost,
    provider: 'compatible',
  });
  expect(mockGenerateImageWithProvider).not.toHaveBeenCalled();
  expect(uploadStudioImage).not.toHaveBeenCalled();
  expect(attempts.claim).not.toHaveBeenCalled();
  expect(attempts.markUnknown).not.toHaveBeenCalled();
});

it('configured image deadlines remain unknown without charging or persisting output', async () => {
  const step = makeStep();
  const { scopedDb, generatedAssets, attempts } = makeConfiguredImageScope();
  mockGenerateImageWithProvider.mockRejectedValueOnce(
    new CompatibleImageError('request_timeout')
  );
  const input = { ...IMAGE, imageModel: 'custom-image:qwen' as const };

  await expect(
    makeWorkflow().runBody(makeEvent(input), step, scopedDb)
  ).rejects.toThrow('Compatible image provider request timed out.');

  expect(attempts.markUnknown).toHaveBeenCalledOnce();
  expect(attempts.complete).not.toHaveBeenCalled();
  expect(mockGenerateImageWithProvider).toHaveBeenCalledOnce();
  expect(uploadStudioImage).not.toHaveBeenCalled();
  expect(mockDeductWorkflowCredits).not.toHaveBeenCalled();
  expect(generatedAssets.markCompleted).not.toHaveBeenCalled();
});

describe('StudioGenerationWorkflow video', () => {
  it('resubmits on a content flag, then bills and persists', async () => {
    mockSubmit
      .mockRejectedValueOnce(new Error('flagged by a content checker'))
      .mockRejectedValueOnce(new Error('flagged by a content checker'));
    const step = makeStep();
    const { scopedDb, generatedAssets, bytePlusAssets } = makeScopedDb();

    await makeWorkflow().runBody(makeEvent(VIDEO), step, scopedDb);

    expect(step.names).toEqual([
      'set-running',
      // The via is resolved per attempt so the stills are registered with
      // BytePlus before submit only when the model is going there (#1519).
      'resolve-video-via',
      'submit-video',
      'resolve-video-via-retry-1',
      'submit-video-retry-1',
      'resolve-video-via-retry-2',
      'submit-video-retry-2',
      'video-poll-batch-2-0',
      // Unpins every still the run leased on Ark, whatever via won (#1531).
      'release-byteplus-asset-leases',
      'price-video-generation',
      'upload-video',
      // Billed only once the clip is stored.
      'deduct-video-credits',
      'record-video-observation',
      'record-provenance',
      'persist-result',
      'notify-content-feed',
    ]);
    expect(bytePlusAssets.releaseOwner).toHaveBeenCalledWith('studio:run-1');
    expect(mockDeductWorkflowCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        costMicros: 70_000,
        reservationId: 'res-studio-1',
      })
    );
    expect(generatedAssets.markCompleted).toHaveBeenCalledWith('asset-1', {
      outputs: [{ url: '/r2/videos/a.mp4', contentType: 'video/mp4' }],
      costMicros: 70_000,
      provider: 'fal',
    });
    expect(mockCaptureStudioGenerationCompleted).toHaveBeenCalledWith({
      distinctId: 'u1',
      organizationId: 'organization-1',
      assetId: 'asset-1',
      activity: 'video',
      model: 'seedance_v2',
      mediaUrl: '/r2/videos/a.mp4',
      contentType: 'video/mp4',
      prompt: 'the fox turns',
      aspectRatio: '16:9',
      duration: 5,
    });
    expect(mockRecordMediaGenerationSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fal',
        activity: 'video',
        observationName: 'studio-video',
        costMicros: 70_000,
      })
    );
  });

  it('leases stills under the same owner it releases', async () => {
    mockResolveMotionVia.mockResolvedValueOnce('byteplus');
    const { scopedDb, bytePlusAssets } = makeScopedDb();

    await makeWorkflow().runBody(makeEvent(VIDEO), makeStep(), scopedDb);

    const owner = mockIngestArkAssets.mock.calls[0]?.[1].owner;
    expect(owner).toBe('studio:run-1');
    expect(bytePlusAssets.releaseOwner).toHaveBeenCalledWith(owner);
  });

  it('a release that never lands does not fail a rendered clip', async () => {
    const { scopedDb, generatedAssets, bytePlusAssets } = makeScopedDb();
    bytePlusAssets.releaseOwner.mockRejectedValueOnce(new Error('D1 down'));

    await makeWorkflow().runBody(makeEvent(VIDEO), makeStep(), scopedDb);

    expect(generatedAssets.markCompleted).toHaveBeenCalled();
  });

  it('resubmits when Ark refuses its own output audio at poll (#1680)', async () => {
    mockPoll.mockResolvedValueOnce({
      status: 'failed',
      error:
        'AudioSensitiveContentDetected.PolicyViolation: The request failed because the output audio may be related to copyright restrictions. Request id: 0217',
    });
    const step = makeStep();
    const { scopedDb, generatedAssets } = makeScopedDb();

    await makeWorkflow().runBody(makeEvent(VIDEO), step, scopedDb);

    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(step.names).toContain('submit-video-retry-1');
    expect(generatedAssets.markFailed).not.toHaveBeenCalled();
  });

  it('resubmits once when Ark reports InternalServiceError (#2036)', async () => {
    mockSubmit.mockResolvedValue({
      jobId: 'job-1',
      modelKey: 'seedance_v2_5',
      endpointId: 'dreamina-seedance-2-5-260628',
      via: 'byteplus',
      usedOwnKey: false,
    });
    mockPoll
      .mockResolvedValueOnce({
        status: 'failed',
        error: 'InternalServiceError: please retry',
      })
      .mockResolvedValueOnce({
        status: 'completed',
        url: 'https://fal.media/a.mp4',
      });
    const step = makeStep();
    const { scopedDb, generatedAssets } = makeScopedDb();

    await makeWorkflow().runBody(
      makeEvent({ ...VIDEO, videoModel: 'seedance_v2_5' }),
      step,
      scopedDb
    );

    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(step.sleep).toHaveBeenCalledWith(
      'seedance-internal-backoff',
      '5 seconds'
    );
    expect(step.names).toContain('submit-video-internal');
    expect(generatedAssets.markFailed).not.toHaveBeenCalled();
  });

  it('says nothing was charged when the retry also fails (#2036)', async () => {
    mockSubmit.mockResolvedValue({
      jobId: 'job-1',
      modelKey: 'seedance_v2_5',
      endpointId: 'dreamina-seedance-2-5-260628',
      via: 'byteplus',
      usedOwnKey: false,
    });
    mockPoll.mockResolvedValue({
      status: 'failed',
      error: 'InternalServiceError: still down',
    });
    const { scopedDb } = makeScopedDb();

    await expect(
      makeWorkflow().runBody(
        makeEvent({ ...VIDEO, videoModel: 'seedance_v2_5' }),
        makeStep(),
        scopedDb
      )
    ).rejects.toThrow(/temporary error.*not charged/);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
  });

  it('stops at once on a TaskTypeConstraint, with no second job (#2036)', async () => {
    mockResolveMotionVia.mockResolvedValueOnce('byteplus');
    mockSubmit.mockRejectedValue(
      new Error(
        'BytePlus Ark studio motion submit failed (400 InvalidParameter.TaskTypeConstraint): duration must be -1'
      )
    );
    const { scopedDb } = makeScopedDb();

    await expect(
      makeWorkflow().runBody(makeEvent(VIDEO), makeStep(), scopedDb)
    ).rejects.toThrow(/read this as a video edit.*not charged/);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockPoll).not.toHaveBeenCalled();
  });

  it('does not retry a different InvalidParameter (#2036)', async () => {
    mockResolveMotionVia.mockResolvedValueOnce('byteplus');
    mockSubmit.mockRejectedValue(
      new Error(
        'BytePlus Ark studio motion submit failed (400 InvalidParameter): bad ratio'
      )
    );
    const { scopedDb } = makeScopedDb();

    await expect(
      makeWorkflow().runBody(makeEvent(VIDEO), makeStep(), scopedDb)
    ).rejects.toThrow(/couldn't process this video/);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('gives up after three content flags without billing', async () => {
    mockSubmit.mockRejectedValue(new Error('flagged by a content checker'));
    const { scopedDb } = makeScopedDb();

    await expect(
      makeWorkflow().runBody(makeEvent(VIDEO), makeStep(), scopedDb)
    ).rejects.toThrow(
      /^Content checker rejected the clip \(Seedance 2\.0\)\. Rewrite the prompt\. \(/
    );
    expect(mockDeductWorkflowCredits).not.toHaveBeenCalled();
    expect(mockCaptureStudioGenerationCompleted).not.toHaveBeenCalled();
  });

  it('names a flagged reference image instead of a still that does not exist (#1373)', async () => {
    mockSubmit.mockRejectedValue(
      new Error('body.image_urls.0: flagged by a content checker')
    );
    const { scopedDb } = makeScopedDb();

    await expect(
      makeWorkflow().runBody(
        makeEvent({ ...VIDEO, referenceImages: ['https://x/ref.png'] }),
        makeStep(),
        scopedDb
      )
    ).rejects.toThrow(
      'Content checker rejected a reference image (Seedance 2.0). Swap the reference image.'
    );
  });
});

describe('StudioGenerationWorkflow onFailure', () => {
  it('flips the reserved row to failed', async () => {
    const { scopedDb, generatedAssets } = makeScopedDb();
    await makeWorkflow().fail(makeEvent(IMAGE), scopedDb);
    // An image run only learns its via from the generate result.
    expect(generatedAssets.markFailed).toHaveBeenCalledWith(
      'asset-1',
      'boom',
      undefined
    );
    // Image failures are recorded inside generateImageWithProvider.
    expect(mockRecordMediaGenerationSpan).not.toHaveBeenCalled();
  });

  it('unpins the ACR stills a failed video run leased (#1531)', async () => {
    const { scopedDb, bytePlusAssets } = makeScopedDb();
    await makeWorkflow().fail(makeEvent(VIDEO), scopedDb);
    expect(bytePlusAssets.releaseOwner).toHaveBeenCalledWith('studio:run-1');
  });

  it('a failed release throws after marking the row, so emit-failure retries it', async () => {
    const { scopedDb, generatedAssets, bytePlusAssets } = makeScopedDb();
    bytePlusAssets.releaseOwner.mockRejectedValueOnce(new Error('D1 down'));

    await expect(
      makeWorkflow().fail(makeEvent(VIDEO), scopedDb)
    ).rejects.toThrow('D1 down');
    expect(generatedAssets.markFailed).toHaveBeenCalledWith(
      'asset-1',
      'boom',
      'fal'
    );
  });

  it('records a video failure span on the resolved via', async () => {
    mockResolveMotionVia.mockResolvedValueOnce('google');
    const { scopedDb, generatedAssets } = makeScopedDb();
    await makeWorkflow().fail(
      makeEvent({ ...VIDEO, videoModel: 'gemini_omni_flash' }),
      scopedDb
    );
    // The failed row is labelled with the via too, not left as fal (#1681).
    expect(generatedAssets.markFailed).toHaveBeenCalledWith(
      'asset-1',
      'boom',
      'google'
    );
    expect(mockRecordMediaGenerationSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini_omni_flash',
        provider: 'google',
        activity: 'video',
        observationName: 'studio-video',
      })
    );
  });
});
