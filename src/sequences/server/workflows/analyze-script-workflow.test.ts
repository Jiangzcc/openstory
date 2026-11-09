/**
 * A fresh `AnalyzeScriptWorkflow` run (#1408, #1818): which children each
 * stop-at spawns, and that the split lands before an automatic style's
 * failure fails the run — so a continue can pick up from the scenes and shots
 * it left in D1. A continue never comes here: it runs the generation plan's
 * units through the Update-all executor.
 */

import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/models/models';
import { DEFAULT_ANALYSIS_MODEL } from '@/models/models.config';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
} from '@/models/model-runtime-configuration';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import * as realChildWorkflow from '@/platform/server/workflow/await-child';
import type { ParentNotifyHint } from '@/platform/server/workflow/await-child';
import type { Locale } from '@/platform/i18n/locale';
import {
  hashVisualPromptInput,
  hashMotionPromptInput,
  sha256Hex,
} from '@/shots/input-hash';
import { narrowShotPromptContext } from '@/shots/server/prompt-context';
import { shotSpecForItem, shotWorkItems } from '@/shots/server/shot-work-items';
import { storedShotSpec } from '@/shots/shot-list.schema';
import type { CharacterBibleEntry, Scene } from '@/shots/scene-analysis.schema';
import type {
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepConfig,
  WorkflowSleepDuration,
} from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  AnalyzeScriptWorkflowInput,
  CloudflareEnv,
  LocationMatchingWorkflowInput,
  SceneSplitWorkflowInput,
  SceneSplitWorkflowResult,
} from '@/platform/server/workflow/types';
import * as realCastRecords from '@/cast/server/workflows/cast-records';
import { asStub } from '@/test/as-stub';

const loadModelRuntimeConfiguration =
  vi.fn<() => Promise<ModelRuntimeConfiguration>>();
vi.doMock('@/platform/server/db/scoped', () => ({
  createScopedDb: vi.fn(),
  loadModelRuntimeConfiguration,
}));
vi.doMock('@/models/server/fal-config', () => ({
  configureFalProxyFromEnv: vi.fn(),
}));
// The render gate prices the remaining work; an empty map keeps it DB-free.
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: vi.fn(async () => ({})),
}));

const createCastRecords = vi.fn(async () => ({ elements: [], lookIds: {} }));
vi.doMock('@/cast/server/workflows/cast-records', () => ({
  ...realCastRecords,
  createCastRecords,
}));

const emit = vi.fn(async () => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));

vi.doMock('@/cast/server/workflows/wait-for-sheets', () => ({
  waitForElementVision: vi.fn(async () => ({
    ready: true,
    pendingIds: [],
    rows: [],
  })),
}));

const SPLIT: SceneSplitWorkflowResult = {
  scenes: [],
  title: 'Derived',
  shotMapping: [{ analysisSceneId: 'as_1', shotId: 'sh_1', frameId: 'fr_1' }],
  characterBible: [],
  sceneLooks: {},
  locationBible: [],
  elementBible: [],
  dialogueVersionIdByShotId: {},
};
/** The analysed bible, which is also what the cast row stores. */
const RAW_ADA: CharacterBibleEntry = {
  characterId: 'c1',
  name: 'Ada',
  age: '20s',
  gender: 'female',
  ethnicity: 'unspecified',
  physicalDescription: 'as written in the script',
  standardClothing: 'lab coat',
  looks: [],
  personality: '',
  movement: '',
  voiceDescription: '',
  voiceOnly: false,
  isPerson: true,
  rendering: 'Photoreal live action',
  consistencyTag: '',
};
const LOCATION_MATCH = {
  locationId: 'l1',
  libraryLocationId: 'lib_1',
  libraryLocationName: 'Hallway',
  referenceImageUrl: '/r2/hall.png',
};
/** One plausible result per child, keyed by its spawn step. */
const CHILD_RESULTS: Record<string, unknown> = {
  'spawn-scene-split': SPLIT,
  'spawn-location-matching': { matches: [LOCATION_MATCH] },
};
const defaultSpawn = async (
  _step: WorkflowStep,
  args: Parameters<typeof realChildWorkflow.spawnAndAwaitChild>[1]
) => {
  const result = CHILD_RESULTS[args.spawnStepName];
  if (result === undefined) {
    throw new Error(`unexpected child ${args.spawnStepName}`);
  }
  return result;
};
const spawnAndAwaitChild = vi.fn(defaultSpawn);
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));

const spawned = () =>
  spawnAndAwaitChild.mock.calls.map(([, args]) => args.spawnStepName);
const childPayload = (spawnStepName: string) =>
  spawnAndAwaitChild.mock.calls.find(
    ([, args]) => args.spawnStepName === spawnStepName
  )?.[1].childPayload;
const STYLE_FAILURE = new Error('style: structured-output-parse-failed');
const deriveAutoStyle = vi.fn(() => Promise.reject(STYLE_FAILURE));
vi.doMock('@/look/server/workflows/auto-style-step', () => ({
  deriveAutoStyle,
}));

// Dynamic import so the mocks above apply (vi.doMock is not hoisted).
const { AnalyzeScriptWorkflow } = await import('./analyze-script-workflow');

/** Widens the protected hook so the test can drive one run directly. */
class TestableAnalyzeScriptWorkflow extends AnalyzeScriptWorkflow {
  invokeRunImpl(
    event: Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

/**
 * Runs every `step.do` body inline — durability is CF's job, not the test's.
 *
 * `do` is overloaded as `(name, callback)` and `(name, config, callback)`, so
 * the body is always the last argument. Typing `rest` as the union lets
 * `typeof` narrow to the callback with no assertion.
 */
function makeStep(waitForEvent?: MockWaitForEvent): WorkflowStep {
  const run = (
    _name: string,
    ...rest: Array<WorkflowStepConfig | (() => Promise<unknown>)>
  ) => {
    const body = rest.at(-1);
    return typeof body === 'function'
      ? body()
      : Promise.reject(new Error('step.do called without a callback'));
  };
  // only `do` is exercised
  return asStub<WorkflowStep>({ do: run, waitForEvent });
}

type SequenceUpdate = Record<string, unknown>;
type UpdateMock = ReturnType<
  typeof vi.fn<(args: SequenceUpdate) => Promise<void>>
>;

const writeVisualPrompt = vi.fn(
  async (input: { frameId: string; inputHash?: string; text?: string }) => ({
    id: `fpv-${input.frameId}`,
  })
);

const writeSpec = vi.fn(async (input: { shotId: string }) => ({
  id: `spec-${input.shotId}`,
}));

const writeMotionPrompt = vi.fn(
  async (_input: {
    shotId: string;
    source: string;
    inputHash?: string;
    text?: string;
  }) => ({ id: 'mpv-derived' })
);

function makeScopedDb(update: UpdateMock): WorkflowScopedDb {
  // minimal stub: the run stops at the script stage
  return asStub<WorkflowScopedDb>({
    sequences: {
      update,
      updateAnalysisDurationMs: vi.fn(async () => undefined),
    },
    liveRead: { sequenceElements: { listByIds: vi.fn(async () => []) } },
    shotSpecVersions: { write: writeSpec },
    framePromptVersions: { write: writeVisualPrompt },
    shotPromptVersions: { write: writeMotionPrompt },
  });
}

function makeEvent(
  extras: Partial<AnalyzeScriptWorkflowInput> = {},
  instanceId = 'analyze_run_A'
): Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>> {
  const payload: AnalyzeScriptWorkflowInput = {
    promptLocale: 'en',
    userId: 'u1',
    organizationId: 't1',
    includeMusic: true,
    sequenceId: 'seq_1',
    script: 'INT. HALLWAY — NIGHT',
    aspectRatio: '16:9',
    styleConfig: migrateStyleConfigV1ToV2({
      mood: 'tense and hopeful',
      artStyle: 'photoreal cinematic',
      lighting: 'hard key, deep shadows',
      colorPalette: ['#101020', '#e0d0b0'],
      cameraWork: 'handheld, tight lenses',
      referenceFilms: ['Children of Men'],
      colorGrading: 'cool shadows, warm highlights',
    }),
    analysisModelId: DEFAULT_ANALYSIS_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    elementIds: [],
    cast: [],
    musicPromptSource: 'ai-generated',
    referenceOnly: false,
    // An automatic style whose recipe this run is meant to derive (#1213).
    pendingAutoStyleId: 'sty_1',
    stopAt: 'script',
    ...extras,
  };
  // minimal WorkflowEvent stub
  return asStub<Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>>({
    payload,
    instanceId,
  });
}

function makeWorkflow(
  bindings: Partial<CloudflareEnv> = {}
): TestableAnalyzeScriptWorkflow {
  type Ctor = ConstructorParameters<typeof TestableAnalyzeScriptWorkflow>;
  // the run never reads ctx or bindings
  const ctx = asStub<Ctor[0]>(undefined);
  // Mock bindings implement only the exercised Cloudflare boundary.
  const env = asStub<Ctor[1]>(bindings);
  return new TestableAnalyzeScriptWorkflow(ctx, env);
}
afterAll(() => vi.unstubAllGlobals());

function resetWorkflowMocks() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(new Error('Unexpected network in workflow test'))
    )
  );
  deriveAutoStyle.mockClear();
  spawnAndAwaitChild.mockReset();
  spawnAndAwaitChild.mockImplementation(defaultSpawn);
  loadModelRuntimeConfiguration.mockReset();
  loadModelRuntimeConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
  createCastRecords.mockClear();
  writeVisualPrompt.mockClear();
  writeMotionPrompt.mockClear();
}

describe('AnalyzeScriptWorkflow (a fresh run)', () => {
  beforeEach(resetWorkflowMocks);

  test('the split lands before a style failure fails the run (#1818)', async () => {
    const update: UpdateMock = vi.fn(async () => undefined);

    await expect(
      makeWorkflow().invokeRunImpl(
        makeEvent(),
        makeStep(),
        makeScopedDb(update)
      )
    ).rejects.toThrow(STYLE_FAILURE);

    expect(spawned()).toContain('spawn-scene-split');
  });

  // The runs below have no automatic style, so a stage's own work is what
  // ends them — not the style rejection the test above leans on.
  const noStyle = { pendingAutoStyleId: undefined } as const;

  test('stopAt script: casts, spawns nothing further', async () => {
    const update: UpdateMock = vi.fn(async () => undefined);

    await makeWorkflow().invokeRunImpl(
      makeEvent({ ...noStyle, stopAt: 'script', userCountry: 'AU' }),
      makeStep(),
      makeScopedDb(update)
    );

    expect(spawned()).toEqual(['spawn-scene-split', 'spawn-location-matching']);
    expect(childPayload('spawn-scene-split')).toMatchObject({
      userCountry: 'AU',
    });
    expect(createCastRecords).toHaveBeenCalledTimes(1);
  });

  test.each(['references', 'images', 'dialogue', 'motion', 'music'] as const)(
    'stopAt %s: analysis leaves every generation unit to the executor',
    async (stopAt) => {
      await makeWorkflow().invokeRunImpl(
        makeEvent({ ...noStyle, stopAt }),
        makeStep(),
        makeScopedDb(vi.fn())
      );
      expect(spawned()).toEqual([
        'spawn-scene-split',
        'spawn-location-matching',
      ]);
      expect(createCastRecords).toHaveBeenCalledTimes(1);
    }
  );

  test('derived prompts record their spec and stamp the verify hash, not the text', async () => {
    const twoShot: Scene = {
      sceneId: 'as_1',
      sceneNumber: 1,
      originalScript: { extract: 'a beat', dialogue: [] },
      metadata: {
        title: 'Hallway',
        durationSeconds: 13,
        location: '',
        timeOfDay: '',
        storyBeat: '',
      },
      continuity: {
        characterTags: ['Ada'],
        environmentTag: '',
        colorPalette: '',
        lightingSetup: '',
        styleTag: '',
      },
      shots: [
        {
          shotNumber: 1,
          framing: {
            shotSize: 'wide',
            angle: 'eye level',
            composition: 'ADA in the doorway',
            subjectStartState: '',
          },
          action: 'opens the door',
          cameraMovement: { move: 'static', pacing: 'slow' },
          direction: '',
          soundCue: '',
          dialogue: [],
          durationSeconds: 7,
        },
        {
          shotNumber: 2,
          framing: {
            shotSize: 'medium',
            angle: 'eye level',
            composition: '',
            subjectStartState: 'ADA mid-stride',
          },
          action: 'cut to the hallway',
          cameraMovement: { move: 'truck', pacing: 'smooth' },
          direction: '',
          soundCue: '',
          dialogue: [],
          durationSeconds: 6,
        },
      ],
    };
    const shotMapping = [
      {
        analysisSceneId: 'as_1',
        shotId: 'sh-1',
        frameId: 'fr-1',
        shotNumber: 1,
      },
      {
        analysisSceneId: 'as_1',
        shotId: 'sh-2',
        frameId: 'fr-2',
        shotNumber: 2,
      },
    ];
    const event = makeEvent({ ...noStyle, stopAt: 'images' });
    spawnAndAwaitChild.mockImplementation(async (_step, args) => {
      if (args.spawnStepName === 'spawn-scene-split') {
        return {
          ...SPLIT,
          characterBible: [RAW_ADA],
          scenes: [twoShot],
          shotMapping,
        };
      }
      return defaultSpawn(_step, args);
    });

    await makeWorkflow().invokeRunImpl(
      event,
      makeStep(),
      makeScopedDb(vi.fn())
    );

    const items = shotWorkItems([twoShot], shotMapping);
    expect(writeVisualPrompt).toHaveBeenCalledTimes(2);
    expect(writeMotionPrompt).toHaveBeenCalledTimes(2);
    for (const [index, call] of writeVisualPrompt.mock.calls.entries()) {
      const item = items[index];
      const written = call[0];
      if (!item) {
        throw new Error(`missing derived visual write at ${index}`);
      }
      const spec = shotSpecForItem(item);
      if (!spec) throw new Error(`missing spec at ${index}`);
      expect(written.frameId).toBe(item.mapping.frameId);
      // Verify reads the cast row out of D1. The analysed bible is that row
      // (#867). The digest narrows its bibles by the text it was written
      // with (#2012).
      const hashWith = (characterBible: CharacterBibleEntry[]) =>
        hashVisualPromptInput(
          narrowShotPromptContext(
            {
              scene: item.scene,
              styleConfig: event.payload.styleConfig,
              characterBible,
              locationBible: SPLIT.locationBible,
              elementBible: SPLIT.elementBible,
              aspectRatio: event.payload.aspectRatio,
              analysisModel: event.payload.analysisModelId,
              // The spec is in the digest (#1923).
              spec: storedShotSpec(spec),
            },
            { channel: 'visual', prompt: written.text ?? null }
          )
        );
      const verifyHash = await hashWith([RAW_ADA]);
      const textDigest = await sha256Hex({
        kind: 'derived-shot-visual',
        shotId: item.mapping.shotId,
        text: written.text,
      });
      expect(written.inputHash).toBe(verifyHash);
      expect(written.inputHash).not.toBe(textDigest);
      expect(written).toMatchObject({
        source: 'derived',
        specVersionId: `spec-${item.mapping.shotId}`,
      });
      const motionWritten = writeMotionPrompt.mock.calls[index]?.[0];
      if (!motionWritten) {
        throw new Error(`missing derived motion write at ${index}`);
      }
      expect(motionWritten).toMatchObject({
        shotId: item.mapping.shotId,
        source: 'derived',
        specVersionId: `spec-${item.mapping.shotId}`,
        inputHash: await hashMotionPromptInput(
          narrowShotPromptContext(
            {
              scene: item.scene,
              styleConfig: event.payload.styleConfig,
              characterBible: [RAW_ADA],
              locationBible: SPLIT.locationBible,
              elementBible: SPLIT.elementBible,
              aspectRatio: event.payload.aspectRatio,
              analysisModel: event.payload.analysisModelId,
              startingFrameImageUrl: null,
              referenceOnly: false,
              dialogue: { presence: false, lines: [] },
              spec: storedShotSpec(spec),
            },
            {
              channel: 'motion',
              prompt: motionWritten.text ?? null,
              referenceOnly: false,
            }
          )
        ),
      });
    }
    spawnAndAwaitChild.mockImplementation(defaultSpawn);
  });
});

// Synthetic routes and bindings; no provider or Cloudflare engine is contacted.
function mockRuntimeConfiguration(): ModelRuntimeConfiguration {
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    textModelRouting: [
      {
        modelId: 'custom:mock-analysis',
        name: 'Mock analysis',
        channelId: 'mock-text-channel',
        upstreamModel: 'mock-upstream',
        credentialId: 'mock-frozen-credential',
        protocol: 'openai-responses',
        baseUrl: 'https://mock.invalid/v1',
        vision: true,
        structuredOutput: true,
        tools: false,
        contextWindow: 8000,
        maxOutputTokens: 2000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 2,
        description: 'Mock catalog description',
        vendor: 'Mock vendor',
      },
    ],
    imageModelRouting: createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    ),
  };
}

type CreatedChild = {
  id: string;
  params: (SceneSplitWorkflowInput | LocationMatchingWorkflowInput) & {
    _parent: ParentNotifyHint;
  };
};

type MockChildOutcome =
  | { status: 'ok'; output: unknown }
  | { status: 'failed'; error: string };

type MockWaitForEvent = (
  name: string,
  options: { type: string; timeout: WorkflowSleepDuration }
) => Promise<{ payload: MockChildOutcome }>;

function childBridgeHarness() {
  const create = vi.fn(async (options: CreatedChild) => ({ id: options.id }));
  const createSplit = vi.fn((options: CreatedChild) => create(options));
  const createLocation = vi.fn((options: CreatedChild) => create(options));
  const waitForEvent = vi.fn<MockWaitForEvent>(async (name, _options) => {
    const output = CHILD_RESULTS[name.replace('await-', 'spawn-')];
    if (output === undefined) throw new Error('Unexpected child wait: ' + name);
    return { payload: { status: 'ok', output } };
  });
  const workflow = makeWorkflow({
    SCENE_SPLIT_WORKFLOW: asStub<CloudflareEnv['SCENE_SPLIT_WORKFLOW']>({
      create: createSplit,
    }),
    LOCATION_MATCHING_WORKFLOW: asStub<
      CloudflareEnv['LOCATION_MATCHING_WORKFLOW']
    >({ create: createLocation }),
  });
  const step = makeStep(waitForEvent);
  return { create, createSplit, createLocation, waitForEvent, workflow, step };
}

function childContextEvent(promptLocale: Locale) {
  return makeEvent(
    {
      promptLocale,
      userId: 'mock-user-' + promptLocale,
      organizationId: 'mock-organization-' + promptLocale,
      pendingAutoStyleId: undefined,
      reservationId: 'mock-shared-reservation',
      ownsReservation: true,
      userCountry: 'AU',
      modelConfiguration: packModelRuntimeConfiguration(
        DEFAULT_MODEL_CONFIGURATION
      ),
    },
    'mock-analyze-' + promptLocale
  );
}

// The existing wire contract omits only these text-catalog labels.
function executionConfiguration(models: ModelRuntimeConfiguration) {
  return {
    ...models,
    ...(models.textModelRouting === undefined
      ? {}
      : {
          textModelRouting: models.textModelRouting.map(
            ({ description: _description, vendor: _vendor, ...execution }) =>
              execution
          ),
        }),
  };
}

function expectInheritedChildContext(
  harness: ReturnType<typeof childBridgeHarness>,
  event: ReturnType<typeof childContextEvent>,
  expectedModels: ModelRuntimeConfiguration
) {
  expect(harness.create).toHaveBeenCalledTimes(2);
  expect(harness.createSplit).toHaveBeenCalledTimes(1);
  expect(harness.createLocation).toHaveBeenCalledTimes(1);
  for (const [{ params }] of harness.create.mock.calls) {
    expect(params).toMatchObject({
      promptLocale: event.payload.promptLocale,
      userId: event.payload.userId,
      organizationId: event.payload.organizationId,
      sequenceId: event.payload.sequenceId,
      reservationId: event.payload.reservationId,
      _parent: {
        bindingName: 'ANALYZE_SCRIPT_WORKFLOW',
        parentInstanceId: event.instanceId,
      },
    });
    expect(params).not.toHaveProperty('ownsReservation');
    if (!params.modelConfiguration)
      throw new Error('Missing child model snapshot');
    expect(unpackModelRuntimeConfiguration(params.modelConfiguration)).toEqual(
      executionConfiguration(expectedModels)
    );
  }
  expectChildBusinessPayloads(harness, event);
  expect(loadModelRuntimeConfiguration).not.toHaveBeenCalled();
}

function expectChildBusinessPayloads(
  harness: ReturnType<typeof childBridgeHarness>,
  event: ReturnType<typeof childContextEvent>
) {
  expect(harness.create.mock.calls[0]?.[0].params).toMatchObject({
    promptName: 'phase/scene-splitting-boundaries-chat',
    userCountry: 'AU',
    modelId: event.payload.analysisModelId,
    script: event.payload.script,
    cast: event.payload.cast,
  });
  expect(harness.create.mock.calls[1]?.[0].params).toMatchObject({
    analysisModelId: event.payload.analysisModelId,
    locationBible: SPLIT.locationBible,
  });
  expect(
    harness.waitForEvent.mock.calls.map(([name, options]) => ({
      name,
      timeout: options.timeout,
    }))
  ).toEqual([
    { name: 'await-scene-split', timeout: '45 minutes' },
    { name: 'await-location-matching', timeout: '45 minutes' },
  ]);
}

type MockRoutes = 'default' | 'empty' | 'configured';

async function verifyInheritedContext(
  promptLocale: Locale,
  routes: MockRoutes
) {
  const models = {
    default: DEFAULT_MODEL_CONFIGURATION,
    empty: {
      ...DEFAULT_MODEL_CONFIGURATION,
      textModelRouting: [],
      imageModelRouting: [],
    },
    configured: mockRuntimeConfiguration(),
  }[routes];
  const expectedModels = structuredClone(models);
  const event = childContextEvent(promptLocale);
  const harness = childBridgeHarness();
  loadModelRuntimeConfiguration.mockResolvedValue({
    ...DEFAULT_MODEL_CONFIGURATION,
    sceneSplit: 'z-ai/glm-5.3-flash',
  });
  await harness.workflow.invokeRunImpl(event, harness.step, {
    ...makeScopedDb(vi.fn()),
    models,
  });
  expectInheritedChildContext(harness, event, expectedModels);
}

async function verifyConcurrentContext() {
  const runs = (['en', 'zh-CN'] as const).map((promptLocale) => ({
    event: childContextEvent(promptLocale),
    models:
      promptLocale === 'en'
        ? mockRuntimeConfiguration()
        : DEFAULT_MODEL_CONFIGURATION,
    harness: childBridgeHarness(),
  }));
  await Promise.all(
    runs.map(({ event, models, harness }) =>
      harness.workflow.invokeRunImpl(event, harness.step, {
        ...makeScopedDb(vi.fn()),
        models,
      })
    )
  );
  for (const { event, models, harness } of runs) {
    expectInheritedChildContext(harness, event, models);
  }
}

async function verifyFailedSplit() {
  const harness = childBridgeHarness();
  harness.waitForEvent.mockResolvedValueOnce({
    payload: {
      status: 'failed',
      error: 'Mock split failure',
    },
  });
  await expect(
    harness.workflow.invokeRunImpl(childContextEvent('en'), harness.step, {
      ...makeScopedDb(vi.fn()),
      models: mockRuntimeConfiguration(),
    })
  ).rejects.toThrow('Mock split failure');
  expect(harness.create).toHaveBeenCalledTimes(1);
  expect(harness.createSplit).toHaveBeenCalledTimes(1);
  expect(harness.createLocation).not.toHaveBeenCalled();
  expect(harness.waitForEvent).toHaveBeenCalledTimes(1);
  expect(harness.create.mock.calls[0]?.[0].params).toMatchObject({
    promptName: 'phase/scene-splitting-boundaries-chat',
  });
}

describe('AnalyzeScriptWorkflow child context through the real bridge (local mocks)', () => {
  beforeEach(() => {
    resetWorkflowMocks();
    spawnAndAwaitChild.mockImplementation(realChildWorkflow.spawnAndAwaitChild);
  });

  test.each([
    ['en', 'default'],
    ['zh-CN', 'default'],
    ['en', 'empty'],
    ['zh-CN', 'empty'],
    ['en', 'configured'],
    ['zh-CN', 'configured'],
  ] as const)(
    'inherits %s and %s routes at both child create boundaries',
    verifyInheritedContext
  );

  test(
    'keeps concurrent language and model contexts on their own runs',
    verifyConcurrentContext
  );

  test(
    'a failed split stops before creating location matching',
    verifyFailedSplit
  );
});
