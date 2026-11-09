import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareConfiguredImageBilling } from '@/billing/server/configured-image-billing';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_IMAGE_MODEL } from '@/models/models';
import { InsufficientCreditsError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import { shotImageInputHash } from '@/shots/input-hash';
import type { ShotEditContext } from '@/shots/server/shot-context';
import type { prepareShotImageGeneration } from '@/shots/server/shot-image-input';
import { asStub } from '@/test/as-stub';

const IDS = {
  shot: generateId(),
  frame: generateId(),
  sequence: generateId(),
  organization: generateId(),
  user: generateId(),
  claim: generateId(),
  reservation: generateId(),
};
const RUN_ID = 'mock-image-run';
const INPUT_HASH = shotImageInputHash('mock-captured-input');
const PROMPT = 'Mock still prompt';
type PreparedGeneration = Awaited<
  ReturnType<typeof prepareShotImageGeneration>
>;
const prepare = vi.fn<typeof prepareShotImageGeneration>();
const trigger = vi.fn(async () => RUN_ID);
vi.doMock('@/shots/server/shot-image-input', () => ({
  prepareShotImageGeneration: prepare,
  getSceneLocationReferenceImages: vi.fn(),
}));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: trigger,
}));
const { generateShotImage } = await import('./shot-image-generation');

// Synthetic scoped methods isolate orchestration; reservation and release helpers stay real.
function scopedFixture() {
  return {
    framePromptVersions: { getSelected: vi.fn(async () => ({ text: PROMPT })) },
    frameVariants: {
      listLiveClaims: vi.fn().mockResolvedValue([]),
      createPendingClaim: vi.fn(async () => ({ id: IDS.claim })),
      markTerminal: vi.fn(),
      update: vi.fn(),
    },
    billing: {
      createReservation: vi.fn().mockResolvedValue({
        ok: true,
        reservationId: IDS.reservation,
      }),
      zeroReservation: vi.fn(),
    },
    sequenceEvents: { record: vi.fn() },
  };
}

function contextFixture(scopedDb: ReturnType<typeof scopedFixture>) {
  return asStub<ShotEditContext>({
    promptLocale: 'en',
    scopedDb,
    shot: { id: IDS.shot },
    frame: { id: IDS.frame },
    sequence: {
      id: IDS.sequence,
      aspectRatio: '16:9',
      generateStartFrames: true,
    },
    user: { id: IDS.user },
    scene: null,
    script: null,
  });
}

async function preparedFixture(configured = true): Promise<PreparedGeneration> {
  const model = configured ? 'custom-image:qwen' : DEFAULT_IMAGE_MODEL;
  const modelConfiguration = {
    ...DEFAULT_MODEL_CONFIGURATION,
    ...(configured
      ? {
          imageModelRouting: createImageModelRoutingSnapshot(
            imageConfigurationFixture()
          ),
        }
      : {}),
  };
  const workflowInput: PreparedGeneration['workflowInput'] = {
    promptLocale: 'en',
    userId: IDS.user,
    organizationId: IDS.organization,
    sequenceId: IDS.sequence,
    shotId: IDS.shot,
    frameId: IDS.frame,
    prompt: PROMPT,
    model,
    variantOnly: false,
    aspectRatio: '16:9',
    resolution: '720p',
    numImages: 1,
    referenceImages: [],
    snapshotInputHash: INPUT_HASH,
    modelConfiguration: packModelRuntimeConfiguration(modelConfiguration),
  };
  const imageBilling = await prepareConfiguredImageBilling({
    model,
    aspectRatio: workflowInput.aspectRatio,
    resolution: workflowInput.resolution,
    imageCount: workflowInput.numImages,
    referenceImageCount: workflowInput.referenceImages?.length,
    modelConfiguration,
  });
  return { workflowInput, modelConfiguration, imageBilling };
}

function expectFailedClaim(
  scopedDb: ReturnType<typeof scopedFixture>,
  error: Error
) {
  expect(scopedDb.frameVariants.markTerminal).toHaveBeenCalledExactlyOnceWith(
    IDS.claim,
    'failed',
    error.message
  );
  expect(scopedDb.sequenceEvents.record).toHaveBeenCalledExactlyOnceWith({
    sequenceId: IDS.sequence,
    actorId: IDS.user,
    kind: 'run.failed',
    targetType: 'sequence',
    targetId: IDS.sequence,
    summary: 'Image generation failed',
  });
  expect(scopedDb.frameVariants.update).not.toHaveBeenCalled();
}

function expectNoDispatch(scopedDb: ReturnType<typeof scopedFixture>) {
  expect(scopedDb.billing.createReservation).not.toHaveBeenCalled();
  expect(scopedDb.billing.zeroReservation).not.toHaveBeenCalled();
  expect(trigger).not.toHaveBeenCalled();
}

function expectWorkflowTrigger(
  prepared: PreparedGeneration,
  reservationId?: string
) {
  expect(trigger).toHaveBeenCalledExactlyOnceWith(
    '/image',
    {
      ...prepared.workflowInput,
      targetVariantId: IDS.claim,
      reservationId,
      ownsReservation: Boolean(reservationId),
    },
    {
      deduplicationId: 'image-' + IDS.shot + '-' + IDS.claim,
      modelConfiguration: prepared.modelConfiguration,
    }
  );
}

describe('single-shot image claim and reservation lifecycle', () => {
  let prepared: PreparedGeneration;
  beforeEach(async () => {
    prepared = await preparedFixture();
    prepare.mockReset().mockResolvedValue(prepared);
    trigger.mockReset().mockResolvedValue(RUN_ID);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Unexpected network request in mock lifecycle test.');
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns an existing same-input claim without reserving or dispatching', async () => {
    const scopedDb = scopedFixture();
    scopedDb.frameVariants.listLiveClaims.mockResolvedValue([
      { pendingInputHash: INPUT_HASH, workflowRunId: 'mock-existing-run' },
    ]);
    await expect(
      generateShotImage(contextFixture(scopedDb), {})
    ).resolves.toEqual({
      workflowRunId: 'mock-existing-run',
      shotId: IDS.shot,
      alreadyInFlight: true,
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(scopedDb.frameVariants.createPendingClaim).not.toHaveBeenCalled();
    expectNoDispatch(scopedDb);
  });

  it('returns the racing claim when inserting the pending claim loses', async () => {
    const scopedDb = scopedFixture();
    scopedDb.frameVariants.listLiveClaims
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { pendingInputHash: INPUT_HASH, workflowRunId: 'mock-racing-run' },
      ]);
    scopedDb.frameVariants.createPendingClaim.mockRejectedValueOnce(
      new Error('Mock conflict')
    );
    await expect(
      generateShotImage(contextFixture(scopedDb), {})
    ).resolves.toEqual({
      workflowRunId: 'mock-racing-run',
      shotId: IDS.shot,
      alreadyInFlight: true,
    });
    expect(scopedDb.frameVariants.listLiveClaims).toHaveBeenCalledTimes(2);
    expectNoDispatch(scopedDb);
  });

  it('preserves a claim insertion error when there is no racing claim', async () => {
    const scopedDb = scopedFixture();
    const error = new Error('Mock claim insert failure');
    scopedDb.frameVariants.createPendingClaim.mockRejectedValueOnce(error);
    await expect(generateShotImage(contextFixture(scopedDb), {})).rejects.toBe(
      error
    );
    expect(scopedDb.frameVariants.listLiveClaims).toHaveBeenCalledTimes(2);
    expect(scopedDb.frameVariants.markTerminal).not.toHaveBeenCalled();
    expectNoDispatch(scopedDb);
  });

  it('stops a preparation credit failure before creating a claim', async () => {
    const scopedDb = scopedFixture();
    const error = new InsufficientCreditsError('Mock preflight failure');
    prepare.mockRejectedValueOnce(error);
    await expect(generateShotImage(contextFixture(scopedDb), {})).rejects.toBe(
      error
    );
    expect(scopedDb.frameVariants.listLiveClaims).not.toHaveBeenCalled();
    expect(scopedDb.frameVariants.createPendingClaim).not.toHaveBeenCalled();
    expectNoDispatch(scopedDb);
  });

  it('fails the claim when reservation cannot cover the captured quote', async () => {
    const scopedDb = scopedFixture();
    scopedDb.billing.createReservation.mockResolvedValueOnce({ ok: false });
    await expect(
      generateShotImage(contextFixture(scopedDb), {})
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expectFailedClaim(
      scopedDb,
      new InsufficientCreditsError('Insufficient credits')
    );
    expect(scopedDb.billing.createReservation).toHaveBeenCalledExactlyOnceWith(
      prepared.imageBilling?.costMicros,
      { sequenceId: IDS.sequence, idempotencyKey: 'image:' + IDS.claim }
    );
    expect(scopedDb.billing.zeroReservation).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('zeros a reservation and fails the claim after dispatch rejects', async () => {
    const scopedDb = scopedFixture();
    const error = new Error('Mock workflow trigger failure');
    trigger.mockRejectedValueOnce(error);
    await expect(generateShotImage(contextFixture(scopedDb), {})).rejects.toBe(
      error
    );
    expect(scopedDb.billing.zeroReservation).toHaveBeenCalledExactlyOnceWith(
      IDS.reservation
    );
    expectFailedClaim(scopedDb, error);
  });

  it('dispatches the captured payload with its claim and run envelope', async () => {
    const scopedDb = scopedFixture();
    await expect(
      generateShotImage(contextFixture(scopedDb), {})
    ).resolves.toEqual({
      workflowRunId: RUN_ID,
      shotId: IDS.shot,
      alreadyInFlight: false,
    });
    expect(
      scopedDb.frameVariants.createPendingClaim
    ).toHaveBeenCalledExactlyOnceWith({
      frameId: IDS.frame,
      sequenceId: IDS.sequence,
      model: prepared.workflowInput.model,
      pendingInputHash: INPUT_HASH,
      isPrimary: true,
      actorId: IDS.user,
    });
    expect(scopedDb.billing.createReservation).toHaveBeenCalledExactlyOnceWith(
      prepared.imageBilling?.costMicros,
      { sequenceId: IDS.sequence, idempotencyKey: 'image:' + IDS.claim }
    );
    expectWorkflowTrigger(prepared, IDS.reservation);
    expect(scopedDb.frameVariants.update).toHaveBeenCalledExactlyOnceWith(
      IDS.claim,
      {
        workflowRunId: RUN_ID,
      }
    );
    expect(scopedDb.billing.zeroReservation).not.toHaveBeenCalled();
    expect(scopedDb.frameVariants.markTerminal).not.toHaveBeenCalled();
  });

  it('keeps an unbound native model on its existing payload without a hold', async () => {
    prepared = await preparedFixture(false);
    prepare.mockResolvedValueOnce(prepared);
    const scopedDb = scopedFixture();
    await generateShotImage(contextFixture(scopedDb), {});
    expect(scopedDb.billing.createReservation).not.toHaveBeenCalled();
    expectWorkflowTrigger(prepared);
    expect(scopedDb.frameVariants.update).toHaveBeenCalledExactlyOnceWith(
      IDS.claim,
      {
        workflowRunId: RUN_ID,
      }
    );
    expect(scopedDb.billing.zeroReservation).not.toHaveBeenCalled();
  });
});
