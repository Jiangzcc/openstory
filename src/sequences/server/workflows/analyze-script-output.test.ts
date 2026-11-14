import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import type {
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepConfig,
} from 'cloudflare:workers';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { DEFAULT_ANALYSIS_MODEL } from '@/models/models.config';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/models/models';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  AnalyzeScriptWorkflowInput,
  CloudflareEnv,
  SceneSplitWorkflowResult,
} from '@/platform/server/workflow/types';
import {
  StoryboardContentOwnershipCheckError,
  StoryboardContentOwnershipError,
} from '@/sequences/server/db/storyboard-content-scope';
import type { Scene } from '@/shots/scene-analysis.schema';
import { asStub } from '@/test/as-stub';
import { bindAnalyzeScriptOutput } from './analyze-script-output';

type Output = ReturnType<WorkflowScopedDb['storyboardAnalysisOutput']>;

const SEQUENCE_ID = 'mock-analysis-sequence';
const OWNER = {
  workflowRunId: 'mock-storyboard-root',
  workflowClaimId: 'mock-storyboard-claim',
} satisfies GenerationWorkflowOwner;
const CONTENT_DOMAINS = [
  'scenes',
  'shotSpecVersions',
  'framePromptVersions',
  'shotPromptVersions',
  'sequences',
  'sequenceEvents',
] as const satisfies readonly (keyof Output)[];
const WRITERS = [
  { domain: 'scenes', name: 'upsert' },
  { domain: 'scenes', name: 'updateContinuity' },
  { domain: 'shotSpecVersions', name: 'write' },
  { domain: 'framePromptVersions', name: 'write' },
  { domain: 'shotPromptVersions', name: 'write' },
  { domain: 'sequences', name: 'updateAnalysisDurationMs' },
  { domain: 'sequenceEvents', name: 'recordOnce' },
] as const;

// Explicit writer doubles; these tests do not construct or access a database.
function makeOutputDouble() {
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
    sequences: {
      updateAnalysisDurationMs:
        vi.fn<Output['sequences']['updateAnalysisDurationMs']>(),
    },
    sequenceEvents: {
      recordOnce: vi.fn<Output['sequenceEvents']['recordOnce']>(),
    },
  } satisfies Output;
}

function makeExistingDomains() {
  const output = makeOutputDouble();
  return {
    scenes: {
      ...output.scenes,
      create: vi.fn<WorkflowScopedDb['scenes']['create']>(),
    },
    shotSpecVersions: {
      ...output.shotSpecVersions,
      claim: vi.fn<WorkflowScopedDb['shotSpecVersions']['claim']>(),
    },
    framePromptVersions: {
      ...output.framePromptVersions,
      select: vi.fn<WorkflowScopedDb['framePromptVersions']['select']>(),
    },
    shotPromptVersions: {
      ...output.shotPromptVersions,
      select: vi.fn<WorkflowScopedDb['shotPromptVersions']['select']>(),
    },
    sequences: {
      ...output.sequences,
      update: vi.fn<WorkflowScopedDb['sequences']['update']>(),
    },
    sequenceEvents: {
      ...output.sequenceEvents,
      record: vi.fn<WorkflowScopedDb['sequenceEvents']['record']>(),
    },
  };
}

function makeFixture() {
  const output = makeOutputDouble();
  const domains = makeExistingDomains();
  const storyboardAnalysisOutput = vi.fn<
    WorkflowScopedDb['storyboardAnalysisOutput']
  >(() => output);
  const storyboardContent = vi.fn<WorkflowScopedDb['storyboardContent']>();
  const db = asStub<WorkflowScopedDb>({
    ...domains,
    storyboardAnalysisOutput,
    storyboardContent,
    organizationId: 'mock-organization',
    userId: 'mock-user',
    models: DEFAULT_MODEL_CONFIGURATION,
    credentials: { resolveLlmKey: vi.fn() },
    claims: { frameVariants: { getById: vi.fn() } },
    liveRead: { sequenceElements: { listByIds: vi.fn() } },
    sequence: vi.fn(),
    shots: { update: vi.fn() },
    billing: { zeroReservation: vi.fn() },
  });
  return { db, output, domains, storyboardAnalysisOutput, storyboardContent };
}

function writerAt(scope: Output, path: (typeof WRITERS)[number]) {
  const writer: unknown = Reflect.get(scope[path.domain], path.name);
  if (typeof writer !== 'function')
    throw new Error(`Missing mock writer ${path.domain}.${path.name}`);
  return writer;
}

function mockWriterAt(output: Output, path: (typeof WRITERS)[number]) {
  const writer = writerAt(output, path);
  if (!vi.isMockFunction(writer)) throw new Error('Expected a writer double');
  return writer;
}

test('retains the synchronous workflow adapter signature', () => {
  expectTypeOf(bindAnalyzeScriptOutput).toEqualTypeOf<
    (
      db: WorkflowScopedDb,
      sequenceId: string | undefined,
      owner: GenerationWorkflowOwner | undefined
    ) => WorkflowScopedDb
  >();
});

test.each([OWNER, { workflowRunId: OWNER.workflowRunId }])(
  'binds exactly the supplied sequence and trusted owner: %j',
  (owner) => {
    const { db, storyboardAnalysisOutput, storyboardContent } = makeFixture();
    bindAnalyzeScriptOutput(db, SEQUENCE_ID, owner);
    expect(storyboardAnalysisOutput).toHaveBeenCalledExactlyOnceWith({
      id: SEQUENCE_ID,
      ...owner,
    });
    expect(storyboardContent).not.toHaveBeenCalled();
  }
);

test.each([
  {
    name: 'neither sequence nor owner',
    sequenceId: undefined,
    owner: undefined,
  },
  { name: 'sequence without owner', sequenceId: SEQUENCE_ID, owner: undefined },
  { name: 'owner without sequence', sequenceId: undefined, owner: OWNER },
  { name: 'empty sequence with owner', sequenceId: '', owner: OWNER },
])('returns the exact standalone scope: $name', ({ sequenceId, owner }) => {
  const { db, storyboardAnalysisOutput, storyboardContent } = makeFixture();
  expect(bindAnalyzeScriptOutput(db, sequenceId, owner)).toBe(db);
  expect(storyboardAnalysisOutput).not.toHaveBeenCalled();
  expect(storyboardContent).not.toHaveBeenCalled();
});

test.each(CONTENT_DOMAINS)(
  'merges %s without mutating its original methods',
  (domain) => {
    const { db, output, domains } = makeFixture();
    const original = { ...domains[domain] };
    Object.freeze(db);
    Object.freeze(domains[domain]);
    Object.freeze(output[domain]);
    const bound = bindAnalyzeScriptOutput(db, SEQUENCE_ID, OWNER);
    expect(bound).not.toBe(db);
    expect(bound[domain]).not.toBe(domains[domain]);
    expect(db[domain]).toBe(domains[domain]);
    expect(db[domain]).toEqual(original);
    for (const [name, method] of Object.entries(original)) {
      if (!(name in output[domain]))
        expect(Reflect.get(bound[domain], name)).toBe(method);
    }
  }
);

test('preserves every unrelated scope member, including credentials and models', () => {
  const { db } = makeFixture();
  const bound = bindAnalyzeScriptOutput(db, SEQUENCE_ID, OWNER);
  for (const [name, member] of Object.entries(db)) {
    if (!CONTENT_DOMAINS.some((domain) => domain === name))
      expect(Reflect.get(bound, name)).toBe(member);
  }
});

test.each(WRITERS)(
  'forwards arguments and the resolved result through $domain.$name',
  async (path) => {
    const { db, output, domains } = makeFixture();
    const bound = bindAnalyzeScriptOutput(db, SEQUENCE_ID, OWNER);
    const writer = mockWriterAt(output, path);
    // Opaque boundary tokens verify forwarding, not database input validation.
    const args = [Object.freeze({ mock: 'input' }), Symbol('mock argument')];
    const result = Object.freeze({ mock: 'writer result' });
    writer.mockResolvedValue(result);
    const pending: unknown = Reflect.apply(
      writerAt(bound, path),
      undefined,
      args
    );
    await expect(pending).resolves.toBe(result);
    expect(writer).toHaveBeenCalledExactlyOnceWith(...args);
    expect(writerAt(domains, path)).not.toHaveBeenCalled();
  }
);

const OWNERSHIP_ERRORS = [
  {
    name: 'local ownership error',
    create: () => new StoryboardContentOwnershipError(),
  },
  {
    name: 'serialized ownership error',
    create: () => ({
      name: 'StoryboardContentOwnershipError',
      message: 'Mock serialized ownership loss',
    }),
  },
];
const OWNERSHIP_CASES = WRITERS.flatMap((path) =>
  OWNERSHIP_ERRORS.flatMap((error) =>
    (['reject', 'throw'] as const).map((mode) => ({ ...path, error, mode }))
  )
);

test.each(OWNERSHIP_CASES)(
  'makes $domain.$name $mode non-retryable for $error.name and retains its cause',
  async (path) => {
    const { db, output, domains } = makeFixture();
    const failure = path.error.create();
    const writer = mockWriterAt(output, path);
    if (path.mode === 'reject') writer.mockRejectedValue(failure);
    else
      writer.mockImplementation(() => {
        throw failure;
      });
    const bound = bindAnalyzeScriptOutput(db, SEQUENCE_ID, OWNER);
    const pending: unknown = Reflect.apply(
      writerAt(bound, path),
      undefined,
      []
    );
    await expect(pending).rejects.toBeInstanceOf(NonRetryableError);
    await expect(pending).rejects.toMatchObject({
      name: failure.name,
      message: failure.message,
      cause: failure,
    });
    const cause = await Promise.resolve(pending).catch((error: unknown) =>
      error instanceof NonRetryableError ? error.cause : undefined
    );
    expect(cause).toBe(failure);
    expect(writer).toHaveBeenCalledExactlyOnceWith();
    expect(writerAt(domains, path)).not.toHaveBeenCalled();
  }
);

const RETRYABLE_ERRORS = [
  {
    name: 'ordinary write error',
    create: () => new Error('Mock write failed'),
  },
  {
    name: 'unverified ownership check',
    create: () =>
      new StoryboardContentOwnershipCheckError(
        new Error('Mock D1 unavailable')
      ),
  },
  {
    name: 'serialized ownership check',
    create: () => ({
      name: 'StoryboardContentOwnershipCheckError',
      message: 'Mock unavailable',
    }),
  },
  {
    name: 'ownership text without the error type',
    create: () => new Error('Storyboard no longer owns sequence content'),
  },
  {
    name: 'ownership name without a valid message',
    create: () => ({ name: 'StoryboardContentOwnershipError', message: null }),
  },
  { name: 'unknown object', create: () => ({ mock: 'unknown failure' }) },
  { name: 'unknown primitive', create: () => 'Mock unknown failure' },
];
const RETRYABLE_CASES = WRITERS.flatMap((path) =>
  RETRYABLE_ERRORS.map((error) => ({ ...path, error }))
);

test.each(RETRYABLE_CASES)(
  'keeps $error.name unchanged from $domain.$name',
  async (path) => {
    const { db, output, domains } = makeFixture();
    const failure = path.error.create();
    mockWriterAt(output, path).mockRejectedValue(failure);
    const bound = bindAnalyzeScriptOutput(db, SEQUENCE_ID, OWNER);
    const pending: unknown = Reflect.apply(
      writerAt(bound, path),
      undefined,
      []
    );
    await expect(pending).rejects.toBe(failure);
    expect(mockWriterAt(output, path)).toHaveBeenCalledExactlyOnceWith();
    expect(writerAt(domains, path)).not.toHaveBeenCalled();
  }
);

test('propagates factory refusal without using the standalone writers', () => {
  const { db, storyboardAnalysisOutput, storyboardContent, domains } =
    makeFixture();
  const failure = new Error('Mock analysis output binding refused');
  storyboardAnalysisOutput.mockImplementation(() => {
    throw failure;
  });
  expect(() => bindAnalyzeScriptOutput(db, SEQUENCE_ID, OWNER)).toThrow(
    failure
  );
  expect(storyboardContent).not.toHaveBeenCalled();
  for (const path of WRITERS)
    expect(writerAt(domains, path)).not.toHaveBeenCalled();
});

// Runtime tests use the real runImpl, binder, scene persistence and prompt derivation.
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
const waitForElementVision = vi.fn(async () => ({
  ready: true,
  pendingIds: [],
  rows: [],
}));
vi.doMock('@/cast/server/workflows/wait-for-sheets', () => ({
  waitForElementVision,
}));
const emit = vi.fn(async () => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));
const deriveAutoStyle = vi.fn<
  typeof import('@/look/server/workflows/auto-style-step').deriveAutoStyle
>(async () => {
  throw new Error('Unexpected mock style call');
});
vi.doMock('@/look/server/workflows/auto-style-step', () => ({
  deriveAutoStyle,
}));

const SHOT_ID = 'mock-analysis-shot';
const FRAME_ID = 'mock-analysis-frame';
const SCENE_ROW_ID = 'mock-persisted-scene';
const SPEC_VERSION_ID = 'mock-analysis-spec-version';
const START_TIME_MS = 1_800_000_000_000;
const ANALYSIS_DURATION_MS = 1_750;
const ANALYSIS_SCENE: Scene = {
  sceneId: 'mock-analysis-scene',
  sceneNumber: 1,
  originalScript: { extract: 'A door opens.', dialogue: [] },
  metadata: {
    title: 'Hallway',
    durationSeconds: 7,
    location: '',
    timeOfDay: '',
    storyBeat: '',
  },
  continuity: {
    characterTags: [],
    environmentTag: '',
    colorPalette: '',
    lightingSetup: '',
    styleTag: '',
    characterLooks: {},
  },
  shots: [
    {
      shotNumber: 1,
      framing: {
        shotSize: 'wide',
        angle: 'eye level',
        composition: 'The doorway',
        subjectStartState: '',
      },
      action: 'The door opens',
      cameraMovement: { move: 'static', pacing: 'slow' },
      direction: '',
      soundCue: '',
      dialogue: [],
      durationSeconds: 7,
    },
  ],
};
const SPLIT_RESULT: SceneSplitWorkflowResult = {
  scenes: [ANALYSIS_SCENE],
  title: 'Mock analysis',
  shotMapping: [
    {
      analysisSceneId: ANALYSIS_SCENE.sceneId,
      shotId: SHOT_ID,
      frameId: FRAME_ID,
      shotNumber: 1,
    },
  ],
  characterBible: [],
  sceneLooks: {},
  locationBible: [],
  elementBible: [],
  dialogueVersionIdByShotId: {},
};
const spawnAndAwaitChild = vi.fn(
  async (_step: WorkflowStep, args: { spawnStepName: string }) => {
    if (args.spawnStepName === 'spawn-scene-split') return SPLIT_RESULT;
    if (args.spawnStepName === 'spawn-location-matching')
      return { matches: [] };
    throw new Error(`Unexpected mock child ${args.spawnStepName}`);
  }
);
vi.doMock('@/platform/server/workflow/await-child', () => ({
  spawnAndAwaitChild,
}));

const { AnalyzeScriptWorkflow } = await import('./analyze-script-workflow');

class TestableAnalyzeScriptWorkflow extends AnalyzeScriptWorkflow {
  invokeRunImpl(
    event: Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, db);
  }
}

function makeRuntimeEvent(context: Partial<AnalyzeScriptWorkflowInput>) {
  const payload: AnalyzeScriptWorkflowInput = {
    promptLocale: 'en',
    userId: 'mock-user',
    organizationId: 'mock-organization',
    sequenceId: SEQUENCE_ID,
    script: 'INT. HALLWAY — NIGHT. A door opens.',
    aspectRatio: '16:9',
    styleConfig: migrateStyleConfigV1ToV2({
      mood: 'quiet',
      artStyle: 'photoreal cinematic',
      lighting: 'natural',
      colorPalette: ['#101020'],
      cameraWork: 'static',
      referenceFilms: [],
      colorGrading: 'neutral',
    }),
    analysisModelId: DEFAULT_ANALYSIS_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    elementIds: [],
    cast: [],
    includeMusic: false,
    musicPromptSource: 'ai-generated',
    referenceOnly: false,
    stopAt: 'script',
    ...context,
  };
  return asStub<Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>>({
    payload,
    instanceId: 'mock-analyze-child-not-storyboard-owner',
  });
}

function makeRuntimeHarness() {
  const fixture = makeFixture();
  const doStep = vi.fn(
    (
      name: string,
      ...rest: Array<WorkflowStepConfig | (() => Promise<unknown>)>
    ) => {
      expect(fixture.storyboardAnalysisOutput).toHaveBeenCalledTimes(1);
      if (name === 'record-analysis-duration-script')
        vi.setSystemTime(START_TIME_MS + ANALYSIS_DURATION_MS);
      const callback = rest.at(-1);
      if (typeof callback !== 'function')
        throw new Error('Missing mock step callback');
      return callback();
    }
  );
  const step = asStub<WorkflowStep>({ do: doStep });
  type Ctor = ConstructorParameters<typeof TestableAnalyzeScriptWorkflow>;
  const workflow = new TestableAnalyzeScriptWorkflow(
    asStub<Ctor[0]>(undefined),
    asStub<Ctor[1]>({})
  );
  fixture.output.scenes.upsert.mockResolvedValue(
    asStub<Awaited<ReturnType<Output['scenes']['upsert']>>>({
      id: SCENE_ROW_ID,
    })
  );
  fixture.output.shotSpecVersions.write.mockResolvedValue(
    asStub<Awaited<ReturnType<Output['shotSpecVersions']['write']>>>({
      id: SPEC_VERSION_ID,
    })
  );
  return { ...fixture, doStep, step, workflow };
}

function expectOwnedSceneAndSpecWrites(output: Output) {
  expect(output.scenes.upsert).toHaveBeenCalledExactlyOnceWith({
    sequenceId: SEQUENCE_ID,
    orderIndex: 0,
  });
  expect(output.scenes.updateContinuity).toHaveBeenCalledExactlyOnceWith(
    SCENE_ROW_ID,
    ANALYSIS_SCENE.continuity,
    { actorId: null }
  );
  expect(output.shotSpecVersions.write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      shotId: SHOT_ID,
      source: 'analysis',
      inputHash: expect.any(String),
    })
  );
}

function expectOwnedAnalysisWrites(output: Output) {
  expectOwnedSceneAndSpecWrites(output);
  expect(output.framePromptVersions.write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      frameId: FRAME_ID,
      source: 'derived',
      specVersionId: SPEC_VERSION_ID,
      text: expect.any(String),
    })
  );
  expect(output.shotPromptVersions.write).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      shotId: SHOT_ID,
      source: 'derived',
      specVersionId: SPEC_VERSION_ID,
      text: expect.any(String),
    })
  );
  expect(output.sequenceEvents.recordOnce).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      sequenceId: SEQUENCE_ID,
      kind: 'analysis.completed',
    })
  );
  expect(
    output.sequences.updateAnalysisDurationMs
  ).toHaveBeenCalledExactlyOnceWith(SEQUENCE_ID, ANALYSIS_DURATION_MS);
}

async function verifyOwnedAnalysisRun() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(new Error('Unexpected network in workflow output test'))
    )
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START_TIME_MS);
  const run = makeRuntimeHarness();
  const event = makeRuntimeEvent({
    _parent: {
      bindingName: 'STORYBOARD_WORKFLOW',
      parentInstanceId: OWNER.workflowRunId,
      eventType: 'mock-analysis-done',
    },
  });
  await run.workflow.invokeRunImpl(event, run.step, run.db);
  expect(run.storyboardAnalysisOutput).toHaveBeenCalledExactlyOnceWith({
    id: SEQUENCE_ID,
    workflowRunId: OWNER.workflowRunId,
  });
  expect(run.storyboardContent).not.toHaveBeenCalled();
  expectOwnedAnalysisWrites(run.output);
  for (const path of WRITERS)
    expect(writerAt(run.domains, path)).not.toHaveBeenCalled();
  expect(spawnAndAwaitChild).toHaveBeenCalledTimes(2);
  expect(
    spawnAndAwaitChild.mock.calls.map(([, args]) => args.spawnStepName)
  ).toEqual(['spawn-scene-split', 'spawn-location-matching']);
  expect(spawnAndAwaitChild).toHaveBeenCalledWith(
    run.step,
    expect.objectContaining({ modelConfiguration: run.db.models })
  );
  expect(createCastRecords).toHaveBeenCalledWith(
    expect.objectContaining({
      credentials: run.db.credentials,
      models: run.db.models,
    }),
    expect.any(Object)
  );
}

async function verifyFactoryRefusal() {
  const run = makeRuntimeHarness();
  const failure = new StoryboardContentOwnershipCheckError(
    new Error('Mock factory unavailable')
  );
  run.storyboardAnalysisOutput.mockImplementation(() => {
    throw failure;
  });
  const event = makeRuntimeEvent({
    storyboardOwner: OWNER,
    _parent: {
      bindingName: 'MOTION_BATCH_WORKFLOW',
      parentInstanceId: 'mock-notify-parent',
      eventType: 'mock-analysis-done',
    },
  });
  await expect(
    run.workflow.invokeRunImpl(event, run.step, run.db)
  ).rejects.toBe(failure);
  expect(run.storyboardAnalysisOutput).toHaveBeenCalledExactlyOnceWith({
    id: SEQUENCE_ID,
    ...OWNER,
  });
  expect(run.storyboardContent).not.toHaveBeenCalled();
  expect(run.doStep).not.toHaveBeenCalled();
  expect(spawnAndAwaitChild).not.toHaveBeenCalled();
  expect(createCastRecords).not.toHaveBeenCalled();
  expect(waitForElementVision).not.toHaveBeenCalled();
  expect(deriveAutoStyle).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  for (const path of WRITERS) {
    expect(writerAt(run.domains, path)).not.toHaveBeenCalled();
    expect(writerAt(run.output, path)).not.toHaveBeenCalled();
  }
}

describe('AnalyzeScriptWorkflow output binding with synthetic runtime edges', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
  test(
    'binds the resolved Storyboard parent before every step and uses all owned output writers',
    verifyOwnedAnalysisRun
  );
  test(
    'factory refusal stops the real run before steps, child work or unguarded writes',
    verifyFactoryRefusal
  );
  test.each([
    {
      storyboardOwner: OWNER,
      _parent: {
        bindingName: 'MOTION_BATCH_WORKFLOW',
        parentInstanceId: 'mock-notify-parent',
        eventType: 'mock-analysis-done',
      },
      expected: OWNER,
    },
    {
      _parent: {
        bindingName: 'STORYBOARD_WORKFLOW',
        parentInstanceId: OWNER.workflowRunId,
        eventType: 'mock-analysis-done',
      },
      expected: { workflowRunId: OWNER.workflowRunId },
    },
  ] satisfies Array<
    Partial<AnalyzeScriptWorkflowInput> & { expected: GenerationWorkflowOwner }
  >)(
    'passes the resolved root to automatic-style publication: $expected',
    async ({ expected, ...context }) => {
      const run = makeRuntimeHarness();
      const event = makeRuntimeEvent({
        ...context,
        pendingAutoStyleId: 'mock-auto-style',
      });
      deriveAutoStyle.mockResolvedValueOnce(event.payload.styleConfig);
      await run.workflow.invokeRunImpl(event, run.step, run.db);
      expect(deriveAutoStyle).toHaveBeenCalledExactlyOnceWith(
        run.step,
        expect.objectContaining({
          storyboardOwner: expected,
          workflowRunId: event.instanceId,
          scopedDb: expect.objectContaining({ models: run.db.models }),
          sequenceId: SEQUENCE_ID,
        })
      );
    }
  );
});
