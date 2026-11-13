import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { usdToMicros, ZERO_MICROS } from '@/billing/money';
import type { Microdollars } from '@/billing/money';
import { InsufficientCreditsError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  generatedAssets,
  organization,
  user,
} from '@/platform/server/db/schema';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { studioCreateInputSchema } from '@/studio/schema';
import type { StudioCreateInput } from '@/studio/schema';
import type { StudioGenerationWorkflowInput } from '@/platform/server/workflow/types';

type ImageInput = Extract<StudioCreateInput, { activity: 'image' }>;
type TriggerOptions = Parameters<
  typeof import('@/platform/server/workflow/client').triggerWorkflow
>[2];
type Dispatch = (
  path: string,
  input: StudioGenerationWorkflowInput,
  options?: TriggerOptions
) => Promise<string>;
type WalletReserve = ScopedDb['billing']['createReservation'];

const CUSTOM_MODEL = 'custom-image:qwen';
const BUILTIN_MODEL = 'gpt_image_2';
const BOUND_MODELS = [CUSTOM_MODEL, BUILTIN_MODEL] as const;
const REQUEST = {
  ipAddress: '203.0.113.9',
  userAgent: 'studio-contract-test',
  promptLocale: 'zh-CN',
} as const;
const REFERENCES = [
  'https://example.test/mock-room.png',
  'https://example.test/mock-desk.png',
];
const MASK = 'https://example.test/mock-mask.png';
const START_FAILURE_MESSAGE =
  "This image couldn't start. You weren't charged. Try again.";
const NATIVE_COUNT = 2;
const OUTER_COUNT = 4;
const MOCK_SPECS = [
  {
    aspectRatio: '16:9',
    resolution: '720p',
    size: '1280x720',
    generate: 0.11,
    edit: 0.21,
  },
  {
    aspectRatio: '16:9',
    resolution: '1080p',
    size: '1920x1080',
    generate: 0.39,
    edit: 0.49,
  },
  {
    aspectRatio: '9:16',
    resolution: '1080p',
    size: '1080x1920',
    generate: 0.59,
    edit: 0.69,
  },
] as const;
const LANDSCAPE = MOCK_SPECS[0];
const events: string[] = [];
const holds = new Map<string, Microdollars>();
let fixture: Awaited<ReturnType<typeof createTestDb>>;
let configuration: ModelRuntimeConfiguration;
let scope: ScopedDb;
let reserveAttempts = 0;
let refuseReserveAt: number | undefined;

// Synthetic configuration, balance, compliance, dispatch and R2; generated rows use real D1.
const loadConfiguration = vi.fn<() => Promise<ModelRuntimeConfiguration>>();
const dispatch = vi.fn<Dispatch>();
const rights =
  vi.fn<
    typeof import('@/cast/server/upload-check').requireCheckedUploadRights
  >();
const compliance =
  vi.fn<
    typeof import('@/platform/server/compliance/generation-gate').requireGenerationAllowed
  >();
const pricing =
  vi.fn<
    typeof import('@/billing/server/fal-pricing-live').getEffectiveFalPricing
  >();
const productEvent = vi.fn();
const storage = vi.fn(async () => {
  throw new Error('Studio create must not access R2.');
});

vi.doMock('#db-client', () => ({ getDb: () => fixture.db }));
vi.doMock('@/platform/server/db/scoped', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/server/db/scoped')>()),
  loadModelRuntimeConfiguration: loadConfiguration,
}));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: dispatch,
}));
vi.doMock('@/platform/server/compliance/generation-gate', () => ({
  requireGenerationAllowed: compliance,
}));
vi.doMock('@/cast/server/upload-check', () => ({
  requireCheckedUploadRights: rights,
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: pricing,
}));
vi.doMock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: productEvent,
}));
vi.doMock('#storage', () => ({
  readStorageObject: storage,
  readStorageStream: storage,
  storageObjectSize: storage,
  storageObjectContentType: storage,
  uploadFile: storage,
}));

const { createScopedDb } = await import('@/platform/server/db/scoped');
const { createStudioAssets } = await import('./create-studio-asset');
const { prepareConfiguredImageBilling } =
  await import('@/billing/server/configured-image-billing');
const ORGANIZATION_ID = generateId();
const USER_ID = generateId();

function configuredRuntime(
  model: (typeof BOUND_MODELS)[number] = CUSTOM_MODEL
): ModelRuntimeConfiguration {
  const source = imageConfigurationFixture();
  const binding = source.models[0];
  if (!binding) throw new Error('Missing synthetic image binding');
  binding.id = model;
  binding.parameters = [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: false,
      values: MOCK_SPECS.map((spec) => spec.size),
    },
    {
      key: 'n',
      label: 'Native count',
      type: 'integer',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: false,
      defaultValue: 1,
      values: [1, NATIVE_COUNT, OUTER_COUNT],
    },
    {
      key: 'quality',
      label: 'Quality',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: false,
      defaultValue: 'standard',
      values: ['standard'],
    },
  ];
  binding.priceCards = (['generate', 'edit'] as const).flatMap((operation) =>
    MOCK_SPECS.map((spec) => ({
      id: `${operation}-${spec.size}`,
      operation,
      match: { size: spec.size, quality: 'standard' },
      unitPriceUsd: spec[operation],
    }))
  );
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: createImageModelRoutingSnapshot(source),
  };
}

function route() {
  const value = configuration.imageModelRouting?.[0];
  if (!value) throw new Error('Missing synthetic captured route');
  return value;
}

function imageInput(overrides: Partial<ImageInput> = {}): ImageInput {
  const input = studioCreateInputSchema.parse({
    activity: 'image',
    prompt: 'Synthetic empty room / 保留用户原文。',
    imageModel: CUSTOM_MODEL,
    aspectRatio: LANDSCAPE.aspectRatio,
    resolution: LANDSCAPE.resolution,
    ...overrides,
  });
  if (input.activity !== 'image') throw new Error('Expected image fixture');
  return input;
}

async function reserveMock(
  ...[amount, options]: Parameters<WalletReserve>
): ReturnType<WalletReserve> {
  reserveAttempts += 1;
  events.push(`reserve:${options.idempotencyKey}`);
  if (reserveAttempts === refuseReserveAt) return { ok: false };
  const reservationId = generateId();
  holds.set(reservationId, amount);
  return { ok: true, reservationId, remaining: amount, replay: false };
}

function observeAssets(scopedDb: ScopedDb) {
  const insert = scopedDb.generatedAssets.insert;
  const setRun = scopedDb.generatedAssets.setWorkflowRunId;
  const markFailed = scopedDb.generatedAssets.markFailed;
  vi.spyOn(scopedDb.generatedAssets, 'insert').mockImplementation(
    async (input) => {
      events.push(`insert:${input.id}`);
      return insert(input);
    }
  );
  vi.spyOn(scopedDb.generatedAssets, 'setWorkflowRunId').mockImplementation(
    async (id, runId) => {
      events.push(`setRun:${id}`);
      return setRun(id, runId);
    }
  );
  vi.spyOn(scopedDb.generatedAssets, 'markFailed').mockImplementation(
    async (...args) => {
      events.push(`failed:${args[0]}`);
      return markFailed(...args);
    }
  );
}

function createScope() {
  const scopedDb = createScopedDb(ORGANIZATION_ID, USER_ID);
  vi.spyOn(scopedDb.billing, 'createReservation').mockImplementation(
    reserveMock
  );
  vi.spyOn(scopedDb.billing, 'zeroReservation').mockImplementation(
    async (id) => {
      events.push(`zero:${id}`);
      holds.set(id, ZERO_MICROS);
    }
  );
  vi.spyOn(scopedDb.apiKeys, 'hasUsableKey').mockRejectedValue(
    new Error('Configured images must not inspect organization provider keys.')
  );
  observeAssets(scopedDb);
  return scopedDb;
}

function storedInput(input: ImageInput) {
  return {
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    imageModel: input.imageModel,
    count: input.count,
    ...(input.channelParameters
      ? { channelParameters: input.channelParameters }
      : {}),
    ...(input.maskImageUrl ? { maskImageUrl: input.maskImageUrl } : {}),
    ...(input.referenceImages.length > 0
      ? { referenceImages: input.referenceImages }
      : {}),
  };
}

function queuedRows() {
  return fixture.db.select().from(generatedAssets).orderBy(generatedAssets.id);
}

function expectNoQueue() {
  expect(scope.billing.createReservation).not.toHaveBeenCalled();
  expect(scope.generatedAssets.insert).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(holds.size).toBe(0);
}

function expectWorkflow(
  index: number,
  assetId: string,
  expectedInput: ImageInput,
  captured: ModelRuntimeConfiguration
) {
  const call = dispatch.mock.calls[index];
  if (!call) throw new Error('Missing dispatched workflow');
  const [path, payload, options] = call;
  expect(path).toBe('/studio');
  expect(payload).toEqual({
    promptLocale: REQUEST.promptLocale,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    assetId,
    reservationId: expect.any(String),
    ownsReservation: true,
    input: expectedInput,
    noPersonImages: [],
  });
  expect(options).toEqual({
    deduplicationId: `studio-${assetId}`,
    modelConfiguration: captured,
  });
  expect(options?.modelConfiguration).toBe(captured);
  expect(scope.billing.createReservation).toHaveBeenNthCalledWith(
    index + 1,
    expect.any(Number),
    { idempotencyKey: `studio:${assetId}`, sequenceId: undefined }
  );
}

function expectReservationCost(cost: Microdollars, count: number) {
  expect(scope.billing.createReservation).toHaveBeenCalledTimes(count);
  for (const [amount] of vi.mocked(scope.billing.createReservation).mock.calls)
    expect(amount).toBe(cost);
}

beforeAll(async () => {
  fixture = await createTestDb();
  await fixture.db.insert(user).values({
    id: USER_ID,
    name: 'Mock creator',
    email: 'studio-contract@example.test',
  });
  await fixture.db.insert(organization).values({
    id: ORGANIZATION_ID,
    name: 'Mock studio',
    slug: 'mock-configured-studio',
  });
});
afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await fixture.db.delete(generatedAssets);
  events.length = 0;
  holds.clear();
  reserveAttempts = 0;
  refuseReserveAt = undefined;
  configuration = configuredRuntime();
  loadConfiguration.mockImplementation(async () => {
    events.push('configuration');
    return configuration;
  });
  pricing.mockImplementation(async () => {
    events.push('pricing');
    return {};
  });
  compliance.mockImplementation(async () => {
    events.push('compliance');
  });
  rights.mockImplementation(async () => {
    events.push('rights');
    return new Map();
  });
  dispatch.mockImplementation(async (_path, input) => {
    events.push(`dispatch:${input.assetId}`);
    return `mock-run-${input.assetId}`;
  });
  scope = createScope();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Configured Studio contracts forbid network and provider calls.')
  );
});
afterEach(() => {
  expect(storage).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('configured Studio create across quote, D1 and dispatch', () => {
  it.each(BOUND_MODELS)(
    'captures generate endpoint, price, scope and configuration for %s',
    async (model) => {
      configuration = configuredRuntime(model);
      const captured = configuration;
      const input = imageInput({ imageModel: model });
      const result = await createStudioAssets(scope, input, REQUEST);
      const [row] = await queuedRows();
      expect(row).toMatchObject({
        id: result.assets[0]?.id,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        provider: 'compatible',
        endpointId: 'mock-generate',
        modelName: 'Configured Qwen',
        source: 'studio',
        activity: 'image',
        status: 'queued',
        costMicros: null,
        workflowRunId: `mock-run-${row?.id}`,
        input: storedInput({
          ...input,
          channelParameters: {
            size: LANDSCAPE.size,
            n: 1,
            quality: 'standard',
          },
        }),
      });
      expect(result.assets).toEqual([
        { id: row?.id, workflowRunId: row?.workflowRunId },
      ]);
      if (!row) throw new Error('Expected stored image');
      expectWorkflow(
        0,
        row.id,
        {
          ...input,
          channelParameters: {
            size: LANDSCAPE.size,
            n: 1,
            quality: 'standard',
          },
        },
        captured
      );
      expectReservationCost(usdToMicros(LANDSCAPE.generate), 1);
      expect(events).toEqual([
        'configuration',
        'pricing',
        'compliance',
        'rights',
        `reserve:studio:${row.id}`,
        `insert:${row.id}`,
        `dispatch:${row.id}`,
        `setRun:${row.id}`,
      ]);
      expect(loadConfiguration).toHaveBeenCalledOnce();
      expect(scope.apiKeys.hasUsableKey).not.toHaveBeenCalled();
      expect(holds.get(dispatch.mock.calls[0]?.[1].reservationId ?? '')).toBe(
        usdToMicros(LANDSCAPE.generate)
      );
    }
  );

  it.each(BOUND_MODELS)(
    'keeps ordered edit references and mask on %s',
    async (model) => {
      configuration = configuredRuntime(model);
      const input = imageInput({
        imageModel: model,
        referenceImages: REFERENCES,
        maskImageUrl: MASK,
        channelParameters: { n: NATIVE_COUNT },
      });
      const original = structuredClone(input);
      await createStudioAssets(scope, input, REQUEST);
      const [row] = await queuedRows();
      expect(row).toMatchObject({
        provider: 'compatible',
        endpointId: 'mock-edit',
        input: storedInput({
          ...input,
          channelParameters: {
            n: NATIVE_COUNT,
            size: LANDSCAPE.size,
            quality: 'standard',
          },
        }),
      });
      expect(rights).toHaveBeenCalledWith(
        scope,
        [...REFERENCES, MASK],
        REQUEST,
        REQUEST.promptLocale
      );
      expect(compliance).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
      });
      if (!row) throw new Error('Expected stored edit');
      expectWorkflow(
        0,
        row.id,
        {
          ...input,
          channelParameters: {
            n: NATIVE_COUNT,
            size: LANDSCAPE.size,
            quality: 'standard',
          },
        },
        configuration
      );
      expectReservationCost(usdToMicros(LANDSCAPE.edit * NATIVE_COUNT), 1);
      expect(input).toEqual(original);
    }
  );

  it('reserves count requests at native n cost without multiplying the row or workflow count', async () => {
    const input = imageInput({
      count: OUTER_COUNT,
      channelParameters: { n: NATIVE_COUNT },
    });
    const result = await createStudioAssets(scope, input, REQUEST);
    const rows = await queuedRows();
    expect(rows).toHaveLength(OUTER_COUNT);
    expect(result.assets).toHaveLength(OUTER_COUNT);
    expect(dispatch).toHaveBeenCalledTimes(OUTER_COUNT);
    expectReservationCost(
      usdToMicros(LANDSCAPE.generate * NATIVE_COUNT),
      OUTER_COUNT
    );
    expect(new Set(holds.keys()).size).toBe(OUTER_COUNT);
    const lastReserve = events
      .map((event) => event.startsWith('reserve:'))
      .lastIndexOf(true);
    const firstInsert = events.findIndex((event) =>
      event.startsWith('insert:')
    );
    expect(lastReserve).toBeLessThan(firstInsert);
    rows.forEach((row, index) => {
      const expectedInput = {
        ...input,
        channelParameters: {
          n: NATIVE_COUNT,
          size: LANDSCAPE.size,
          quality: 'standard',
        },
      };
      expect(row.input).toEqual(storedInput(expectedInput));
      expectWorkflow(index, row.id, expectedInput, configuration);
    });
    expect(
      new Set(dispatch.mock.calls.map(([, payload]) => payload.reservationId))
        .size
    ).toBe(OUTER_COUNT);
  });

  it.each(MOCK_SPECS)(
    'prices and persists effective $aspectRatio / $resolution parameters',
    async (spec) => {
      const input = imageInput({
        aspectRatio: spec.aspectRatio,
        resolution: spec.resolution,
      });
      const quote = await prepareConfiguredImageBilling({
        model: input.imageModel,
        modelConfiguration: configuration,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        referenceImageCount: 0,
      });
      expect(quote).toMatchObject({
        priceCardId: `generate-${spec.size}`,
        costMicros: usdToMicros(spec.generate),
        parameters: { size: spec.size, n: 1, quality: 'standard' },
      });
      await createStudioAssets(scope, input, REQUEST);
      const [row] = await queuedRows();
      expect(row?.input.channelParameters).toEqual(quote?.parameters);
      expect(dispatch.mock.calls[0]?.[1].input).toEqual({
        ...input,
        channelParameters: quote?.parameters,
      });
      expectReservationCost(usdToMicros(spec.generate), 1);
      expect(loadConfiguration).toHaveBeenCalledOnce();
    }
  );

  it('passes the same captured configuration to every child after live settings change', async () => {
    const captured = configuration;
    const input = imageInput({ count: NATIVE_COUNT });
    dispatch.mockImplementationOnce(async (_path, payload) => {
      events.push(`dispatch:${payload.assetId}`);
      configuration = configuredRuntime(BUILTIN_MODEL);
      return `mock-run-${payload.assetId}`;
    });
    await createStudioAssets(scope, input, REQUEST);
    const rows = await queuedRows();
    expect(loadConfiguration).toHaveBeenCalledOnce();
    expect(configuration).not.toBe(captured);
    rows.forEach((row, index) =>
      expectWorkflow(
        index,
        row.id,
        {
          ...input,
          channelParameters: {
            size: LANDSCAPE.size,
            n: 1,
            quality: 'standard',
          },
        },
        captured
      )
    );
  });

  it.each(['references', 'mask', 'native-count', 'inactive'] as const)(
    'refuses invalid configured %s before rights, holds or rows',
    async (failure) => {
      const input = imageInput({
        referenceImages: REFERENCES,
        maskImageUrl: MASK,
      });
      const edit = route().operations.edit;
      if (!edit) throw new Error('Expected edit fixture');
      if (failure === 'references') edit.maxReferenceImages = 1;
      if (failure === 'mask') edit.mask = 'unsupported';
      if (failure === 'native-count') input.channelParameters = { n: 3 };
      if (failure === 'inactive') configuration.imageModelRouting = [];
      await expect(createStudioAssets(scope, input, REQUEST)).rejects.toThrow();
      expectNoQueue();
      expect(await queuedRows()).toEqual([]);
      expect(rights).not.toHaveBeenCalled();
      expect(compliance).not.toHaveBeenCalled();
    }
  );
});

describe('configured Studio create failure ownership', () => {
  it('refuses compliance before the rights gate or any reservation', async () => {
    const error = new Error('Mock compliance refusal');
    compliance.mockRejectedValueOnce(error);
    await expect(createStudioAssets(scope, imageInput(), REQUEST)).rejects.toBe(
      error
    );
    expect(rights).not.toHaveBeenCalled();
    expectNoQueue();
    expect(await queuedRows()).toEqual([]);
  });

  it('refuses unchecked references and masks before any reservation', async () => {
    const error = new Error('Mock upload rights refusal');
    rights.mockRejectedValueOnce(error);
    const input = imageInput({
      referenceImages: REFERENCES,
      maskImageUrl: MASK,
    });
    await expect(createStudioAssets(scope, input, REQUEST)).rejects.toBe(error);
    expect(rights).toHaveBeenCalledWith(
      scope,
      [...REFERENCES, MASK],
      REQUEST,
      REQUEST.promptLocale
    );
    expectNoQueue();
    expect(await queuedRows()).toEqual([]);
  });

  it.each([NATIVE_COUNT, OUTER_COUNT])(
    'clears earlier holds and creates no row when reserve %i fails',
    async (failedAttempt) => {
      refuseReserveAt = failedAttempt;
      const input = imageInput({
        count: OUTER_COUNT,
        channelParameters: { n: NATIVE_COUNT },
      });
      await expect(
        createStudioAssets(scope, input, REQUEST)
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
      expectReservationCost(
        usdToMicros(LANDSCAPE.generate * NATIVE_COUNT),
        failedAttempt
      );
      expect(holds.size).toBe(failedAttempt - 1);
      expect([...holds.values()]).toEqual(
        Array.from({ length: failedAttempt - 1 }, () => ZERO_MICROS)
      );
      expect(scope.billing.zeroReservation).toHaveBeenCalledTimes(
        failedAttempt - 1
      );
      expect(await queuedRows()).toEqual([]);
      expect(scope.generatedAssets.insert).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(productEvent).not.toHaveBeenCalled();
    }
  );

  it('keeps started rows and holds but clears the failed and unstarted holds on dispatch failure', async () => {
    const failure = new Error('Mock second dispatch failed');
    dispatch
      .mockResolvedValueOnce('mock-started-run')
      .mockRejectedValueOnce(failure);
    const input = imageInput({
      count: OUTER_COUNT,
      channelParameters: { n: NATIVE_COUNT },
    });
    await expect(createStudioAssets(scope, input, REQUEST)).rejects.toBe(
      failure
    );
    const rows = await queuedRows();
    expect(rows).toHaveLength(NATIVE_COUNT);
    const [started, failed] = rows;
    expect(started).toMatchObject({
      status: 'queued',
      workflowRunId: 'mock-started-run',
      error: null,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      workflowRunId: null,
      error: START_FAILURE_MESSAGE,
    });
    expect(dispatch).toHaveBeenCalledTimes(NATIVE_COUNT);
    expect(scope.generatedAssets.markFailed).toHaveBeenCalledExactlyOnceWith(
      failed?.id,
      START_FAILURE_MESSAGE
    );
    const startedHold = dispatch.mock.calls[0]?.[1].reservationId;
    expect(startedHold).toBeDefined();
    expect(holds.get(startedHold ?? '')).toBe(
      usdToMicros(LANDSCAPE.generate * NATIVE_COUNT)
    );
    expect(
      [...holds.entries()]
        .filter(([id]) => id !== startedHold)
        .map(([, amount]) => amount)
    ).toEqual(Array.from({ length: OUTER_COUNT - 1 }, () => ZERO_MICROS));
    expect(scope.billing.zeroReservation).not.toHaveBeenCalledWith(startedHold);
    expect(scope.billing.zeroReservation).toHaveBeenCalledTimes(
      OUTER_COUNT - 1
    );
    expect(scope.generatedAssets.insert).toHaveBeenCalledTimes(NATIVE_COUNT);
    expect(productEvent).not.toHaveBeenCalled();
  });

  it('returns the actual started run when persisting its run id fails', async () => {
    vi.mocked(scope.generatedAssets.setWorkflowRunId).mockRejectedValueOnce(
      new Error('Mock D1 run-id write failure')
    );
    dispatch.mockResolvedValueOnce('mock-real-started-run');
    const result = await createStudioAssets(scope, imageInput(), REQUEST);
    const [row] = await queuedRows();
    expect(result.assets).toEqual([
      { id: row?.id, workflowRunId: 'mock-real-started-run' },
    ]);
    expect(row).toMatchObject({
      status: 'queued',
      workflowRunId: null,
      error: null,
    });
    expect(scope.generatedAssets.markFailed).not.toHaveBeenCalled();
    expect(scope.billing.zeroReservation).not.toHaveBeenCalled();
    expect([...holds.values()]).toEqual([usdToMicros(LANDSCAPE.generate)]);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(productEvent).toHaveBeenCalledOnce();
  });
});
