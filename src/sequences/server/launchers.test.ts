// Storyboard launch ownership and immutable request snapshots.

import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { generateId } from '@/platform/id';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type {
  PrepareWorkflowRunOptions,
  PreparedWorkflowRun,
} from '@/platform/server/workflow/prepared-trigger';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/models/models';
import { DEFAULT_ANALYSIS_MODEL } from '@/models/models.config';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type {
  TextModelRoute,
  TextModelRoutingSnapshot,
} from '@/models/text-channels';

const CUSTOM_ROUTE: TextModelRoute = {
  modelId: 'custom:request-model',
  name: 'Request model',
  channelId: 'test-channel',
  upstreamModel: 'upstream-model',
  credentialId: 'test-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://models.example/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};

import type { ScopedDb } from '@/platform/server/db/scoped';
import type { StyleConfig } from '@/platform/server/db/schema';
import type { GenerationStage } from '@/sequences/pipeline';
import type {
  StoryboardTriggerInput,
  StoryboardWorkflowInput,
} from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';

// Engine preparation/dispatch and DB are mocked here; real SQL coverage is in ownership/startup tests.
async function prepareSyntheticRun(
  triggerPath: string,
  body: StoryboardWorkflowInput,
  options?: PrepareWorkflowRunOptions
): Promise<PreparedWorkflowRun<StoryboardWorkflowInput>> {
  return {
    workflowRunId: 'synthetic-prepared-' + generateId(),
    triggerPath,
    body: structuredClone({
      ...body,
      modelConfiguration: packModelRuntimeConfiguration(
        options?.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION
      ),
    }),
  };
}
const prepare = vi.fn(prepareSyntheticRun);
const trigger = vi.fn(
  async (prepared: PreparedWorkflowRun<StoryboardWorkflowInput>) =>
    prepared.workflowRunId
);
const { WorkflowLaunchPendingError } = await vi.importActual<
  typeof import('@/platform/server/workflow/prepared-trigger')
>('@/platform/server/workflow/prepared-trigger');
const getRequestHeader = vi.fn<(name: string) => string | undefined>();
vi.doMock('@tanstack/react-start/server', () => ({ getRequestHeader }));
vi.doMock('@/platform/server/workflow/prepared-trigger', () => ({
  prepareWorkflowRun: prepare,
  triggerPreparedWorkflow: trigger,
  WorkflowLaunchPendingError,
}));
beforeEach(() => {
  getRequestHeader.mockReset();
  runStateResult = 'failed';
});
afterEach(() => {
  prepare.mockReset().mockImplementation(prepareSyntheticRun);
  trigger
    .mockReset()
    .mockImplementation(async (prepared) => prepared.workflowRunId);
});

let runStateResult: 'failed' | 'completed' | 'unknown' | null = null;
vi.doMock('@/platform/server/workflow/reconcile', () => ({
  resolveRunState: vi.fn(async () => runStateResult),
}));

// Dynamic import so the mocks above apply (vi.doMock is not hoisted).
const {
  triggerStoryboard,
  assertNoActiveStoryboard,
  GenerationInProgressError,
  GenerationStatusUnknownError,
} = await import('./launchers');

const INPUT: StoryboardTriggerInput = {
  promptLocale: 'en' as const,
  userId: 'u1',
  organizationId: 't1',
  sequenceId: 'seq_1',
  options: {
    shotsPerScene: 3,
    generateThumbnails: true,
    generateDescriptions: true,
    aiProvider: 'openrouter',
    regenerateAll: true,
  },
};

const STYLE_CONFIG: StyleConfig = migrateStyleConfigV1ToV2({
  mood: 'tense and hopeful',
  artStyle: 'photoreal cinematic',
  lighting: 'hard key, deep shadows',
  colorPalette: ['#101020', '#e0d0b0'],
  cameraWork: 'handheld, tight lenses',
  referenceFilms: ['Children of Men'],
  colorGrading: 'cool shadows, warm highlights',
});

function makeScopedDb(opts: {
  workflowRunId: string | null;
  analysisModel?: string;
  routing?: TextModelRoutingSnapshot;
  claimSucceeds?: boolean;
  script?: string | null;
  styleId?: string | null;
  styleConfig?: StyleConfig | null;
  style?: {
    id?: string;
    sequenceId?: string | null;
    config: StyleConfig;
  } | null;
  elementIds?: string[];
  locations?: Array<{ id: string; name: string; description: string | null }>;
  /** The sequence's live location links (#1695). */
  linkedLocations?: Array<{ id: string; attached: boolean }>;
  musicPrompt?: string | null;
  generationStopAt?: GenerationStage;
  draftMotion?: boolean;
  cast?: never[];
}) {
  const updateStatus = vi.fn();
  const failWorkflowIfCurrent = vi.fn(async () => true);
  const recordSequenceEvent = vi.fn(async () => undefined);
  const claimWorkflowSlot = vi.fn<ScopedDb['sequences']['claimWorkflowSlot']>(
    async () => opts.claimSucceeds ?? true
  );
  const publishWorkflowInstance = vi.fn<
    ScopedDb['sequences']['publishWorkflowInstance']
  >(async () => true);
  const update = vi.fn();
  const getForUser = vi.fn(async () => ({
    id: 'seq_1',
    title: 'The Long Walk',
    generateStartFrames: true,
    draftMotion: opts.draftMotion,
    script: opts.script === undefined ? 'INT. HALLWAY — NIGHT' : opts.script,
    aspectRatio: '16:9',
    styleId: opts.styleId === undefined ? 'style_1' : opts.styleId,
    styleConfig: opts.styleConfig === undefined ? null : opts.styleConfig,
    analysisModel: opts.analysisModel ?? 'invalid-model-id',
    imageModel: 'not-a-real-image-model',
    videoModel: 'not-a-real-video-model',
    workflowRunId: opts.workflowRunId,
    musicPrompt: opts.musicPrompt ?? null,
    generationStopAt: opts.generationStopAt ?? 'images',
    status: 'failed',
  }));
  const getStyleById = vi.fn(async () =>
    opts.style === undefined ? { config: STYLE_CONFIG } : opts.style
  );
  const listElements = vi.fn(async () =>
    (opts.elementIds ?? ['el_1', 'el_2']).map((id) => ({ id }))
  );
  const getLocationsByIds = vi.fn(
    async (_ids: readonly string[]) => opts.locations ?? []
  );
  const listLocations = vi.fn(async () => opts.linkedLocations ?? []);
  const listCharacters = vi.fn(async () => opts.cast ?? []);
  const getHeldElsewhere = vi.fn(async () => false);
  const getMemberEmail = vi.fn(async () => 'owner@example.com');
  const stub = {
    modelConfiguration: { get: async () => DEFAULT_MODEL_CONFIGURATION },
    textChannels: { getSnapshot: vi.fn(async () => opts.routing ?? []) },
    imageChannels: { getSnapshot: vi.fn(async () => []) },
    sequences: {
      getForUser,
      getWorkflowLaunch: vi.fn(async () => undefined),
      claimWorkflowSlot,
      publishWorkflowInstance,
      failWorkflowIfCurrent,
      update,
    },
    styles: { getById: getStyleById },
    sequenceElements: { list: listElements },
    characters: { list: listCharacters, getHeldElsewhere },
    locations: { list: listLocations, getCurrentByIds: getLocationsByIds },
    organizationManagement: { getMemberEmail },
    sequence: () => ({ updateStatus }),
    sequenceEvents: { record: recordSequenceEvent },
  };
  // Mock launcher DB; legacy writes remain visible to regression assertions.
  const scopedDb = asStub<ScopedDb>(stub);
  return {
    scopedDb,
    updateStatus,
    recordSequenceEvent,
    failWorkflowIfCurrent,
    claimWorkflowSlot,
    publishWorkflowInstance,
    update,
    getForUser,
    getStyleById,
    listElements,
    getLocationsByIds,
    listLocations,
  };
}

describe('triggerStoryboard', () => {
  test.each([
    ['AU', 'AU'],
    [' cn ', 'CN'],
    [undefined, undefined],
    ['', undefined],
    ['XX', undefined],
    ['T1', undefined],
    ['Australia', undefined],
  ])(
    'snapshots country %s as %s for character context',
    async (header, expected) => {
      getRequestHeader.mockReturnValue(header);

      const { scopedDb } = makeScopedDb({ workflowRunId: null });

      await triggerStoryboard(scopedDb, INPUT);

      expect(getRequestHeader).toHaveBeenCalledWith('cf-ipcountry');
      expect(trigger.mock.calls[0]?.[0]?.body).toHaveProperty(
        'userCountry',
        expected
      );
    }
  );

  test('previous run still in flight → GenerationInProgressError, nothing triggered', async () => {
    runStateResult = null; // queued/running/waiting

    const { scopedDb, claimWorkflowSlot } = makeScopedDb({
      workflowRunId: 'openstory-so_storyboard_live',
    });

    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toBeInstanceOf(
      GenerationInProgressError
    );
    expect(claimWorkflowSlot).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  test('status lookup failed → GenerationStatusUnknownError (not "already running"), nothing triggered', async () => {
    runStateResult = 'unknown'; // CF status API blip — can't verify

    const { scopedDb, claimWorkflowSlot } = makeScopedDb({
      workflowRunId: 'openstory-so_storyboard_maybe',
    });

    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toBeInstanceOf(
      GenerationStatusUnknownError
    );
    expect(claimWorkflowSlot).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    'returns the created instance after publishing its claim (publisher: %s)',
    async (published) => {
      const db = makeScopedDb({ workflowRunId: 'openstory-so_storyboard_old' });
      db.publishWorkflowInstance.mockResolvedValueOnce(published);

      const result = await triggerStoryboard(db.scopedDb, INPUT);

      expect(db.claimWorkflowSlot).toHaveBeenCalledExactlyOnceWith({
        id: 'seq_1',
        expectedRunId: 'openstory-so_storyboard_old',
        claimId: expect.stringMatching(/^synthetic-prepared-/),
        launch: expect.objectContaining({ triggerPath: '/storyboard' }),
        activity: { summary: 'Started the storyboard' },
      });
      const launch = db.claimWorkflowSlot.mock.calls[0]?.[0].launch;
      const workflowRunId = launch?.workflowRunId;
      const claimId = workflowRunId;
      expect(db.claimWorkflowSlot.mock.calls[0]?.[0].claimId).toBe(
        workflowRunId
      );
      expect(trigger).toHaveBeenCalledExactlyOnceWith(launch);
      expect(launch?.body).toMatchObject({
        ...INPUT,
        workflowClaimId: claimId,
      });
      expect(db.publishWorkflowInstance).toHaveBeenCalledExactlyOnceWith({
        id: 'seq_1',
        claimId,
        workflowRunId,
      });
      expect(db.updateStatus).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.failWorkflowIfCurrent).not.toHaveBeenCalled();
      expect(result).toEqual({ workflowRunId });
    }
  );

  test('publication errors propagate without retrying or marking a created run failed', async () => {
    const db = makeScopedDb({ workflowRunId: null });
    const publicationError = new Error('synthetic publication SQL failure');
    db.publishWorkflowInstance.mockRejectedValueOnce(publicationError);

    const pending = triggerStoryboard(db.scopedDb, INPUT);
    await expect(pending).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
    await expect(pending).rejects.toMatchObject({
      cause: publicationError,
      workflowRunId: db.claimWorkflowSlot.mock.calls[0]?.[0].claimId,
    });

    expect(db.claimWorkflowSlot).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(db.publishWorkflowInstance).toHaveBeenCalledExactlyOnceWith({
      id: 'seq_1',
      claimId: db.claimWorkflowSlot.mock.calls[0]?.[0].claimId,
      workflowRunId: db.claimWorkflowSlot.mock.calls[0]?.[0].claimId,
    });
    expect(db.updateStatus).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.failWorkflowIfCurrent).not.toHaveBeenCalled();
    expect(db.recordSequenceEvent).not.toHaveBeenCalled();
  });

  test('snapshots the sequence row onto the payload so no step re-derives it', async () => {
    const { scopedDb, listElements, claimWorkflowSlot } = makeScopedDb({
      workflowRunId: null,
      elementIds: ['el_1', 'el_2'],
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(listElements).toHaveBeenCalledWith('seq_1');
    expect(trigger.mock.calls[0]?.[0]?.body).toEqual({
      ...INPUT,
      modelConfiguration: packModelRuntimeConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: [],
        imageModelRouting: [],
      }),
      workflowClaimId: claimWorkflowSlot.mock.calls[0]?.[0]?.claimId,
      title: 'The Long Walk',
      script: 'INT. HALLWAY — NIGHT',
      // The sequence default, inverted into the payload's render vocabulary.
      referenceOnly: false,
      aspectRatio: '16:9',
      styleConfig: STYLE_CONFIG,
      // Unrecognised model ids on the row fall back to the defaults here, not
      // mid-run.
      analysisModelId: DEFAULT_ANALYSIS_MODEL,
      imageModel: DEFAULT_IMAGE_MODEL,
      videoModel: DEFAULT_VIDEO_MODEL,
      elementIds: ['el_1', 'el_2'],
      // The live cast, frozen here (#2050); this sequence casts nobody yet.
      cast: [],
      // No music prompt on the row yet, so whatever the pipeline writes is a
      // first generation — resolved here, not by a lookup in the grandchild.
      musicPromptSource: 'ai-generated',
      // The picked ids plus the attached ones (#1695): none here.
      suggestedLocationIds: [],
      suggestedLocations: [],
      ownerEmail: 'owner@example.com',
      sequenceUrl: expect.stringMatching(/\/sequences\/seq_1\/scenes$/),
      pendingAutoStyleId: undefined,
      // No stopAt on the trigger and no generationStopAt on the row → flags
      // collapse to images (legacy stills-only).
      stopAt: 'images',
    });
  });

  test('overwrites a caller-supplied workflow claim with the acquired slot', async () => {
    const { scopedDb, claimWorkflowSlot, publishWorkflowInstance } =
      makeScopedDb({
        workflowRunId: null,
      });
    const input = { ...INPUT, workflowClaimId: 'synthetic-untrusted-claim' };

    await triggerStoryboard(scopedDb, input);

    const claimId = claimWorkflowSlot.mock.calls[0]?.[0]?.claimId;
    expect(claimId).toEqual(expect.stringMatching(/^synthetic-prepared-/));
    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workflowRunId: claimId,
        body: expect.objectContaining({ workflowClaimId: claimId }),
      })
    );
    expect(publishWorkflowInstance).toHaveBeenCalledExactlyOnceWith({
      id: 'seq_1',
      claimId,
      workflowRunId: claimId,
    });
  });

  test('pins an explicit stopAt over the sequence snapshot', async () => {
    const { scopedDb } = makeScopedDb({ workflowRunId: null });

    await triggerStoryboard(scopedDb, {
      ...INPUT,
      stopAt: 'references',
    });

    expect(trigger.mock.calls[0]?.[0]?.body).toEqual(
      expect.objectContaining({ stopAt: 'references' })
    );
  });

  test('pins sequence.generationStopAt when the trigger omits stopAt', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: null,
      generationStopAt: 'references',
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(trigger.mock.calls[0]?.[0]?.body).toEqual(
      expect.objectContaining({ stopAt: 'references' })
    );
  });

  test.each([false, true])('snapshots draftMotion=%s', async (draftMotion) => {
    const { scopedDb } = makeScopedDb({ workflowRunId: null, draftMotion });
    await triggerStoryboard(scopedDb, INPUT);
    expect(prepare.mock.calls[0]?.[1].draftMotion).toBe(draftMotion);
    expect(trigger.mock.calls[0]?.[0]?.body.draftMotion).toBe(draftMotion);
  });

  test('uses the sequence-owned style snapshot, not the live catalog row', async () => {
    const snapshot = migrateStyleConfigV1ToV2({
      mood: 'snapshotted mood on the sequence',
      artStyle: 'photoreal cinematic',
      lighting: 'hard key, deep shadows',
      colorPalette: ['#101020', '#e0d0b0'],
      cameraWork: 'handheld, tight lenses',
      referenceFilms: ['Children of Men'],
      colorGrading: 'cool shadows, warm highlights',
    });
    const { scopedDb, getStyleById } = makeScopedDb({
      workflowRunId: null,
      styleConfig: snapshot,
      style: { config: STYLE_CONFIG },
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(getStyleById).not.toHaveBeenCalled();
    expect(trigger.mock.calls[0]?.[0]?.body).toMatchObject({
      styleConfig: snapshot,
    });
  });

  test('automatic style still a placeholder (no snapshot + row bound here) → pendingAutoStyleId on the payload', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: null,
      styleId: 'style_auto',
      styleConfig: null,
      style: { id: 'style_auto', sequenceId: 'seq_1', config: STYLE_CONFIG },
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(trigger.mock.calls[0]?.[0]?.body).toMatchObject({
      pendingAutoStyleId: 'style_auto',
      styleConfig: STYLE_CONFIG,
    });
  });

  test('automatic style already derived (snapshot present) → no pendingAutoStyleId, so a retry never re-derives', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: null,
      styleId: 'style_auto',
      styleConfig: STYLE_CONFIG,
      style: { id: 'style_auto', sequenceId: 'seq_1', config: STYLE_CONFIG },
    });

    await triggerStoryboard(scopedDb, INPUT);

    const payload = trigger.mock.calls[0]?.[0]?.body;
    expect(payload).toMatchObject({ styleConfig: STYLE_CONFIG });
    expect(payload).toHaveProperty('pendingAutoStyleId', undefined);
  });

  test('library style with no snapshot (pre-snapshot row) → no pendingAutoStyleId', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: null,
      styleConfig: null,
      style: { id: 'style_1', sequenceId: null, config: STYLE_CONFIG },
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(trigger.mock.calls[0]?.[0]?.body).toHaveProperty(
      'pendingAutoStyleId',
      undefined
    );
  });

  test('a sequence that already has a music prompt snapshots promptSource=regenerated', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: null,
      musicPrompt: 'warm analog synths, slow build',
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(trigger.mock.calls[0]?.[0]?.body).toMatchObject({
      musicPromptSource: 'regenerated',
    });
  });

  test('snapshots suggested location identity so matching never re-reads it', async () => {
    const { scopedDb, getLocationsByIds } = makeScopedDb({
      workflowRunId: null,
      locations: [{ id: 'loc_1', name: 'Docks', description: null }],
    });

    await triggerStoryboard(scopedDb, {
      ...INPUT,
      suggestedLocationIds: ['loc_1'],
    });

    expect(getLocationsByIds).toHaveBeenCalledWith(['loc_1']);
    expect(trigger.mock.calls[0]?.[0]?.body).toMatchObject({
      suggestedLocations: [
        { locationId: 'loc_1', name: 'Docks', description: null },
      ],
    });
  });

  test('skips the identity reads entirely when nothing is suggested', async () => {
    const { scopedDb, getLocationsByIds } = makeScopedDb({
      workflowRunId: null,
    });

    await triggerStoryboard(scopedDb, INPUT);

    // The read is always made (the attached locations join the set, #1695);
    // with no ids it asks for none.
    expect(getLocationsByIds).toHaveBeenCalledWith([]);
    expect(trigger.mock.calls[0]?.[0]?.body).toMatchObject({
      suggestedLocationIds: [],
      suggestedLocations: [],
    });
  });

  test('the locations the writer attached join the picked ones for matching; analysis-made ones do not (#1695)', async () => {
    const { scopedDb, getLocationsByIds, listLocations } = makeScopedDb({
      workflowRunId: null,
      linkedLocations: [
        { id: 'loc_attached', attached: true },
        { id: 'loc_1', attached: true },
        { id: 'loc_made_here', attached: false },
      ],
      locations: [
        { id: 'loc_1', name: 'Docks', description: null },
        { id: 'loc_attached', name: 'Diner', description: 'chrome' },
      ],
    });

    await triggerStoryboard(scopedDb, {
      ...INPUT,
      suggestedLocationIds: ['loc_1'],
    });

    expect(listLocations).toHaveBeenCalledWith('seq_1');
    // Picked first, then attached; each once.
    expect(getLocationsByIds).toHaveBeenCalledWith(['loc_1', 'loc_attached']);
    expect(trigger.mock.calls[0]?.[0]?.body).toMatchObject({
      suggestedLocationIds: ['loc_1', 'loc_attached'],
      suggestedLocations: [
        { locationId: 'loc_1', name: 'Docks', description: null },
        { locationId: 'loc_attached', name: 'Diner', description: 'chrome' },
      ],
    });
  });

  test('sequence with no script → throws synchronously, nothing claimed or triggered', async () => {
    const { scopedDb, claimWorkflowSlot } = makeScopedDb({
      workflowRunId: null,
      script: '   ',
    });

    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toThrow(
      'Sequence has no script'
    );
    expect(claimWorkflowSlot).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  test('sequence with no style → throws synchronously', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: null,
      styleId: null,
    });

    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toThrow(
      'Sequence has no style selected'
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  test('style row deleted → throws synchronously', async () => {
    const { scopedDb } = makeScopedDb({ workflowRunId: null, style: null });

    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toThrow(
      'No style found'
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  test('no previous run (fresh sequence) → claims against null without a status lookup', async () => {
    runStateResult = null; // would reject if consulted — it must not be

    const { scopedDb, claimWorkflowSlot } = makeScopedDb({
      workflowRunId: null,
    });

    await triggerStoryboard(scopedDb, INPUT);

    expect(claimWorkflowSlot).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRunId: null })
    );
  });

  test('lost CAS race → GenerationInProgressError, nothing triggered', async () => {
    const { scopedDb } = makeScopedDb({
      workflowRunId: 'openstory-so_storyboard_old',
      claimSucceeds: false,
    });

    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toBeInstanceOf(
      GenerationInProgressError
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  test('keeps uncertain dispatch pending with its cause and reserved instance', async () => {
    const original = new Error('Synthetic create response lost');
    trigger.mockRejectedValueOnce(original);
    const db = makeScopedDb({ workflowRunId: null });
    const pending = triggerStoryboard(db.scopedDb, INPUT);
    await expect(pending).rejects.toBeInstanceOf(WorkflowLaunchPendingError);
    await expect(pending).rejects.toMatchObject({
      cause: original,
      workflowRunId: db.claimWorkflowSlot.mock.calls[0]?.[0].claimId,
    });
    expect(db.updateStatus).not.toHaveBeenCalled();
    expect(db.failWorkflowIfCurrent).not.toHaveBeenCalled();
    expect(db.recordSequenceEvent).not.toHaveBeenCalled();
    expect(db.publishWorkflowInstance).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  test('propagates preparation refusal before any claim or failure activity', async () => {
    const original = new Error('Synthetic prepare refusal');
    prepare.mockRejectedValueOnce(original);
    const db = makeScopedDb({ workflowRunId: null });
    await expect(triggerStoryboard(db.scopedDb, INPUT)).rejects.toBe(original);
    expect(db.claimWorkflowSlot).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(db.failWorkflowIfCurrent).not.toHaveBeenCalled();
    expect(db.recordSequenceEvent).not.toHaveBeenCalled();
  });

  test('missing sequenceId → throws before touching the db', async () => {
    const { scopedDb, getForUser } = makeScopedDb({ workflowRunId: null });

    await expect(
      triggerStoryboard(scopedDb, { ...INPUT, sequenceId: undefined })
    ).rejects.toThrow('requires input.sequenceId');
    expect(getForUser).not.toHaveBeenCalled();
  });
});

describe('assertNoActiveStoryboard', () => {
  test('live run → throws', async () => {
    runStateResult = null;
    const { scopedDb } = makeScopedDb({
      workflowRunId: 'openstory-so_storyboard_live',
    });

    await expect(
      assertNoActiveStoryboard(scopedDb, 'seq_1')
    ).rejects.toBeInstanceOf(GenerationInProgressError);
  });

  test('status lookup failed → GenerationStatusUnknownError', async () => {
    runStateResult = 'unknown';
    const { scopedDb } = makeScopedDb({
      workflowRunId: 'openstory-so_storyboard_maybe',
    });

    await expect(
      assertNoActiveStoryboard(scopedDb, 'seq_1')
    ).rejects.toBeInstanceOf(GenerationStatusUnknownError);
  });

  test('terminal run → passes', async () => {
    runStateResult = 'completed';
    const { scopedDb } = makeScopedDb({
      workflowRunId: 'openstory-so_storyboard_done',
    });

    await expect(
      assertNoActiveStoryboard(scopedDb, 'seq_1')
    ).resolves.toBeUndefined();
  });

  test('no recorded run → passes (legacy rows)', async () => {
    runStateResult = null;
    const { scopedDb } = makeScopedDb({ workflowRunId: null });

    await expect(
      assertNoActiveStoryboard(scopedDb, 'seq_1')
    ).resolves.toBeUndefined();
  });
});

test('keeps the stored custom id and routing snapshot through dispatch', async () => {
  const routing = [CUSTOM_ROUTE];
  const { scopedDb } = makeScopedDb({
    workflowRunId: null,
    analysisModel: CUSTOM_ROUTE.modelId,
    routing,
  });
  await triggerStoryboard(scopedDb, INPUT);
  expect(scopedDb.textChannels.getSnapshot).toHaveBeenCalledOnce();
  expect(scopedDb.imageChannels.getSnapshot).toHaveBeenCalledOnce();
  expect(trigger).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        analysisModelId: CUSTOM_ROUTE.modelId,
        modelConfiguration: packModelRuntimeConfiguration({
          ...DEFAULT_MODEL_CONFIGURATION,
          textModelRouting: routing,
          imageModelRouting: [],
        }),
      }),
    })
  );
});

test.each([
  { routing: [] },
  { routing: [{ ...CUSTOM_ROUTE, structuredOutput: false }] },
])(
  'refuses missing or incapable custom routes before claiming work',
  async ({ routing }) => {
    const { scopedDb, claimWorkflowSlot } = makeScopedDb({
      workflowRunId: null,
      analysisModel: CUSTOM_ROUTE.modelId,
      routing,
    });
    await expect(triggerStoryboard(scopedDb, INPUT)).rejects.toThrow(
      'available analysis model'
    );
    expect(claimWorkflowSlot).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  }
);

test('reuses a caller snapshot instead of reading a later route', async () => {
  const { scopedDb } = makeScopedDb({
    workflowRunId: null,
    analysisModel: CUSTOM_ROUTE.modelId,
  });
  const configuration = {
    ...DEFAULT_MODEL_CONFIGURATION,
    textModelRouting: [CUSTOM_ROUTE],
  };
  await triggerStoryboard(scopedDb, INPUT, configuration);
  expect(scopedDb.textChannels.getSnapshot).not.toHaveBeenCalled();
  expect(scopedDb.imageChannels.getSnapshot).not.toHaveBeenCalled();
  expect(prepare.mock.calls[0]?.[2]?.modelConfiguration).toBe(configuration);
  expect(trigger.mock.calls[0]?.[0]?.body.modelConfiguration).toEqual(
    packModelRuntimeConfiguration(configuration)
  );
});
