import { Socket } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import type { MockInstance } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { WorkflowModelConfiguration } from '@/models/model-runtime-configuration';
import { unpackModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { createTestDb } from '@/platform/server/db/test-d1';
import { appMetadata } from '@/platform/server/db/schema';
import { TEST_FAL_PRICING } from '@/billing/fal-pricing-fixture';
import { quoteConfiguredImageRequest } from '@/billing/configured-image-billing';
import type {
  CaptureContext,
  CaptureFault,
  CaptureVersion,
} from './db/sequence-capture.test.fixture';

type SyntheticDispatch = {
  id: string;
  params: StoryboardWorkflowInput & {
    modelConfiguration: WorkflowModelConfiguration;
  };
};
type ResolveSpy = MockInstance<ScopedDb['apiKeys']['resolveLlmKey']>;
const CAPTURE_REFUSALS: Record<CaptureFault, string> = {
  'text-capability':
    'Select an available analysis model that supports structured output.',
  'text-disabled':
    'Select an available analysis model that supports structured output.',
  'image-price': 'No configured image price matches these parameters.',
  'image-capability': 'Configured image model is unavailable.',
  'image-disabled': 'Configured image model is unavailable.',
};
const NETWORK_BLOCKED =
  'Synthetic capture regression blocks all network access.';
let db: Database;
let closeDb: () => Promise<void>;
let socketConnect: MockInstance<Socket['connect']>;

// Synthetic final Workflows/Realtime effects and environment; real creation, claims and billing run below.
const workflowCreate = vi.fn(async ({ id }: SyntheticDispatch) => ({ id }));
const realtimeFetch = vi.fn(async () => new Response(null, { status: 204 }));
const blockedFetch = vi.fn(() => {
  throw new Error(NETWORK_BLOCKED);
});
vi.doMock('#db-client', () => ({ getDb: () => db }));
vi.doMock('#env', () => ({
  getEnv: () => ({
    API_KEY_ENCRYPTION_KEY: 'synthetic-capture-encryption-secret',
    APP_URL: 'https://capture.invalid',
    STORYBOARD_WORKFLOW: { create: workflowCreate },
    REALTIME: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: realtimeFetch }),
    },
  }),
}));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://capture.invalid', {
      headers: { 'cf-ipcountry': 'US' },
    }),
  getRequestHeader: (name: string) =>
    name === 'cf-ipcountry' ? 'US' : undefined,
}));
// Synthetic fixed fal cards keep this probe independent of external pricing refresh.
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => TEST_FAL_PRICING,
}));
vi.doMock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.doMock('@/look/server/bump-style-popularity', () => ({
  bumpStylePopularity: vi.fn(),
}));

// Dynamic owners allow the same probe to be redirected to the frozen baseline.
const { prepareSequenceCreation } = await import('./prepare-sequence-creation');
const { createSequences } = await import('./create-sequences');
const configurationOwner = await import('@/platform/server/db/scoped');
const { llmCostFromUsage } = await import('@/models/server/llm-client');
const {
  CAPTURE,
  CAPTURE_RATES,
  captureInput,
  captureState,
  createCaptureContext: createCaptureContextFixture,
  damageCaptureConfiguration,
  saveCaptureConfiguration,
  saveCaptureHelper,
} = await import('./db/sequence-capture.test.fixture');

function createCaptureContext(
  database: Database,
  balance: number = CAPTURE.startingBalance
) {
  return createCaptureContextFixture(
    database,
    (organizationId, userId) =>
      configurationOwner.createScopedDb(organizationId, userId),
    balance
  );
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
}, 30_000);
afterAll(() => closeDb());
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', blockedFetch);
  socketConnect = vi
    .spyOn(Socket.prototype, 'connect')
    .mockImplementation(() => {
      throw new Error(NETWORK_BLOCKED);
    });
  await db.delete(appMetadata);
  await saveCaptureConfiguration(db, 'A');
});
afterEach(() => {
  expect(blockedFetch).not.toHaveBeenCalled();
  expect(socketConnect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function dispatched(index = 0) {
  const call = workflowCreate.mock.calls[index]?.[0];
  if (!call)
    throw new Error('Expected a synthetic Workflows binding.create call.');
  return {
    ...call,
    models: unpackModelRuntimeConfiguration(call.params.modelConfiguration),
  };
}

async function assertPlatformResolutions(
  resolve: ResolveSpy,
  version: CaptureVersion
) {
  const keys = await Promise.all(
    resolve.mock.results.map((result) => result.value)
  );
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    expect(key).toMatchObject({
      source: 'platform',
      via: 'compatible',
      key: 'synthetic-text-secret-' + version,
    });
    if (key.via !== 'compatible')
      throw new Error('Expected a captured compatible route.');
    expect(llmCostFromUsage(CAPTURE.tokenUsage, key.route.modelId, key)).toBe(
      CAPTURE_RATES[version].textMicros
    );
  }
}

async function assertDispatchConfiguration(
  context: CaptureContext,
  version: CaptureVersion,
  index = 0
) {
  const { models } = dispatched(index);
  const helper = version === 'A' ? CAPTURE.helperA : CAPTURE.helperB;
  const rate = CAPTURE_RATES[version];
  expect(models.sceneSplit).toBe(helper);
  const helperKey = await context.scopedDb.apiKeys.resolveLlmKey(
    helper,
    models.textModelRouting
  );
  expect(helperKey).toMatchObject({
    source: 'platform',
    via: 'compatible',
    key: 'synthetic-text-secret-' + version,
  });
  expect(llmCostFromUsage(CAPTURE.tokenUsage, helper, helperKey)).toBe(
    rate.textMicros
  );
  const image = models.imageModelRouting?.find(
    (route) => route.modelId === CAPTURE.imageA
  );
  if (!image) throw new Error('Expected a captured image route.');
  expect(
    await context.scopedDb.imageChannels.resolveSecret(image.credentialId)
  ).toBe('synthetic-image-secret-' + version);
  expect(
    quoteConfiguredImageRequest({
      model: CAPTURE.imageA,
      imageModelRouting: models.imageModelRouting,
      operation: 'generate',
      aspectRatio: '16:9',
      resolution: '720p',
    })
  ).toMatchObject({
    costMicros: rate.imageMicros,
    parameters: { size: '1024x576' },
    imageSource: 'platform',
  });
  return models;
}

async function assertNoCreation(context: CaptureContext) {
  const state = await captureState(db, context);
  expect(state.rows).toEqual([]);
  expect(state.holds).toEqual([]);
  expect(state.ledger).toEqual([]);
  expect(workflowCreate).not.toHaveBeenCalled();
}

function holdAmount(version: CaptureVersion) {
  return (
    CAPTURE.coarseTextMicros +
    CAPTURE.oneShotImageCount * CAPTURE_RATES[version].imageMicros
  );
}

// G06 capture: real local decisions with synthetic external effects.
it('keeps A routes, rotated credentials, rates, exact image hold and dispatch after stored configuration becomes B', async () => {
  const context = await createCaptureContext(db);
  const load = vi.spyOn(configurationOwner, 'loadModelRuntimeConfiguration');
  const resolve = vi.spyOn(context.scopedDb.apiKeys, 'resolveLlmKey');
  const prepared = await prepareSequenceCreation(captureInput(context));
  expect(load).toHaveBeenCalledOnce();
  await saveCaptureConfiguration(db, 'B');
  const result = await createSequences(prepared.input, {
    ...context,
    modelConfiguration: prepared.modelConfiguration,
  });
  expect(load).toHaveBeenCalledOnce();
  expect(resolve.mock.calls.map(([model]) => model)).toEqual([
    CAPTURE.analysisA,
    CAPTURE.helperA,
  ]);
  await assertPlatformResolutions(resolve, 'A');
  const state = await captureState(db, context);
  expect(state.rows).toMatchObject([
    {
      analysisModel: CAPTURE.analysisA,
      imageModel: CAPTURE.imageA,
      status: 'processing',
    },
  ]);
  expect(state.holds).toMatchObject([
    {
      originalAmount: holdAmount('A'),
      remainingAmount: holdAmount('A'),
      sequenceId: result.sequences[0]?.id,
    },
  ]);
  expect(state.funds[0]?.balance).toBe(CAPTURE.startingBalance);
  expect(state.ledger).toEqual([]);
  expect(dispatched().params.reservationId).toBe(state.holds[0]?.id);
  expect(dispatched().id).toBe(state.rows[0]?.workflowRunId);
  const models = await assertDispatchConfiguration(context, 'A');
  expect(models).toEqual(prepared.modelConfiguration);
});

it('lets the next independent request use B credentials, helper and image card', async () => {
  const first = await createCaptureContext(db);
  const preparedA = await prepareSequenceCreation(captureInput(first));
  await saveCaptureConfiguration(db, 'B');
  await createSequences(preparedA.input, {
    ...first,
    modelConfiguration: preparedA.modelConfiguration,
  });
  const next = await createCaptureContext(db);
  const resolve = vi.spyOn(next.scopedDb.apiKeys, 'resolveLlmKey');
  const preparedB = await prepareSequenceCreation(captureInput(next));
  await createSequences(preparedB.input, {
    ...next,
    modelConfiguration: preparedB.modelConfiguration,
  });
  expect(resolve.mock.calls.map(([model]) => model)).toEqual([
    CAPTURE.analysisB,
    CAPTURE.helperB,
  ]);
  await assertPlatformResolutions(resolve, 'B');
  const state = await captureState(db, next);
  expect(state.rows).toMatchObject([
    { analysisModel: CAPTURE.analysisB, imageModel: CAPTURE.imageB },
  ]);
  expect(state.holds).toMatchObject([{ originalAmount: holdAmount('B') }]);
  await assertDispatchConfiguration(next, 'B', 1);
  const a = dispatched().models;
  const b = dispatched(1).models;
  expect(a.textModelRouting?.[0]?.credentialId).not.toBe(
    b.textModelRouting?.[0]?.credentialId
  );
  expect(a.imageModelRouting?.[0]?.credentialId).not.toBe(
    b.imageModelRouting?.[0]?.credentialId
  );
});

it('preserves explicit selections, de-duplicates analysis/image fanout and funds each independent run', async () => {
  const context = await createCaptureContext(db);
  const prepared = await prepareSequenceCreation(
    captureInput(context, {
      analysisModels: [CAPTURE.analysisB, CAPTURE.analysisA, CAPTURE.analysisB],
      imageModels: [CAPTURE.imageB, CAPTURE.imageA, CAPTURE.imageB],
    })
  );
  await saveCaptureConfiguration(db, 'B');
  const result = await createSequences(prepared.input, {
    ...context,
    modelConfiguration: prepared.modelConfiguration,
  });
  const state = await captureState(db, context);
  expect(result.sequences.map((row) => row.analysisModel)).toEqual([
    CAPTURE.analysisB,
    CAPTURE.analysisA,
  ]);
  expect(state.rows).toHaveLength(2);
  expect(state.holds).toHaveLength(2);
  const expected = holdAmount('A') + CAPTURE_RATES.A.imageMicros;
  expect(state.holds.every((hold) => hold.originalAmount === expected)).toBe(
    true
  );
  expect(new Set(state.holds.map((hold) => hold.idempotencyKey)).size).toBe(2);
  expect(workflowCreate).toHaveBeenCalledTimes(2);
  for (const [index, entry] of result.entries.entries()) {
    expect(dispatched(index).params).toMatchObject({
      sequenceId: entry.sequence.id,
      analysisModelId: entry.sequence.analysisModel,
      imageModels: [CAPTURE.imageB, CAPTURE.imageA],
      imageModel: CAPTURE.imageB,
    });
    expect(
      state.holds.find((hold) => hold.sequenceId === entry.sequence.id)
        ?.idempotencyKey
    ).toBe('storyboard:' + entry.sequence.id);
    expect(
      await context.scopedDb.sequences.getById(entry.sequence.id)
    ).toMatchObject({ workflowRunId: entry.workflowRunId });
    await assertDispatchConfiguration(context, 'A', index);
  }
});

it('retains the original core loader when no trusted configuration is supplied', async () => {
  const context = await createCaptureContext(db);
  const prepared = await prepareSequenceCreation(captureInput(context));
  await saveCaptureConfiguration(db, 'B');
  const textRead = vi.spyOn(context.scopedDb.textChannels, 'getSnapshot');
  const imageRead = vi.spyOn(context.scopedDb.imageChannels, 'getSnapshot');
  const defaultsRead = vi.spyOn(context.scopedDb.modelConfiguration, 'get');
  const resolve = vi.spyOn(context.scopedDb.apiKeys, 'resolveLlmKey');
  await createSequences(prepared.input, context);
  expect(textRead).toHaveBeenCalledOnce();
  expect(imageRead).toHaveBeenCalledOnce();
  expect(defaultsRead).toHaveBeenCalledOnce();
  expect(resolve.mock.calls.map(([model]) => model)).toEqual([
    CAPTURE.analysisA,
    CAPTURE.helperB,
  ]);
  await assertPlatformResolutions(resolve, 'B');
  expect((await captureState(db, context)).holds).toMatchObject([
    { originalAmount: holdAmount('B') },
  ]);
  await assertDispatchConfiguration(context, 'B');
});

it.each<CaptureFault>([
  'text-capability',
  'text-disabled',
  'image-price',
  'image-capability',
  'image-disabled',
])(
  'keeps captured A executable after live %s changes and refuses that state on a fresh request despite organization keys',
  async (fault) => {
    const first = await createCaptureContext(db);
    const prepared = await prepareSequenceCreation(captureInput(first));
    await saveCaptureConfiguration(db, 'B');
    await damageCaptureConfiguration(db, fault);
    await createSequences(prepared.input, {
      ...first,
      modelConfiguration: prepared.modelConfiguration,
    });
    expect((await captureState(db, first)).holds).toMatchObject([
      { originalAmount: holdAmount('A') },
    ]);
    await assertDispatchConfiguration(first, 'A');
    workflowCreate.mockClear();
    const next = await createCaptureContext(db);
    const fresh = await prepareSequenceCreation(
      captureInput(next, {
        analysisModels: [CAPTURE.analysisA],
        imageModels: [CAPTURE.imageA],
      })
    );
    expect(await next.scopedDb.apiKeys.hasUsableKey('fal')).toBe(true);
    expect(await next.scopedDb.apiKeys.hasUsableKey('openrouter')).toBe(true);
    await expect(
      createSequences(fresh.input, {
        ...next,
        modelConfiguration: fresh.modelConfiguration,
      })
    ).rejects.toThrow(CAPTURE_REFUSALS[fault]);
    await assertNoCreation(next);
  }
);

it('requires platform funds for captured custom text despite usable organization keys', async () => {
  const context = await createCaptureContext(db, 0);
  const prepared = await prepareSequenceCreation(
    captureInput(context, {
      imageModels: ['flux_2_turbo'],
      stopAt: 'references',
    })
  );
  const resolve = vi.spyOn(context.scopedDb.apiKeys, 'resolveLlmKey');
  await saveCaptureConfiguration(db, 'B');
  await expect(
    createSequences(prepared.input, {
      ...context,
      modelConfiguration: prepared.modelConfiguration,
    })
  ).rejects.toThrow('Insufficient credits');
  await assertPlatformResolutions(resolve, 'A');
  await assertNoCreation(context);
});

it('checks the captured platform helper when selected analysis uses an organization credential', async () => {
  const context = await createCaptureContext(db, 0);
  const prepared = await prepareSequenceCreation(
    captureInput(context, {
      analysisModels: [CAPTURE.organizationAnalysis],
      imageModels: ['flux_2_turbo'],
      stopAt: 'references',
    })
  );
  const resolve = vi.spyOn(context.scopedDb.apiKeys, 'resolveLlmKey');
  await saveCaptureConfiguration(db, 'B');
  await expect(
    createSequences(prepared.input, {
      ...context,
      modelConfiguration: prepared.modelConfiguration,
    })
  ).rejects.toThrow('Insufficient credits');
  const keys = await Promise.all(
    resolve.mock.results.map((result) => result.value)
  );
  expect(keys.map((key) => key.source)).toEqual(['organization', 'platform']);
  expect(keys[1]).toMatchObject({
    via: 'compatible',
    route: { modelId: CAPTURE.helperA },
  });
  await assertNoCreation(context);
});

it('requires platform image funds even when both text calls use organization credentials', async () => {
  const context = await createCaptureContext(db, 0);
  await saveCaptureHelper(db, CAPTURE.organizationHelper);
  const prepared = await prepareSequenceCreation(
    captureInput(context, { analysisModels: [CAPTURE.organizationAnalysis] })
  );
  const modelConfiguration = prepared.modelConfiguration;
  const resolve = vi.spyOn(context.scopedDb.apiKeys, 'resolveLlmKey');
  await saveCaptureConfiguration(db, 'B');
  await expect(
    createSequences(prepared.input, { ...context, modelConfiguration })
  ).rejects.toThrow('Insufficient credits');
  expect(
    await Promise.all(
      resolve.mock.results.map(async (result) => (await result.value).source)
    )
  ).toEqual(['organization', 'organization']);
  await assertNoCreation(context);
});

it('keeps zero-balance organization coverage when every charged route is organization-owned', async () => {
  const context = await createCaptureContext(db, 0);
  await saveCaptureHelper(db, CAPTURE.organizationHelper);
  const prepared = await prepareSequenceCreation(
    captureInput(context, {
      analysisModels: [CAPTURE.organizationAnalysis],
      imageModels: ['flux_2_turbo'],
      stopAt: 'images',
    })
  );
  const modelConfiguration = prepared.modelConfiguration;
  await saveCaptureConfiguration(db, 'B');
  await createSequences(prepared.input, { ...context, modelConfiguration });
  const state = await captureState(db, context);
  expect(state.rows).toHaveLength(1);
  expect(state.holds).toEqual([]);
  expect(state.ledger).toEqual([]);
  expect(dispatched().params.reservationId).toBeUndefined();
});

it('keeps script-only creation free with no credential resolution or reservation', async () => {
  const context = await createCaptureContext(db, 0);
  const prepared = await prepareSequenceCreation(
    captureInput(context, { stopAt: 'script' })
  );
  const resolve = vi.spyOn(context.scopedDb.apiKeys, 'resolveLlmKey');
  const reserve = vi.spyOn(context.scopedDb.billing, 'createReservation');
  await saveCaptureConfiguration(db, 'B');
  await createSequences(prepared.input, {
    ...context,
    modelConfiguration: prepared.modelConfiguration,
  });
  expect(resolve).not.toHaveBeenCalled();
  expect(reserve).not.toHaveBeenCalled();
  const state = await captureState(db, context);
  expect(state.rows).toHaveLength(1);
  expect(state.holds).toEqual([]);
  expect(state.ledger).toEqual([]);
  expect(dispatched().params).toMatchObject({
    stopAt: 'script',
    analysisModelId: CAPTURE.analysisA,
  });
  expect(dispatched().params.reservationId).toBeUndefined();
});

it('releases the real reservation and records failure when the synthetic final binding refuses dispatch', async () => {
  const context = await createCaptureContext(db);
  const prepared = await prepareSequenceCreation(captureInput(context));
  await saveCaptureConfiguration(db, 'B');
  workflowCreate.mockRejectedValueOnce(new Error('Synthetic binding refusal'));
  await expect(
    createSequences(prepared.input, {
      ...context,
      modelConfiguration: prepared.modelConfiguration,
    })
  ).rejects.toThrow('Synthetic binding refusal');
  const state = await captureState(db, context);
  expect(state.rows).toMatchObject([{ status: 'failed' }]);
  expect(state.holds).toMatchObject([
    { originalAmount: holdAmount('A'), remainingAmount: 0 },
  ]);
  expect(state.funds[0]?.balance).toBe(CAPTURE.startingBalance);
  expect(state.ledger).toEqual([]);
});
