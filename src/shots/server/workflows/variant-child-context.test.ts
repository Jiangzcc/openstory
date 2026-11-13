import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
  type ModelRuntimeConfiguration,
  type WorkflowModelConfiguration,
} from '@/models/model-runtime-configuration';
import type { Locale } from '@/platform/i18n/locale';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  CloudflareEnv,
  ImageWorkflowInput,
  RegenerateShotsWorkflowInput,
  ShotImagesWorkflowInput,
  ShotVariantWorkflowInput,
  UpdateStaleShotsWorkflowInput,
} from '@/platform/server/workflow/types';
import { buildInstanceId } from '@/platform/server/workflow/instance-id';
import { shotVariantDedupId } from '@/platform/server/workflow/dedup-ids';
import {
  computeShotImageSceneHash,
  computeShotImagesHashFromDto,
} from '@/cast/server/workflows/sheet-snapshots';
import type { Scene } from '@/shots/scene-analysis.schema';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import type { prepareShotImageWorkflowInput } from '@/shots/server/shot-image-input';
import { asStub } from '@/test/as-stub';

const userId = '01K00000000000000000000001';
const organizationId = '01K00000000000000000000002';
const sequenceId = '01K00000000000000000000003';
const shotId = '01K00000000000000000000004';
const frameId = '01K00000000000000000000005';
const sceneId = 'scene-1';
const imageModel = 'nano_banana_2';
const imageUrl = '/r2/mock-primary.png';
const scenePrompt = 'Mock still: a quiet harbour.';
const sceneSnapshot = {
  sceneId,
  visualPrompt: scenePrompt,
  characterSheetHashes: [],
  locationSheetHashes: [],
  elementReferenceHashes: [],
};
// Same minimal Scene shape used by update-stale-plan.test.ts, with no cast.
const scene = asStub<Scene>({
  sceneId,
  metadata: { title: 'Mock harbour', location: 'Harbour' },
  originalScript: { extract: 'A quiet harbour.', dialogue: [] },
  continuity: { characterTags: [], characterLooks: {}, elementTags: [] },
});

const unexpectedConfigurationLoad = vi.fn(async () => {
  throw new Error('Unexpected current model configuration load');
});
const unexpectedComplianceLoad = vi.fn(async () => {
  throw new Error('Unexpected request-path compliance load');
});
const unexpectedDatabase = vi.fn(() => {
  throw new Error('Unexpected raw database access');
});
const emit = vi.fn(async () => {});
const listEnforcementFor = vi.fn<
  WorkflowScopedDb['liveRead']['compliance']['listEnforcementFor']
>(async () => []);
const spawnImage = vi.fn(async () => ({ imageUrl }));
const claimTargets = vi.fn(async () => ({
  claimsByShot: {
    [shotId]: {
      visualVersionId: null,
      motionVersionId: null,
      imageVariantId: '01K00000000000000000000006',
      specClaimId: null,
    },
  },
  skipped: [],
}));
const prepareImage = vi.fn(
  async ({
    promptLocale,
    userId: actorId,
    sequence,
    modelOverride,
  }: Parameters<
    typeof prepareShotImageWorkflowInput
  >[0]): Promise<ImageWorkflowInput> => ({
    promptLocale,
    userId: actorId,
    organizationId: sequence.organizationId,
    sequenceId: sequence.id,
    shotId,
    frameId,
    prompt: scenePrompt,
    variantOnly: false,
    model: modelOverride,
    aspectRatio: '16:9',
    promptVersionId: '01K00000000000000000000007',
    referenceImages: [],
    sceneSnapshot,
  })
);
let workflowEnv: CloudflareEnv;

vi.doMock('#env', () => ({ getEnv: () => workflowEnv }));
vi.doMock('#db-client', () => ({ getDb: unexpectedDatabase }));
vi.doMock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: unexpectedConfigurationLoad,
  loadComplianceRecords: unexpectedComplianceLoad,
}));
// Constructor-only adapter; probes explicitly supply the decoded parent snapshot.
vi.doMock('@/platform/server/workflow/base-workflow', async () => ({
  OpenStoryWorkflowEntrypoint: (await import('cloudflare:workers'))
    .WorkflowEntrypoint,
}));
// Only the preceding still render is stubbed; the variant root dispatch stays real.
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild: spawnImage,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
  getShotChannel: () => ({ emit }),
}));
vi.doMock('@/shots/server/scene-script', () => ({
  loadSceneContextBySequence: vi.fn(async () => new Map()),
  resolveSceneForShot: () => ({ scene, script: null }),
}));
vi.doMock('@/shots/server/shot-image-input', () => ({
  prepareShotImageWorkflowInput: prepareImage,
}));
vi.doMock('@/shots/server/update-stale-plan', async () => ({
  ...(await vi.importActual<typeof import('@/shots/server/update-stale-plan')>(
    '@/shots/server/update-stale-plan'
  )),
  claimTargets,
}));

const { triggerWorkflowRun } =
  await import('@/platform/server/workflow/client');
const { RegenerateShotsWorkflow } = await import('./regenerate-shots-workflow');
const { computeRegenerateShotsBatchHash } =
  await import('./regenerate-shots-snapshot');
const { UpdateStaleShotsWorkflow } =
  await import('./update-stale-shots-workflow');
const { ShotImagesWorkflow } =
  await import('@/stills/server/workflows/shot-images-workflow');

class RegenerateProbe extends RegenerateShotsWorkflow {
  runBody(
    event: WorkflowEvent<RegenerateShotsWorkflowInput>,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, db);
  }
}
class StaleProbe extends UpdateStaleShotsWorkflow {
  runBody(
    event: WorkflowEvent<UpdateStaleShotsWorkflowInput>,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, db);
  }
}
class ImagesProbe extends ShotImagesWorkflow {
  runBody(
    event: WorkflowEvent<ShotImagesWorkflowInput>,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, db);
  }
}

function capturedConfiguration(): WorkflowModelConfiguration {
  const images = imageConfigurationFixture();
  const model = images.models[0];
  if (!model) throw new Error('Missing mock image model');
  model.id = imageModel;
  const packed = packModelRuntimeConfiguration({
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultAnalysis: 'custom:variant-text',
    defaultImage: imageModel,
    imageModelRouting: createImageModelRoutingSnapshot(images),
    textModelRouting: [
      {
        modelId: 'custom:variant-text',
        name: 'Mock captured text route',
        channelId: 'mock-text-channel',
        credentialId: '01K00000000000000000000008',
        protocol: 'openai-responses',
        baseUrl: 'https://mock.invalid/v1',
        userAgent: 'MockParent/1',
        upstreamModel: 'mock-captured-text',
        vision: false,
        structuredOutput: true,
        tools: true,
        contextWindow: 32000,
        maxOutputTokens: 4000,
        inputPricePerMillion: 0.5,
        outputPricePerMillion: 1.5,
      },
    ],
  });
  // Simulate settings changing after the parent's durable payload was captured.
  const generateOperation = model.operations.generate;
  if (!generateOperation)
    throw new Error('Missing mock image generation binding');
  generateOperation.upstreamModel = 'mock-new-current-image';
  const card = model.priceCards[0];
  if (!card) throw new Error('Missing mock image price card');
  card.unitPriceUsd = 99;
  return structuredClone(packed);
}

type VariantPayload = ShotVariantWorkflowInput & {
  modelConfiguration: WorkflowModelConfiguration;
};
function bindingHarness() {
  const instances = new Map<string, VariantPayload>();
  const create = vi.fn(
    async ({ id, params }: { id: string; params: VariantPayload }) => {
      if (instances.has(id)) {
        throw new Error('(instance.already_exists) Instance already exists');
      }
      instances.set(id, structuredClone(params));
      return { id };
    }
  );
  const get = vi.fn(async (id: string) => {
    if (!instances.has(id))
      throw new Error('(instance.not_found) Instance does not exist');
    return { id, status: async () => ({ status: 'running' }) };
  });
  return { instances, create, get };
}

type Context = {
  parentInstanceId: string;
  payload: {
    userId: string;
    organizationId: string;
    sequenceId: string;
    promptLocale: Locale;
    modelConfiguration: WorkflowModelConfiguration;
    reservationId: string;
    ownsReservation: boolean;
  };
  models: ModelRuntimeConfiguration;
  db: WorkflowScopedDb;
  step: WorkflowStep;
};
function contextFor(promptLocale: Locale, parentInstanceId: string): Context {
  const packed = capturedConfiguration();
  const models = unpackModelRuntimeConfiguration(packed);
  return {
    parentInstanceId,
    payload: {
      promptLocale,
      userId,
      organizationId,
      sequenceId,
      modelConfiguration: packed,
      reservationId: '01K00000000000000000000009',
      ownsReservation: true,
    },
    models,
    // Explicit DB mock: the selected image claim and two existence guards only.
    db: asStub<WorkflowScopedDb>({
      models,
      stalenessPlanning: {},
      liveRead: {
        compliance: { listEnforcementFor },
        shots: { getById: vi.fn(async () => ({ id: shotId, sceneId })) },
        frames: {
          getAnchorByShot: vi.fn(async () => ({ id: frameId, shotId })),
        },
      },
    }),
    // Execute closures on every invocation to model an uncheckpointed step retry.
    step: asStub<WorkflowStep>({
      do: vi.fn(async (_name: string, ...args: unknown[]) => {
        const callback = args.at(-1);
        if (typeof callback !== 'function')
          throw new Error('Missing step callback');
        return callback();
      }),
    }),
  };
}
function eventFor<T>(payload: T, instanceId: string): WorkflowEvent<T> {
  return {
    payload,
    instanceId,
    workflowName: 'mock-parent',
    timestamp: new Date(0),
  };
}

async function runRegenerate(context: Context) {
  const snapshotInputHash = await computeShotImageSceneHash(
    sceneSnapshot,
    imageModel,
    '16:9'
  );
  const payload: RegenerateShotsWorkflowInput = {
    ...context.payload,
    shotIds: [shotId],
    triggerKind: 'character',
    triggerId: '01K00000000000000000000010',
    imageModel,
    aspectRatio: '16:9',
    resolution: '1080p',
    snapshotInputHash: '',
    shotSnapshots: [
      {
        shotId,
        frameId,
        imagePrompt: scenePrompt,
        characterRefs: [],
        locationRefs: [],
        characterSheetHashes: [],
        locationSheetHashes: [],
        elementReferenceHashes: [],
        snapshotInputHash,
      },
    ],
  };
  payload.snapshotInputHash = await computeRegenerateShotsBatchHash(payload);
  const workflow = new RegenerateProbe(asStub(undefined), workflowEnv);
  const result = await workflow.runBody(
    eventFor(payload, context.parentInstanceId),
    context.step,
    context.db
  );
  expect(result).toEqual({
    totalShots: 1,
    successCount: 1,
    failedShots: [],
    divergedShotIds: [],
  });
  return (
    'variant-image-' +
    shotId +
    '-' +
    imageModel +
    '-' +
    snapshotInputHash.slice(0, 16)
  );
}

async function runImagesResult(context: Context) {
  const payload = {
    ...context.payload,
    scenesWithVisualPrompts: [scene],
    charactersWithSheets: [],
    locationsWithSheets: [],
    elements: [],
    shotMapping: [{ analysisSceneId: sceneId, shotId, frameId }],
    imageModel,
    aspectRatio: '16:9',
    resolution: '1080p',
    sceneSnapshots: [sceneSnapshot],
  } satisfies ShotImagesWorkflowInput;
  const input = {
    ...payload,
    snapshotInputHash: await computeShotImagesHashFromDto(payload),
  };
  const workflow = new ImagesProbe(asStub(undefined), workflowEnv);
  return workflow.runBody(
    eventFor(input, context.parentInstanceId),
    context.step,
    context.db
  );
}

async function runImages(context: Context) {
  const result = await runImagesResult(context);
  expect(result).toEqual({ imageUrls: [imageUrl], frameVersionIds: [null] });
  return shotVariantDedupId(context.parentInstanceId, shotId, imageModel);
}
function stalePlan(): UpdateStalePlan {
  return {
    aspectRatio: '16:9',
    resolution: '1080p',
    sequence: {
      id: sequenceId,
      organizationId,
      title: 'Mock harbour',
      aspectRatio: '16:9',
      resolution: '1080p',
      imageModel,
      videoModel: 'seedance_v2_5',
      styleId: null,
      analysisModel: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
      generateStartFrames: true,
      draftMotion: false,
    },
    music: null,
    promptContext: {
      characterBible: [],
      locationBible: [],
      elementBible: [],
      styleConfig: {
        version: 2,
        look: {
          mood: 'quiet',
          artStyle: 'watercolour',
          lighting: 'soft light',
          colorPalette: ['silver', 'blue'],
          colorGrading: 'cool shadows',
        },
        motion: { camera: 'locked' },
        references: [],
      },
      analysisModelId: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
    },
    characterVoices: [],
    dialogueSpeech: null,
    renderRefs: { characters: [], locations: [], elements: [] },
    scenePrompts: {},
    sceneSpecs: {},
    references: null,
    skipped: [],
    targets: [
      {
        shotId,
        frameId,
        startingFrameImageUrl: '/r2/mock-prior.png',
        usesStartFrame: true,
        durationMs: null,
        standingImageVariantId: null,
        standingMotionVersionId: null,
        visualPromptVersionId: null,
        regenVisual: false,
        regenMotion: false,
        rewriteSpec: false,
        specVersionId: null,
        spec: null,
        specInputHash: null,
        visualWritten: false,
        motionWritten: false,
        regenImage: true,
        visualLiveHash: null,
        motionLiveHash: null,
        imageLiveHash: 'mock-image-hash',
        imageModel,
        regenVideo: false,
        createsVideo: false,
        staleVideoVersionId: null,
        referenceIds: [],
        imageReferenceCount: 0,
        attachSceneHeader: false,
        motionRender: {
          sceneId,
          renderSegmentId: null,
          packedScene: {},
          characterTags: [],
          audioClips: [],
          sceneTitle: 'Mock harbour',
          description: '',
          selectedModel: null,
          characterLooks: null,
        },
        regenDialogue: false,
        dialogue: { presence: false, lines: [] },
        dialogueContext: [],
      },
    ],
  };
}
async function runStale(context: Context) {
  const payload: UpdateStaleShotsWorkflowInput = {
    ...context.payload,
    freshRun: true,
    plan: stalePlan(),
  };
  const workflow = new StaleProbe(asStub(undefined), workflowEnv);
  const result = await workflow.runBody(
    eventFor(payload, context.parentInstanceId),
    context.step,
    context.db
  );
  expect(result).toMatchObject({
    totalShots: 1,
    images: 1,
    failures: [],
    skipped: [],
  });
  expect(prepareImage).toHaveBeenCalledWith(
    expect.objectContaining({
      promptLocale: context.payload.promptLocale,
      modelConfiguration: context.models,
    })
  );
  return shotVariantDedupId(context.parentInstanceId, shotId, imageModel);
}

const scenarios = [
  { name: 'RegenerateShotsWorkflow', run: runRegenerate },
  { name: 'UpdateStaleShotsWorkflow.spawnImageModel', run: runStale },
  { name: 'ShotImagesWorkflow.runImageJob', run: runImages },
];

beforeEach(() => {
  vi.clearAllMocks();
  spawnImage.mockReset();
  spawnImage.mockResolvedValue({ imageUrl });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected network request');
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe.each(scenarios)('$name direct variant root', ({ name, run }) => {
  it.each<Locale>(['zh-CN', 'en'])(
    'forwards the frozen parent context and reuses the root on replay (%s)',
    async (locale) => {
      const binding = bindingHarness();
      workflowEnv = asStub<CloudflareEnv>({
        VITE_APP_URL: 'https://variant.mock.invalid',
        E2E_TEST: 'false',
        SHOT_VARIANT_WORKFLOW: binding,
        IMAGE_WORKFLOW: {},
      });
      const context = contextFor(locale, 'mock-parent-' + name);
      const parentBefore = structuredClone(context.payload);
      const deduplicationId = await run(context);
      const expectedId = buildInstanceId({
        env: workflowEnv,
        workflowName: 'variant-image',
        suffix: deduplicationId,
      });
      expect(binding.create).toHaveBeenCalledTimes(1);
      expect(binding.instances.size).toBe(1);
      const first = binding.instances.get(expectedId);
      if (!first)
        throw new Error('Variant root did not reach the expected binding');
      const firstSnapshot = structuredClone(first);
      expect(first).toMatchObject({
        userId,
        organizationId,
        promptLocale: locale,
        sequenceId,
        shotId,
        frameId,
        thumbnailUrl: imageUrl,
        scenePrompt,
        model: imageModel,
      });
      expect(first.modelConfiguration).toEqual(
        context.payload.modelConfiguration
      );
      const decoded = unpackModelRuntimeConfiguration(first.modelConfiguration);
      expect(decoded).toEqual(context.models);
      expect(decoded.imageModelRouting?.[0]).toMatchObject({
        operations: { generate: { upstreamModel: 'mock-generate' } },
        priceCards: [{ unitPriceUsd: 0.1 }, { unitPriceUsd: 0.2 }],
      });
      expect(first.modelConfiguration.imageModelRouting).toMatchObject({
        version: 2,
        channels: [
          expect.objectContaining({
            credentialId: '01K00000000000000000000000',
          }),
        ],
        models: [expect.objectContaining({ modelId: imageModel })],
      });
      expect(first.modelConfiguration.textModelRouting).toMatchObject({
        version: 1,
        channels: [expect.objectContaining({ userAgent: 'MockParent/1' })],
        models: [
          expect.objectContaining({ upstreamModel: 'mock-captured-text' }),
        ],
      });
      expect(first).not.toHaveProperty('reservationId');
      expect(first).not.toHaveProperty('ownsReservation');
      expect(first).not.toHaveProperty('_parent');

      expect(await run(context)).toBe(deduplicationId);
      expect(binding.create).toHaveBeenCalledTimes(2);
      expect(binding.create.mock.calls[1]?.[0].id).toBe(expectedId);
      expect(binding.get).toHaveBeenCalledWith(expectedId);
      expect(binding.instances.size).toBe(1);
      expect(binding.instances.get(expectedId)).toEqual(firstSnapshot);
      expect(context.payload).toEqual(parentBefore);

      const changedConfiguration = {
        ...context.models,
        defaultImage: 'gpt_image_2',
      } satisfies ModelRuntimeConfiguration;
      const conflicting = await triggerWorkflowRun(
        '/variant-image',
        {
          ...first,
          promptLocale: locale === 'zh-CN' ? 'en' : 'zh-CN',
          scenePrompt: 'Mock later request with another language.',
        },
        {
          deduplicationId,
          enforcement: [],
          modelConfiguration: changedConfiguration,
        }
      );
      expect(conflicting).toEqual({ workflowRunId: expectedId, reused: true });
      expect(binding.create.mock.calls[2]?.[0].params).toMatchObject({
        promptLocale: locale === 'zh-CN' ? 'en' : 'zh-CN',
        modelConfiguration: { defaultImage: 'gpt_image_2' },
      });
      expect(binding.instances.size).toBe(1);
      expect(binding.instances.get(expectedId)).toEqual(firstSnapshot);
      expect(unexpectedConfigurationLoad).not.toHaveBeenCalled();
      expect(unexpectedComplianceLoad).not.toHaveBeenCalled();
      expect(unexpectedDatabase).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(listEnforcementFor).toHaveBeenCalledWith(userId, organizationId);
      expect(spawnImage).toHaveBeenCalledTimes(2);
    }
  );
});

describe('ShotImagesWorkflow primary failure', () => {
  it('returns a null primary after the lone failed child retry is exhausted', async () => {
    const binding = bindingHarness();
    workflowEnv = asStub<CloudflareEnv>({
      VITE_APP_URL: 'https://variant.mock.invalid',
      E2E_TEST: 'false',
      SHOT_VARIANT_WORKFLOW: binding,
      IMAGE_WORKFLOW: {},
    });
    const context = contextFor('en', 'mock-parent-shot-images-failure');
    spawnImage.mockRejectedValue(new Error('child unavailable'));

    const result = await runImagesResult(context);

    expect(result).toEqual({ imageUrls: [null], frameVersionIds: [null] });
  });
});
