/** Local composition: real parent, spawn helper and codecs; synthetic runtime edges. */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
} from '@/models/model-runtime-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/models/models';
import type { Locale } from '@/platform/i18n/locale';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import type { waitForElementVision as WaitForElementVision } from '@/cast/server/workflows/wait-for-sheets';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { buildChildInstanceId } from '@/platform/server/workflow/await-child';
import type { ParentNotifyHint } from '@/platform/server/workflow/await-child';
import type {
  AnalyzeScriptWorkflowInput,
  CloudflareEnv,
  LocationMatchingWorkflowInput,
  LocationMatchingWorkflowOutput,
  SceneSplitWorkflowInput,
  SceneSplitWorkflowResult,
} from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import type {
  WorkflowEvent,
  WorkflowSleepDuration,
  WorkflowStep,
  WorkflowStepConfig,
} from 'cloudflare:workers';

// Only supplies env; authentication, cleanup and failure hooks belong to base tests.
vi.doMock('@/platform/server/workflow/base-workflow', () => ({
  OpenStoryWorkflowEntrypoint: class {
    constructor(
      _ctx: unknown,
      protected readonly env: CloudflareEnv
    ) {}
  },
}));
const createCastRecords = vi.fn(async () => ({ elements: [], lookIds: {} }));
vi.doMock('@/cast/server/workflows/cast-records', () => ({
  createCastRecords,
}));
const waitForElementVision = vi.fn<typeof WaitForElementVision>(async () => ({
  ready: true,
  pendingIds: [],
  rows: [],
}));
vi.doMock('@/cast/server/workflows/wait-for-sheets', () => ({
  waitForElementVision,
}));
const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));
vi.doMock('@/look/server/workflows/auto-style-step', () => ({
  deriveAutoStyle: vi.fn(async () => {
    throw new Error(
      'Unexpected automatic-style LLM call in child-context test'
    );
  }),
}));
vi.doMock('@/shots/server/persist-shot-spec', () => ({
  persistShotSpec: vi.fn(async () => {
    throw new Error('Unexpected shot generation in child-context test');
  }),
}));

// No mock is registered for await-child or either model configuration codec.
const { AnalyzeScriptWorkflow } = await import('./analyze-script-workflow');
class TestableAnalyzeScriptWorkflow extends AnalyzeScriptWorkflow {
  invokeRunImpl(
    event: Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

type ChildStage = 'scene-split' | 'location-matching';
type CreatedChild = {
  id: string;
  params: (SceneSplitWorkflowInput | LocationMatchingWorkflowInput) & {
    _parent: ParentNotifyHint;
  };
};
type RecordedChild = CreatedChild & { stage: ChildStage };
type ChildOutcome =
  | {
      status: 'ok';
      output: SceneSplitWorkflowResult | LocationMatchingWorkflowOutput;
    }
  | { status: 'failed'; error: string };
type WaitForEvent = (
  name: string,
  options: { type: string; timeout: WorkflowSleepDuration }
) => Promise<{ payload: ChildOutcome }>;

function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error('Deferred promise has not been initialized');
  };
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mockRuntimeConfiguration(label: string): ModelRuntimeConfiguration {
  const imageConfiguration = imageConfigurationFixture();
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    sceneSplit: `custom:mock-analysis-${label}`,
    textModelRouting: [
      {
        modelId: `custom:mock-analysis-${label}`,
        name: `Mock analysis ${label}`,
        channelId: `mock-text-${label}`,
        upstreamModel: `mock-upstream-${label}`,
        credentialId: `mock-text-credential-${label}`,
        protocol: 'openai-responses',
        baseUrl: `https://${label}.mock.invalid/v1`,
        vision: true,
        structuredOutput: true,
        tools: false,
        contextWindow: 8000,
        maxOutputTokens: 2000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 2,
        description: 'Synthetic catalog description',
        vendor: 'Synthetic vendor',
      },
    ],
    imageModelRouting: createImageModelRoutingSnapshot({
      ...imageConfiguration,
      channels: imageConfiguration.channels.map((channel) => ({
        ...channel,
        credentialId: `mock-image-credential-${label}`,
        baseUrl: `https://${label}.mock.invalid/images/v1`,
      })),
    }),
  };
}

function mockEvent(
  promptLocale: Locale,
  label: string,
  models: ModelRuntimeConfiguration
): Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>> {
  const payload: AnalyzeScriptWorkflowInput = {
    promptLocale,
    userId: `mock-user-${label}`,
    organizationId: `mock-organization-${label}`,
    sequenceId: `mock-sequence-${label}`,
    reservationId: `mock-reservation-${label}`,
    ownsReservation: true,
    // The resolved scoped snapshot must win over this stale payload snapshot.
    modelConfiguration: packModelRuntimeConfiguration(
      DEFAULT_MODEL_CONFIGURATION
    ),
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
    analysisModelId: models.sceneSplit,
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    elementIds: [],
    cast: [],
    musicPromptSource: 'ai-generated',
    referenceOnly: false,
    includeMusic: false,
    stopAt: 'script',
    userCountry: 'AU',
    suggestedLocationIds: [`mock-library-location-${label}`],
  };
  return asStub<Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>>({
    payload,
    instanceId: `mock-analyze-${label}`,
  });
}

// The original split fixture's empty scenes avoid unrelated generation work.
function mockSplitResult(label: string): SceneSplitWorkflowResult {
  return {
    scenes: [],
    title: `Mock split ${label}`,
    shotMapping: [],
    characterBible: [],
    sceneLooks: {},
    locationBible: [
      {
        locationId: `mock-location-${label}`,
        name: `Hallway ${label}`,
        type: 'interior',
        description: `Synthetic hallway ${label}`,
        architecturalStyle: '',
        keyFeatures: '',
        ambiance: '',
        rendering: 'Photoreal live action',
        consistencyTag: `hallway_${label}`,
        firstMention: {
          text: 'HALLWAY',
          lineNumber: 1,
          sceneId: `mock-scene-${label}`,
        },
      },
    ],
    elementBible: [],
    dialogueVersionIdByShotId: {},
  };
}

function mockBindings() {
  const children: RecordedChild[] = [];
  const binding = (stage: ChildStage) => ({
    create: vi.fn(async (child: CreatedChild) => {
      children.push({ ...structuredClone(child), stage });
      return { id: child.id };
    }),
    get: vi.fn(async () => {
      throw new Error('Unexpected child status fallback in child-context test');
    }),
  });
  const split = binding('scene-split');
  const location = binding('location-matching');
  const env = asStub<CloudflareEnv>({
    SCENE_SPLIT_WORKFLOW: split,
    LOCATION_MATCHING_WORKFLOW: location,
  });
  return { children, env };
}

// Factory substitute keeps the existing event/duration spies; DB fencing is not exercised.
function mockAnalysisOutput(
  recordOnce: WorkflowScopedDb['sequenceEvents']['recordOnce'],
  updateAnalysisDurationMs: WorkflowScopedDb['sequences']['updateAnalysisDurationMs']
) {
  type Output = ReturnType<WorkflowScopedDb['storyboardAnalysisOutput']>;
  return {
    scenes: {
      upsert: vi.fn<Output['scenes']['upsert']>(),
      updateContinuity: vi.fn<Output['scenes']['updateContinuity']>(),
    },
    shotSpecVersions: { write: vi.fn<Output['shotSpecVersions']['write']>() },
    framePromptVersions: {
      write: vi.fn<Output['framePromptVersions']['write']>(),
    },
    shotPromptVersions: {
      write: vi.fn<Output['shotPromptVersions']['write']>(),
    },
    sequences: { updateAnalysisDurationMs },
    sequenceEvents: { recordOnce },
  } satisfies Output;
}

function mockRun(
  bindings: ReturnType<typeof mockBindings>,
  promptLocale: Locale,
  label: string
) {
  const models = mockRuntimeConfiguration(label);
  const expectedWireModels = packModelRuntimeConfiguration(
    structuredClone(models)
  );
  const event = mockEvent(promptLocale, label, models);
  const splitResult = mockSplitResult(label);
  const splitWaiting = deferred<void>();
  const splitOutcome = deferred<ChildOutcome>();
  const waitForEvent = vi.fn<WaitForEvent>(async (name, _options) => {
    if (name === 'await-scene-split') {
      splitWaiting.resolve();
      return { payload: await splitOutcome.promise };
    }
    if (name === 'await-location-matching') {
      return { payload: { status: 'ok', output: { matches: [] } } };
    }
    throw new Error(`Unexpected child wait ${name}`);
  });
  // Inline callbacks and controlled events stand in for the step engine.
  const doStep = vi.fn(
    (
      _name: string,
      ...rest: Array<WorkflowStepConfig | (() => Promise<unknown>)>
    ) => {
      const callback = rest.at(-1);
      if (typeof callback !== 'function')
        throw new Error('Missing step callback');
      return callback();
    }
  );
  const step = asStub<WorkflowStep>({ do: doStep, waitForEvent });
  const recordOnce = vi.fn(async () => undefined);
  const updateAnalysisDurationMs = vi.fn(async () => undefined);
  const scopedDb = asStub<WorkflowScopedDb>({
    userId: event.payload.userId,
    organizationId: event.payload.organizationId,
    models,
    sequences: { updateAnalysisDurationMs },
    sequenceEvents: { recordOnce },
    storyboardAnalysisOutput: vi.fn<
      WorkflowScopedDb['storyboardAnalysisOutput']
    >(() => mockAnalysisOutput(recordOnce, updateAnalysisDurationMs)),
    liveRead: {},
  });
  type Ctor = ConstructorParameters<typeof TestableAnalyzeScriptWorkflow>;
  const workflow = new TestableAnalyzeScriptWorkflow(
    asStub<Ctor[0]>(undefined),
    bindings.env
  );
  return {
    event,
    models,
    expectedWireModels,
    splitResult,
    splitWaiting,
    splitOutcome,
    waitForEvent,
    doStep,
    recordOnce,
    execute: () => workflow.invokeRunImpl(event, step, scopedDb),
  };
}

type MockRun = ReturnType<typeof mockRun>;
function childrenFor(bindings: ReturnType<typeof mockBindings>, run: MockRun) {
  return bindings.children.filter(
    ({ params }) => params._parent.parentInstanceId === run.event.instanceId
  );
}

function expectContext(child: RecordedChild, run: MockRun) {
  const { params, stage } = child;
  expect(child.id).toBe(
    buildChildInstanceId(
      `${stage}:${run.event.payload.sequenceId}`,
      run.event.instanceId
    )
  );
  expect(params).toMatchObject({
    promptLocale: run.event.payload.promptLocale,
    userId: run.event.payload.userId,
    organizationId: run.event.payload.organizationId,
    sequenceId: run.event.payload.sequenceId,
    reservationId: run.event.payload.reservationId,
    _parent: {
      bindingName: 'ANALYZE_SCRIPT_WORKFLOW',
      parentInstanceId: run.event.instanceId,
    },
  });
  expect(params).not.toHaveProperty('ownsReservation');
  expect(params.modelConfiguration).toEqual(run.expectedWireModels);
  if (!params.modelConfiguration)
    throw new Error('Child has no model configuration');
  expect(Array.isArray(params.modelConfiguration.textModelRouting)).toBe(false);
  expect(Array.isArray(params.modelConfiguration.imageModelRouting)).toBe(
    false
  );
  expect(
    unpackModelRuntimeConfiguration(params.modelConfiguration)
  ).toMatchObject({
    sceneSplit: run.models.sceneSplit,
    textModelRouting: [
      {
        channelId: run.models.textModelRouting?.[0]?.channelId,
        credentialId: run.models.textModelRouting?.[0]?.credentialId,
        upstreamModel: run.models.textModelRouting?.[0]?.upstreamModel,
      },
    ],
  });
}

function expectCompletedRun(
  bindings: ReturnType<typeof mockBindings>,
  run: MockRun
) {
  const children = childrenFor(bindings, run);
  expect(children.map(({ stage }) => stage)).toEqual([
    'scene-split',
    'location-matching',
  ]);
  for (const child of children) expectContext(child, run);
  expect(children[0]?.params).toMatchObject({
    promptName: 'phase/scene-splitting-boundaries-chat',
    modelId: run.event.payload.analysisModelId,
    script: run.event.payload.script,
    userCountry: 'AU',
    cast: [],
  });
  expect(children[1]?.params).toMatchObject({
    analysisModelId: run.event.payload.analysisModelId,
    locationBible: run.splitResult.locationBible,
    suggestedLocationIds: run.event.payload.suggestedLocationIds,
  });
  expect(
    run.doStep.mock.calls
      .map(([name]) => name)
      .filter((name) => name.startsWith('spawn-'))
  ).toEqual(['spawn-scene-split', 'spawn-location-matching']);
  expect(run.waitForEvent.mock.calls).toEqual([
    [
      'await-scene-split',
      { type: children[0]?.params._parent.eventType, timeout: '45 minutes' },
    ],
    [
      'await-location-matching',
      { type: children[1]?.params._parent.eventType, timeout: '45 minutes' },
    ],
  ]);
  expect(run.recordOnce).toHaveBeenCalledOnce();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected network in child-context test');
    })
  );
});
afterAll(() => vi.unstubAllGlobals());

describe('AnalyzeScriptWorkflow child context at the real binding.create boundary', () => {
  test.each(['zh-CN', 'en'] as const)(
    '%s waits for successful scene split before matching locations and inherits the resolved context',
    async (promptLocale) => {
      const bindings = mockBindings();
      const run = mockRun(bindings, promptLocale, promptLocale.toLowerCase());
      const completed = run.execute();
      await run.splitWaiting.promise;
      expect(childrenFor(bindings, run).map(({ stage }) => stage)).toEqual([
        'scene-split',
      ]);
      expect(createCastRecords).not.toHaveBeenCalled();
      expect(run.waitForEvent).toHaveBeenCalledOnce();
      run.splitOutcome.resolve({ status: 'ok', output: run.splitResult });
      await completed;
      expectCompletedRun(bindings, run);
      expect(createCastRecords).toHaveBeenCalledOnce();
    }
  );

  test.each([0, 1])(
    'concurrent parents sharing bindings keep identity, locale, routes and reservations isolated (finish %i first)',
    async (firstIndex) => {
      const bindings = mockBindings();
      const runs = [
        mockRun(bindings, 'zh-CN', 'a'),
        mockRun(bindings, 'en', 'b'),
      ];
      const completed = runs.map((run) => run.execute());
      await Promise.all(runs.map((run) => run.splitWaiting.promise));
      expect(bindings.children.map(({ stage }) => stage)).toEqual([
        'scene-split',
        'scene-split',
      ]);
      for (const index of [firstIndex, 1 - firstIndex]) {
        const run = runs[index];
        if (!run) throw new Error('Missing concurrent parent');
        run.splitOutcome.resolve({ status: 'ok', output: run.splitResult });
        await completed[index];
        expectCompletedRun(bindings, run);
        if (index === firstIndex) {
          const pendingRun = runs[1 - firstIndex];
          if (!pendingRun) throw new Error('Missing pending parent');
          expect(
            childrenFor(bindings, pendingRun).map(({ stage }) => stage)
          ).toEqual(['scene-split']);
        }
      }
      expect(new Set(bindings.children.map(({ id }) => id)).size).toBe(4);
    }
  );

  test.each(['zh-CN', 'en'] as const)(
    '%s stops on a failed scene split without casting or creating location matching',
    async (promptLocale) => {
      const bindings = mockBindings();
      const run = mockRun(
        bindings,
        promptLocale,
        'failed-' + promptLocale.toLowerCase()
      );
      const completed = run.execute();
      await run.splitWaiting.promise;
      run.splitOutcome.resolve({
        status: 'failed',
        error: 'Synthetic scene split failure',
      });
      await expect(completed).rejects.toThrow('Synthetic scene split failure');
      const children = childrenFor(bindings, run);
      expect(children).toHaveLength(1);
      const child = children[0];
      if (!child) throw new Error('Missing scene split child');
      expect(child.stage).toBe('scene-split');
      expectContext(child, run);
      expect(run.waitForEvent).toHaveBeenCalledOnce();
      expect(createCastRecords).not.toHaveBeenCalled();
      expect(run.recordOnce).not.toHaveBeenCalled();
    }
  );
});

const STORYBOARD_OWNER: GenerationWorkflowOwner = {
  workflowRunId: 'synthetic-storyboard-root',
  workflowClaimId: 'synthetic-storyboard-claim',
};
const STORYBOARD_PARENT: ParentNotifyHint = {
  bindingName: 'STORYBOARD_WORKFLOW',
  parentInstanceId: STORYBOARD_OWNER.workflowRunId,
  eventType: 'synthetic-analysis-done',
};
const MOTION_PARENT: ParentNotifyHint = {
  ...STORYBOARD_PARENT,
  bindingName: 'MOTION_BATCH_WORKFLOW',
  parentInstanceId: 'synthetic-motion-root',
};

function expectScriptPhaseOwner(owner: GenerationWorkflowOwner | undefined) {
  expect(emit.mock.calls.map(([name]) => name)).toEqual([
    'generation.phase:start',
    'generation.phase:start',
    'generation.phase:start',
    'generation.phase:complete',
  ]);
  for (const [, payload] of emit.mock.calls)
    expect(payload).toHaveProperty('workflowOwner', owner);
}

test.each([
  {
    name: 'explicit root ahead of another notify parent',
    context: { storyboardOwner: STORYBOARD_OWNER, _parent: MOTION_PARENT },
    owner: STORYBOARD_OWNER,
  },
  {
    name: 'legacy direct Storyboard parent',
    context: { _parent: STORYBOARD_PARENT },
    owner: { workflowRunId: STORYBOARD_PARENT.parentInstanceId },
  },
  { name: 'standalone analysis', context: {}, owner: undefined },
  {
    name: 'independent MotionBatch parent',
    context: { _parent: MOTION_PARENT },
    owner: undefined,
  },
] satisfies Array<{
  name: string;
  context: Pick<AnalyzeScriptWorkflowInput, 'storyboardOwner' | '_parent'>;
  owner: GenerationWorkflowOwner | undefined;
}>)(
  'stamps and passes the root snapshot for $name',
  async ({ context, owner }) => {
    waitForElementVision.mockImplementationOnce(
      async (_step, _scopedDb, _ids, options) => {
        await options?.onWaitNeeded?.(1);
        return { ready: true, pendingIds: [], rows: [] };
      }
    );
    const bindings = mockBindings();
    const run = mockRun(bindings, 'en', 'owner');
    Object.assign(run.event.payload, context);
    const completed = run.execute();
    await run.splitWaiting.promise;
    const child = childrenFor(bindings, run)[0];
    expect(child?.params).toHaveProperty('storyboardOwner', owner);
    run.splitOutcome.resolve({ status: 'ok', output: run.splitResult });
    await completed;
    expectCompletedRun(bindings, run);
    expectScriptPhaseOwner(owner);
  }
);
