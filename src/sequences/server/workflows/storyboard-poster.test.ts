import { beforeEach, expect, it, vi } from 'vitest';
import {
  OWNER,
  POSTER,
  STEP,
  deduct,
  emit,
  posterArgs,
  recordUsage,
} from './storyboard-poster.test.fixture';

const { publishStoryboardPoster } = await import('./storyboard-poster');

beforeEach(() => {
  vi.resetAllMocks();
});

it('settles native incurred usage before publishing with the actual root and claim', async () => {
  const run = posterArgs();
  await expect(publishStoryboardPoster(run.args)).resolves.toBe(true);
  expect(run.names).toEqual([STEP.usage, STEP.deduct, STEP.save]);
  expect(recordUsage).toHaveBeenCalledExactlyOnceWith({
    provider: 'fal',
    endpointId: POSTER.metadata.endpointId,
    unitsBilled: POSTER.metadata.unitsBilled,
    numImages: POSTER.metadata.numImages,
  });
  expect(deduct).toHaveBeenCalledExactlyOnceWith({
    scopedDb: run.args.scopedDb,
    costMicros: POSTER.metadata.cost,
    usedOwnKey: false,
    description: `Sequence poster (${run.args.scopedDb.models.poster})`,
    idempotencyKey: `${OWNER.workflowRunId}:poster`,
    reservationId: run.args.reservationId,
    metadata: {
      endpointId: POSTER.metadata.endpointId,
      unitsBilled: POSTER.metadata.unitsBilled,
      numImages: POSTER.metadata.numImages,
      requestId: POSTER.metadata.requestId,
      billingProvider: undefined,
      model: run.args.scopedDb.models.poster,
      sequenceId: OWNER.id,
    },
    workflowName: 'StoryboardWorkflow',
  });
  expect(run.setPosterIfCurrent).toHaveBeenCalledExactlyOnceWith({
    ...OWNER,
    posterUrl: POSTER.url,
  });
  const { id: _id, ...workflowOwner } = OWNER;
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.poster:ready', {
    posterUrl: POSTER.url,
    workflowOwner,
  });
});

it('retains incurred billing and withholds publication when the SQL owner misses', async () => {
  const run = posterArgs();
  run.setPosterIfCurrent.mockResolvedValue(false);
  await expect(publishStoryboardPoster(run.args)).resolves.toBe(false);
  expect(recordUsage).toHaveBeenCalledTimes(1);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(emit).not.toHaveBeenCalled();
});

it('keeps configured pricing and skips fal observations for configured routes', async () => {
  const run = posterArgs();
  run.args.scopedDb.models = {
    ...run.args.scopedDb.models,
    poster: 'custom-image:synthetic-poster',
  };
  const configuredPricing = {
    priceCardId: 'synthetic-price-card',
    unitPriceUsd: 0.1,
    imageCount: 1,
    requestedCount: 1,
  };
  const args = {
    ...run.args,
    poster: {
      ...run.args.poster,
      metadata: { ...POSTER.metadata, configuredPricing },
    },
  };
  await expect(publishStoryboardPoster(args)).resolves.toBe(true);
  expect(run.names).toEqual([STEP.deduct, STEP.save]);
  expect(recordUsage).not.toHaveBeenCalled();
  expect(deduct).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      metadata: {
        configuredPricing,
        model: args.scopedDb.models.poster,
        sequenceId: OWNER.id,
      },
    })
  );
});

it('retains BYOK and unpriced metadata without changing the charge decision', async () => {
  const run = posterArgs();
  const args = {
    ...run.args,
    poster: {
      ...run.args.poster,
      metadata: { ...POSTER.metadata, cost: undefined, usedOwnKey: true },
    },
  };
  await publishStoryboardPoster(args);
  expect(recordUsage).toHaveBeenCalledTimes(1);
  expect(deduct).toHaveBeenCalledWith(
    expect.objectContaining({ costMicros: 0, usedOwnKey: true })
  );
});

it.each([
  'Synthetic D1 unavailable',
  'Aborting engine: Grace period complete',
  'Durable Object reset because its code was updated',
])(
  'preserves publication errors and previously settled cost: %s',
  async (message) => {
    const run = posterArgs();
    const error = new Error(message);
    run.setPosterIfCurrent.mockRejectedValue(error);
    await expect(publishStoryboardPoster(run.args)).rejects.toBe(error);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(deduct).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  }
);

it('retries a failed publication without repeating the completed cost steps', async () => {
  const run = posterArgs();
  const error = new Error('Synthetic publication failure');
  run.setPosterIfCurrent.mockRejectedValueOnce(error);
  await expect(publishStoryboardPoster(run.args)).rejects.toBe(error);
  await expect(publishStoryboardPoster(run.args)).resolves.toBe(true);
  expect(recordUsage).toHaveBeenCalledTimes(1);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(run.setPosterIfCurrent).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenCalledTimes(1);
});

it('rechecks SQL ownership after a lost successful write reply', async () => {
  const run = posterArgs();
  const error = new Error('Synthetic lost write reply');
  run.setPosterIfCurrent.mockRejectedValueOnce(error).mockResolvedValue(false);
  await expect(publishStoryboardPoster(run.args)).rejects.toBe(error);
  await expect(publishStoryboardPoster(run.args)).resolves.toBe(false);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(emit).not.toHaveBeenCalled();
});

it('a channel error retries publication while retaining settled cost', async () => {
  const run = posterArgs();
  const error = new Error('Synthetic channel failure');
  emit.mockRejectedValueOnce(error);
  await expect(publishStoryboardPoster(run.args)).rejects.toBe(error);
  await expect(publishStoryboardPoster(run.args)).resolves.toBe(true);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(run.setPosterIfCurrent).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenCalledTimes(2);
});

it('does not republish after a channel failure followed by takeover', async () => {
  const run = posterArgs();
  const error = new Error('Synthetic channel failure');
  emit.mockRejectedValueOnce(error);
  await expect(publishStoryboardPoster(run.args)).rejects.toBe(error);
  run.setPosterIfCurrent.mockResolvedValue(false);
  await expect(publishStoryboardPoster(run.args)).resolves.toBe(false);
  expect(deduct).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledTimes(1);
});

it.each([true, false, undefined])(
  'does not replay persisted save checkpoint %s',
  async (saved) => {
    const run = posterArgs(
      new Map<string, unknown>([
        [STEP.save, saved],
        [STEP.usage, undefined],
        [STEP.deduct, undefined],
      ])
    );
    await expect(publishStoryboardPoster(run.args)).resolves.toBe(
      saved !== false
    );
    expect(run.setPosterIfCurrent).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(deduct).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  }
);

it.each(['usage', 'deduct'] as const)(
  'preserves a failed %s cost step before publication',
  async (phase) => {
    const run = posterArgs();
    const error = new Error('Synthetic accounting failure');
    const operation = phase === 'usage' ? recordUsage : deduct;
    operation.mockRejectedValueOnce(error);
    await expect(publishStoryboardPoster(run.args)).rejects.toBe(error);
    expect(run.setPosterIfCurrent).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  }
);
