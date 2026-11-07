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
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  appMetadata,
  credits,
  frames,
  organization,
  sequences,
  shots,
  styles,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { InsufficientCreditsError } from '@/platform/errors';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { IMAGE_CHANNELS_KEY } from '@/models/server/db/image-channels';
import { imageChannelsConfigurationSchema } from '@/models/image-channels';
import type { ImageModelRoutingSnapshot } from '@/models/image-channels';
import type { ImageGenerationParams } from './image-generation';
import {
  aspectRatioToImageSize,
  resolveVariantImageSize,
} from '@/models/aspect-ratios';
import { unpackModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { requireUpscaleModel } from '@/models/resolve-asset-models';
import type { Resolution } from '@/models/resolutions';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { ShotEditContext } from '@/shots/server/shot-context';
import type {
  ImageWorkflowInput,
  ShotVariantWorkflowInput,
  UpscaleShotVariantWorkflowInput,
} from '@/platform/server/workflow/types';
import { multiplyMicros, negateMicros, usdToMicros } from '@/billing/money';
import type { Microdollars } from '@/billing/money';

type QueuedImageInput =
  | ImageWorkflowInput
  | ShotVariantWorkflowInput
  | UpscaleShotVariantWorkflowInput;
type TriggerOptions = Parameters<
  typeof import('@/platform/server/workflow/client').triggerWorkflow
>[2];
type Dispatch = (
  path: string,
  input: QueuedImageInput,
  options?: TriggerOptions
) => Promise<string>;
type Crop = typeof import('./image-crop').cropTileFromGrid;

let fixture: Awaited<ReturnType<typeof createTestDb>>;
const dispatch = vi.fn<Dispatch>();
const crop = vi.fn<Crop>();

// Mock only runtime bindings, realtime delivery, storage cropping and dispatch.
vi.doMock('#db-client', () => ({ getDb: () => fixture.db }));
vi.doMock('@/platform/realtime', () => ({
  getBillingChannel: () => ({ emit: async () => undefined }),
}));
vi.doMock('./image-crop', () => ({ cropTileFromGrid: crop }));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: dispatch,
}));

const { createScopedDb } = await import('@/platform/server/db/scoped');
const { loadShotTarget } = await import('@/shots/server/shot-context');
const { configuredImageGenerationQuote } =
  await import('./configured-image-generation');
const { generateShotImage, generateShotImageVariants, selectShotImageVariant } =
  await import('./shot-image-generation');

const MOCK_MODEL = 'custom-image:qwen';
const MOCK_PROMPT = 'A synthetic empty room for the billing regression.';
const MOCK_IMAGE_URL = '/r2/mock-billing/grid.png';
const MOCK_CROP_URL = '/r2/mock-billing/tile.png';
const MOCK_RATES = {
  generate: { '720p': 0.1, '1080p': 0.9 },
  edit: { '720p': 0.2, '1080p': 1.2 },
} as const;
const MOCK_SIZES = [
  { resolution: '720p', size: '1280x720' },
  { resolution: '1080p', size: '1920x1080' },
  { resolution: '720p', size: '720x1280' },
  { resolution: '1080p', size: '1080x1920' },
] as const;
const MOCK_STYLE_CONFIG = {
  mood: 'neutral',
  artStyle: 'cinematic',
  lighting: 'natural',
  colorPalette: [],
  cameraWork: 'static',
  referenceFilms: [],
  colorGrading: 'neutral',
};
const FUNDED_REQUESTS = 2;
const PARTIAL_FUNDING = 1.5;

function mockImageChannels() {
  const source = imageConfigurationFixture();
  const [model] = source.models;
  if (!model) throw new Error('Missing mock image model.');
  model.parameters = [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      defaultValue: '1280x720',
      values: MOCK_SIZES.map(({ size }) => size),
    },
  ];
  model.priceCards = (['generate', 'edit'] as const).flatMap((operation) =>
    MOCK_SIZES.map(({ resolution, size }) => ({
      id: operation + '-' + size,
      operation,
      match: { size },
      unitPriceUsd: MOCK_RATES[operation][resolution],
    }))
  );
  return imageChannelsConfigurationSchema.parse(source);
}

beforeAll(async () => {
  fixture = await createTestDb();
  await fixture.db.insert(appMetadata).values({
    key: IMAGE_CHANNELS_KEY,
    value: JSON.stringify(mockImageChannels()),
  });
});
afterAll(async () => {
  await fixture.close();
});
beforeEach(() => {
  dispatch.mockReset().mockImplementation(async () => generateId());
  crop.mockReset().mockResolvedValue({ url: MOCK_CROP_URL, path: '' });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Billing regressions forbid provider and network requests.')
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function fundedSequence(
  balance: Microdollars,
  resolution: Resolution = '1080p',
  aspectRatio: AspectRatio = '16:9'
) {
  const organizationId = generateId();
  const userId = generateId();
  const styleId = generateId();
  const sequenceId = generateId();
  await fixture.db.insert(organization).values({
    id: organizationId,
    name: 'Mock billing organization',
    slug: organizationId,
  });
  await fixture.db.insert(user).values({
    id: userId,
    name: 'Mock billing user',
    email: userId + '@mock.invalid',
  });
  await fixture.db.insert(credits).values({ organizationId, balance });
  await fixture.db.insert(styles).values({
    id: styleId,
    organizationId,
    name: 'Mock billing style',
    config: MOCK_STYLE_CONFIG,
  });
  await fixture.db.insert(sequences).values({
    id: sequenceId,
    organizationId,
    styleId,
    title: 'Mock billing sequence',
    imageModel: MOCK_MODEL,
    resolution,
    aspectRatio,
    generateStartFrames: true,
  });
  return {
    scopedDb: createScopedDb(organizationId, userId),
    sequenceId,
    organizationId,
    userId,
  };
}
type FundedSequence = Awaited<ReturnType<typeof fundedSequence>>;

async function shotContext(
  account: FundedSequence,
  shotNumber = 1
): Promise<ShotEditContext> {
  const shotId = generateId();
  const frameId = generateId();
  const { scopedDb, sequenceId, organizationId, userId } = account;
  await fixture.db.insert(shots).values({ id: shotId, sequenceId, shotNumber });
  await fixture.db.insert(frames).values({ id: frameId, shotId, sequenceId });
  await scopedDb.framePromptVersions.write({
    frameId,
    text: MOCK_PROMPT,
    source: 'user-edit',
    inputHash: null,
    analysisModel: null,
    createdBy: userId,
  });
  const image = await scopedDb.frameVariants.appendVersion({
    frameId,
    sequenceId,
    kind: 'framing',
    model: MOCK_MODEL,
    status: 'completed',
    url: MOCK_IMAGE_URL,
    isPrimary: true,
  });
  await scopedDb.frameVariants.select(frameId, image.id, { actorId: userId });
  const target = await loadShotTarget(scopedDb, sequenceId, shotId);
  return { ...target, scopedDb, user: { id: userId }, organizationId };
}

const ENTRYPOINTS = [
  {
    name: 'regenerate',
    path: '/image',
    operation: 'generate',
    run: (context: ShotEditContext) => generateShotImage(context, {}),
  },
  {
    name: 'variants',
    path: '/variant-image',
    operation: 'edit',
    run: (context: ShotEditContext) =>
      generateShotImageVariants(context, { model: MOCK_MODEL }),
  },
  {
    name: 'upscale',
    path: '/upscale-variant',
    operation: 'edit',
    run: (context: ShotEditContext) =>
      selectShotImageVariant(context, { variantIndex: 0 }),
  },
] as const;

function dispatchedParameters(
  input: QueuedImageInput,
  routing: ImageModelRoutingSnapshot | undefined
): ImageGenerationParams {
  const common = {
    prompt: MOCK_PROMPT,
    resolution: input.resolution,
    numImages: 1,
  };
  if ('croppedTileUrl' in input) {
    return {
      ...common,
      model: requireUpscaleModel(input.sourceModel, routing),
      imageSize: aspectRatioToImageSize(input.aspectRatio ?? '16:9'),
      referenceImageUrls: [input.croppedTileUrl],
      outputFormat: 'png',
    };
  }
  return {
    ...common,
    model: input.model ?? MOCK_MODEL,
    imageSize:
      'thumbnailUrl' in input
        ? resolveVariantImageSize(input.aspectRatio, input.imageSize)
        : input.imageSize,
    referenceImageUrls:
      'thumbnailUrl' in input
        ? [input.thumbnailUrl]
        : (input.referenceImages ?? []).map((image) => image.referenceImageUrl),
  };
}
function dispatchedQuote(index = 0) {
  const call = dispatch.mock.calls[index];
  if (!call) throw new Error('No mock workflow was dispatched.');
  const [path, input, options] = call;
  const configuration = input.modelConfiguration
    ? unpackModelRuntimeConfiguration(input.modelConfiguration)
    : options?.modelConfiguration;
  if (!configuration)
    throw new Error('Dispatched image has no frozen routing.');
  const quote = configuredImageGenerationQuote(
    dispatchedParameters(input, configuration.imageModelRouting),
    configuration.imageModelRouting
  );
  if (!input.reservationId) throw new Error('Dispatched image has no hold.');
  expect(input.ownsReservation).toBe(true);
  return { path, input, quote, reservationId: input.reservationId };
}

async function assertFullyCaptured(
  account: FundedSequence,
  cost: Microdollars
) {
  const queued = dispatch.mock.calls.map((_, index) => dispatchedQuote(index));
  const captures = await Promise.all(
    queued.map(async (run, index) => {
      expect(run.quote.costMicros).toBe(cost);
      expect(
        await account.scopedDb.billing.hasEnoughCredits(cost, run.reservationId)
      ).toBe(true);
      return account.scopedDb.billing.captureReservation(
        run.reservationId,
        cost,
        {
          idempotencyKey: 'mock-image-charge:' + index,
        }
      );
    })
  );
  for (const capture of captures) {
    expect(capture).toMatchObject({ ok: true, captured: cost });
    expect(capture).not.toHaveProperty(
      'skippedDeltaMicros',
      expect.any(Number)
    );
  }
  expect(await account.scopedDb.billing.getAvailable()).toMatchObject({
    balance: 0,
    reserved: 0,
    available: 0,
  });
  const history = await account.scopedDb.billing.getTransactionHistory();
  expect(history.transactions).toHaveLength(FUNDED_REQUESTS);
  expect(history.transactions.map(({ amount }) => amount)).toEqual([
    negateMicros(cost),
    negateMicros(cost),
  ]);
}

describe.each(ENTRYPOINTS)('$name image billing against real D1', (entry) => {
  it.each(['720p', '1080p'] as const)(
    'reserves the %s specification frozen onto the actual workflow',
    async (resolution) => {
      const cost = usdToMicros(MOCK_RATES[entry.operation][resolution]);
      const account = await fundedSequence(cost, resolution);
      await entry.run(await shotContext(account));
      const queued = dispatchedQuote();
      expect(queued.path).toBe(entry.path);
      expect(queued.input.resolution).toBe(resolution);
      expect(queued.quote.costMicros).toBe(cost);
      expect(queued.quote.parameters.size).toBe(
        resolution === '1080p' ? '1920x1080' : '1280x720'
      );
      expect(await account.scopedDb.billing.getAvailable()).toMatchObject({
        balance: cost,
        reserved: cost,
        available: 0,
      });
    }
  );
});

describe.each(ENTRYPOINTS)(
  '$name image credit reservations against real D1',
  (entry) => {
    it('rejects a second 1080p task before dispatch when only one can be funded', async () => {
      const cost = usdToMicros(MOCK_RATES[entry.operation]['1080p']);
      const balance = multiplyMicros(cost, PARTIAL_FUNDING);
      const account = await fundedSequence(balance);
      await entry.run(await shotContext(account));
      const second = await shotContext(account, FUNDED_REQUESTS);
      await expect(entry.run(second)).rejects.toThrow(InsufficientCreditsError);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(await account.scopedDb.billing.getAvailable()).toMatchObject({
        balance,
        reserved: cost,
        available: balance - cost,
      });
      expect(
        (await account.scopedDb.billing.getTransactionHistory()).transactions
      ).toHaveLength(0);
    });

    it('funds both 1080p tasks fully so concurrent captures have no unpaid remainder', async () => {
      const cost = usdToMicros(MOCK_RATES[entry.operation]['1080p']);
      const balance = multiplyMicros(cost, FUNDED_REQUESTS);
      const account = await fundedSequence(balance);
      await entry.run(await shotContext(account));
      await entry.run(await shotContext(account, FUNDED_REQUESTS));
      expect(dispatch).toHaveBeenCalledTimes(FUNDED_REQUESTS);
      expect(await account.scopedDb.billing.getAvailable()).toMatchObject({
        balance,
        reserved: balance,
        available: 0,
      });
      await assertFullyCaptured(account, cost);
    });
  }
);
