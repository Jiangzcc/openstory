import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { SheetPortraitWorkflowInput } from '@/platform/server/workflow/types';
import type {
  ImageGenerationParams,
  ImageGenerationOptions,
} from '@/stills/server/image-generation';
import type {
  ImageAttemptIdentity,
  ImageGenerationAttempt,
  StoredChannelGeneration,
} from '@/stills/server/configured-image-attempt';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import {
  createImageModelRoutingSnapshot,
  usesConfiguredImageChannel,
} from '@/models/image-channels';
import { MOCK_IMAGE_BASE64 } from '@/stills/server/compatible-image-test-fixtures';
import { usdToMicros } from '@/billing/money';
import { asStub } from '@/test/as-stub';
import { generateConfiguredImage } from '@/stills/server/configured-image-generation';
const mocks = vi.hoisted(() => ({
  supplier: vi.fn(),
  native: vi.fn(),
  nativeStore: vi.fn(),
  upload: vi.fn(),
  provenance: vi.fn(),
  deduct: vi.fn(),
  remove: vi.fn(),
  emit: vi.fn(),
}));
// Mock provider, native route, R2 and ledger writes; execute real configured adapter and tracked steps.
vi.mock('@/stills/server/compatible-image-client', () => ({
  generateCompatibleImages: mocks.supplier,
}));
vi.mock('@/stills/server/configured-image-references', () => ({
  configuredImageReferenceFiles: async () => [],
}));
vi.mock('@/stills/server/image-generation', () => ({
  generateImageWithProvider: (
    params: ImageGenerationParams,
    options?: ImageGenerationOptions
  ) =>
    usesConfiguredImageChannel(
      params.model,
      options?.credentials?.imageModelRouting
    )
      ? generateConfiguredImage(params, options)
      : mocks.native(params, options),
}));
vi.mock('@/stills/server/image-storage', () => ({
  storeGeneratedPng: mocks.nativeStore,
}));
vi.mock('@/platform/server/storage/upload-response', () => ({
  uploadResponse: mocks.upload,
}));
vi.mock('#storage', () => ({ deleteFile: mocks.remove }));
vi.mock('@/platform/server/compliance/provenance', () => ({
  recordProvenance: mocks.provenance,
}));
vi.mock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => new Map(),
}));
vi.mock('@/billing/server/workflow-deduction', async (original) => ({
  ...(await original<typeof import('@/billing/server/workflow-deduction')>()),
  deductWorkflowCredits: mocks.deduct,
}));
vi.mock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: mocks.emit }),
}));
import { SheetPortraitWorkflow } from '../workflows/sheet-portrait-workflow';
import { runSheetPortraitStep } from './sheet-portrait-step';
const COST = usdToMicros(0.2);
const HOLD = 'mock-portrait-hold';
const INPUT = {
  userId: 'mock-user',
  organizationId: 'mock-org',
  subject: {
    kind: 'character',
    characterId: 'mock-character',
    lookId: 'mock-look',
  },
  versionId: 'mock-version',
  sheetUrl: '/r2/characters/mock-org/sheet.png',
  storageDir: 'org/mock-org/characters/mock-character',
} satisfies SheetPortraitWorkflowInput;
const EVENT: WorkflowEvent<SheetPortraitWorkflowInput> = {
  payload: INPUT,
  instanceId: 'mock-portrait-run',
  timestamp: new Date(0),
  workflowName: 'mock-portrait',
};
class Probe extends SheetPortraitWorkflow {
  execute(step: WorkflowStep, db: WorkflowScopedDb, event = EVENT) {
    return this.runImpl(event, step, db);
  }
}
function workflow() {
  type Ctor = ConstructorParameters<typeof Probe>;
  return new Probe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}
function mockStep() {
  const checkpoints = new Map<string, unknown>();
  let active: string | undefined;
  async function doStep(
    name: string,
    options: object | (() => Promise<unknown>),
    callback?: () => Promise<unknown>
  ) {
    if (checkpoints.has(name)) return structuredClone(checkpoints.get(name));
    const execute = typeof options === 'function' ? options : callback;
    if (!execute) throw new Error('Missing Mock step callback.');
    active = name;
    try {
      const value = await execute();
      checkpoints.set(name, structuredClone(value));
      return value;
    } finally {
      active = undefined;
    }
  }
  return {
    step: asStub<WorkflowStep>({ do: doStep }),
    checkpoints,
    active: () => active,
  };
}
function mockAttempts() {
  const rows = new Map<string, ImageGenerationAttempt>();
  const getById = async (identity: ImageAttemptIdentity) =>
    rows.get(identity.id);
  const claim = vi.fn(async (identity: ImageAttemptIdentity) => {
    const existing = rows.get(identity.id);
    if (existing) return { claimed: false, attempt: existing };
    const attempt: ImageGenerationAttempt = {
      ...identity,
      status: 'submitted',
    };
    rows.set(identity.id, attempt);
    return { claimed: true, attempt };
  });
  const complete = vi.fn(
    async (identity: ImageAttemptIdentity, result: StoredChannelGeneration) => {
      rows.set(identity.id, { ...identity, status: 'stored', result });
    }
  );
  const markUnknown = vi.fn(async (identity: ImageAttemptIdentity) => {
    rows.set(identity.id, { ...identity, status: 'unknown' });
  });
  return { getById, claim, complete, markUnknown, rows };
}
function mockPortraitStorage(execution: ReturnType<typeof mockStep>) {
  mocks.supplier.mockImplementation(async () => {
    expect(execution.active()).toBe('draw-portrait');
    return {
      images: [
        {
          dataUrl: 'data:image/png;base64,' + MOCK_IMAGE_BASE64.png,
          width: 512,
          height: 512,
          mimeType: 'image/png',
          byteLength: 95,
        },
      ],
      requestedCount: 1,
      actualCount: 1,
      returnedCount: 1,
      status: 'complete',
      mismatches: [],
      reported: {},
      requestId: 'mock-request',
    };
  });
  mocks.upload.mockImplementation(async (_response, bucket, path) => {
    expect(execution.active()).toBe('draw-portrait');
    return {
      publicUrl: '/r2/' + bucket + '/' + path,
      path,
      fullPath: bucket + '/' + path,
    };
  });
}
function harness(bound = true) {
  const config = imageConfigurationFixture();
  const model = config.models[0];
  if (!model) throw new Error('Missing Mock binding.');
  model.id = 'nano_banana_2_lite';
  const imageModelRouting = bound
    ? createImageModelRoutingSnapshot(config)
    : [];
  const execution = mockStep();
  const attempts = mockAttempts();
  const createReservation = vi.fn(async () => ({
    ok: true as const,
    reservationId: HOLD,
    remaining: COST,
    replay: false,
  }));
  const zeroReservation = vi.fn(async () => {});
  const select = vi.fn(async () => {});
  const db = asStub<WorkflowScopedDb>({
    organizationId: INPUT.organizationId,
    models: { imageModelRouting },
    credentials: {
      userId: INPUT.userId,
      organizationId: INPUT.organizationId,
      imageModelRouting,
      resolveImageChannelKey: async () => 'mock-platform-secret',
    },
    provenance: {},
    imageGenerationAttempts: attempts,
    claims: { imageGenerationAttempts: attempts },
    liveRead: { billing: { hasEnoughCredits: async () => true } },
    billing: { createReservation, zeroReservation },
    characterSheetVariants: { setPortrait: select },
    locationSheetVariants: { setPortrait: select },
  });
  mockPortraitStorage(execution);
  return {
    ...execution,
    db,
    attempts,
    createReservation,
    zeroReservation,
    select,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.deduct.mockResolvedValue(undefined);
  mocks.provenance.mockResolvedValue('mock-audit');
  mocks.native.mockResolvedValue({
    imageUrls: ['https://mock-provider.test/result.png'],
    metadata: { usedOwnKey: false, cost: COST },
    via: 'google',
  });
  mocks.nativeStore.mockResolvedValue({
    url: '/r2/characters/mock-org/native.png',
    path: 'mock-org/native.png',
  });
});
it('draws a bound portrait through a real attempt, stores/audits inside its generation step, then charges and selects', async () => {
  const run = harness();
  const result = await workflow().execute(run.step, run.db);
  expect(result.portraitUrl).toMatch(/^\/r2\/characters\//);
  expect(run.createReservation).toHaveBeenCalledWith(COST, {
    idempotencyKey: EVENT.instanceId + ':portrait-hold',
    sequenceId: undefined,
  });
  expect(run.attempts.claim).toHaveBeenCalledWith(
    expect.objectContaining({
      id: EVENT.instanceId + ':draw-portrait',
      model: 'nano_banana_2_lite',
    })
  );
  expect(mocks.supplier).toHaveBeenCalledTimes(1);
  expect(mocks.native).not.toHaveBeenCalled();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.provenance).toHaveBeenCalledTimes(1);
  expect(mocks.deduct).toHaveBeenCalledWith(
    expect.objectContaining({
      costMicros: COST,
      reservationId: HOLD,
      idempotencyKey: EVENT.instanceId + ':portrait',
    })
  );
  expect(mocks.provenance.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.deduct.mock.invocationCallOrder[0] ?? 0
  );
  expect(run.zeroReservation).toHaveBeenCalledWith(HOLD);
  expect(run.select).toHaveBeenCalledWith(INPUT.versionId, result.portraitUrl);
  expect(JSON.stringify([...run.checkpoints.values()])).not.toContain(
    'data:image'
  );
  expect(JSON.stringify([...run.checkpoints.values()])).not.toContain(
    'mock-platform-secret'
  );
});
it('retries only the existing idempotent charge after a ledger failure', async () => {
  const run = harness();
  mocks.deduct.mockRejectedValueOnce(new Error('Mock ledger unavailable'));
  await expect(workflow().execute(run.step, run.db)).rejects.toThrow(
    'Mock ledger unavailable'
  );
  expect(run.zeroReservation).not.toHaveBeenCalled();
  expect(run.select).not.toHaveBeenCalled();
  await workflow().execute(run.step, run.db);
  expect(mocks.supplier).toHaveBeenCalledTimes(1);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(run.attempts.claim).toHaveBeenCalledTimes(1);
  expect(mocks.deduct).toHaveBeenCalledTimes(2);
  expect(run.zeroReservation).toHaveBeenCalledWith(HOLD);
});
it('returns no portrait and charges nothing after an unknown provider failure', async () => {
  const run = harness();
  mocks.supplier.mockRejectedValueOnce(new Error('Mock connection lost'));
  const result = await workflow().execute(run.step, run.db);
  expect(result.portraitUrl).toBeNull();
  expect(mocks.deduct).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(run.zeroReservation).toHaveBeenCalledWith(HOLD);
  expect([...run.attempts.rows.values()][0]?.status).toBe('unknown');
});
it('deletes an unaudited bound image, releases its hold and does not charge', async () => {
  const run = harness();
  mocks.provenance.mockRejectedValueOnce(new Error('Mock audit unavailable'));
  expect((await workflow().execute(run.step, run.db)).portraitUrl).toBeNull();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  expect(run.zeroReservation).toHaveBeenCalledWith(HOLD);
  expect(mocks.deduct).not.toHaveBeenCalled();
});
it('keeps an unbound portrait on the original step, provider, storage and charge path', async () => {
  const run = harness(false);
  await workflow().execute(run.step, run.db);
  expect(mocks.native).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'nano_banana_2_lite' }),
    { credentials: run.db.credentials }
  );
  expect(mocks.nativeStore).toHaveBeenCalledTimes(1);
  expect(mocks.supplier).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(run.attempts.claim).not.toHaveBeenCalled();
  expect(run.checkpoints.has('reserve-portrait')).toBe(false);
  expect(mocks.deduct).toHaveBeenCalledTimes(1);
});
it('does not submit when a replayed hold has already been released', async () => {
  const run = harness();
  run.createReservation.mockResolvedValueOnce({
    ok: true,
    reservationId: HOLD,
    remaining: usdToMicros(0),
    replay: true,
  });
  const result = await runSheetPortraitStep({
    step: run.step,
    scopedDb: run.db,
    kind: 'character',
    sheetUrl: INPUT.sheetUrl,
    storageDir: INPUT.storageDir,
    subjectId: 'mock-character',
    chargeKey: EVENT.instanceId,
    userId: INPUT.userId,
    sequenceId: null,
  });
  expect(result).toBeNull();
  expect(mocks.supplier).not.toHaveBeenCalled();
  expect(run.attempts.claim).not.toHaveBeenCalled();
});

it('recovers a stored portrait attempt if the draw checkpoint is absent on a charge retry', async () => {
  const run = harness();
  mocks.deduct.mockRejectedValueOnce(new Error('Mock ledger unavailable'));
  await expect(workflow().execute(run.step, run.db)).rejects.toThrow(
    'Mock ledger unavailable'
  );
  run.checkpoints.delete('draw-portrait');
  run.checkpoints.delete('draw-portrait:record');
  const result = await workflow().execute(run.step, run.db);
  expect(result.portraitUrl).toMatch(/^\/r2\/characters\//);
  expect(mocks.supplier).toHaveBeenCalledTimes(1);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(run.attempts.claim).toHaveBeenCalledTimes(1);
  expect(mocks.deduct).toHaveBeenCalledTimes(2);
});
it.each([
  ['jpeg', 'jpg'],
  ['webp', 'webp'],
] as const)(
  'stores bound %s portrait bytes under their real MIME and extension',
  async (format, extension) => {
    const run = harness();
    const base64 = MOCK_IMAGE_BASE64[format];
    mocks.supplier.mockResolvedValueOnce({
      images: [
        {
          dataUrl: 'data:image/' + format + ';base64,' + base64,
          width: 512,
          height: 512,
          mimeType: 'image/' + format,
          byteLength: atob(base64).length,
        },
      ],
      requestedCount: 1,
      actualCount: 1,
      returnedCount: 1,
      status: 'complete',
      mismatches: [],
      reported: {},
    });
    const result = await workflow().execute(run.step, run.db);
    expect(result.portraitUrl).toMatch(
      new RegExp('-portrait\\.' + extension + '$')
    );
    const [response, bucket, storagePath, options] =
      mocks.upload.mock.calls[0] ?? [];
    expect(bucket).toBe('characters');
    expect(storagePath).toContain('-portrait.' + extension);
    expect(options).toEqual({ contentType: 'image/' + format });
    expect(response.headers.get('content-type')).toBe('image/' + format);
    expect(response.headers.get('content-length')).toBe(
      String(atob(base64).length)
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    );
  }
);
it('uses the same tracked and charged bridge for a location portrait', async () => {
  const run = harness();
  const event: WorkflowEvent<SheetPortraitWorkflowInput> = {
    ...EVENT,
    payload: {
      ...INPUT,
      subject: { kind: 'location', locationId: 'mock-location' },
      sheetUrl: '/r2/locations/mock-org/sheet.png',
      sequenceId: 'mock-sequence',
    },
  };
  const result = await workflow().execute(run.step, run.db, event);
  expect(result.portraitUrl).toMatch(/^\/r2\/locations\//);
  expect(run.attempts.claim).toHaveBeenCalledTimes(1);
  expect(mocks.provenance).toHaveBeenCalledWith(
    run.db.provenance,
    expect.objectContaining({
      assetKind: 'location_sheet',
      assetId: 'mock-location',
    })
  );
  expect(mocks.deduct).toHaveBeenCalledWith(
    expect.objectContaining({
      reservationId: HOLD,
      metadata: expect.objectContaining({
        kind: 'location',
        sequenceId: 'mock-sequence',
      }),
    })
  );
  expect(run.select).toHaveBeenCalledWith(INPUT.versionId, result.portraitUrl);
});
