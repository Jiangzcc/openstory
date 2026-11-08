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
import type { Sequence } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { usdToMicros } from '@/billing/money';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { imageChannelsConfigurationSchema } from '@/models/image-channels';
import { IMAGE_CHANNELS_KEY } from '@/models/server/db/image-channels';
import type { PlanUnit } from '@/sequences/generation-plan';
import type { StyleConfig } from '@/look/style-config';
import type { ImageToVideoModel } from '@/models/models';

let fixture: Awaited<ReturnType<typeof createTestDb>>;

// Mock runtime bindings, realtime delivery and the unrelated fal rate table.
vi.doMock('#db-client', () => ({ getDb: () => fixture.db }));
vi.doMock('@/platform/realtime', () => ({
  getBillingChannel: () => ({ emit: async () => undefined }),
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => ({}),
}));

const { createScopedDb } = await import('@/platform/server/db/scoped');
const { prepareContinueEstimate } = await import('./continue-plan');

const CONFIGURED_MODEL = 'custom-image:qwen';
const STORED_VIDEO_MODEL = 'kling_v3_pro' satisfies ImageToVideoModel;
const REQUESTED_VIDEO_MODEL = 'seedance_v2' satisfies ImageToVideoModel;
const STARTING_BALANCE = usdToMicros(10);
const MOCK_STYLE_CONFIG = {
  version: 2,
  look: {
    mood: 'neutral',
    artStyle: 'cinematic',
    lighting: 'natural',
    colorPalette: ['blue'],
    colorGrading: 'neutral',
  },
  motion: { camera: 'static' },
  references: [],
} satisfies StyleConfig;

function configuredImageChannels() {
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
      values: ['1280x720', '1920x1080'],
    },
  ];
  model.priceCards = model.priceCards.flatMap(({ operation }) => [
    {
      id: operation + '-720p',
      operation,
      match: { size: '1280x720' },
      unitPriceUsd: 0.1,
    },
    {
      id: operation + '-1080p',
      operation,
      match: { size: '1920x1080' },
      unitPriceUsd: 0.9,
    },
  ]);
  return imageChannelsConfigurationSchema.parse(source);
}

beforeAll(async () => {
  fixture = await createTestDb();
  await fixture.db.insert(appMetadata).values({
    key: IMAGE_CHANNELS_KEY,
    value: JSON.stringify(configuredImageChannels()),
  });
});
afterAll(async () => fixture.close());
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Continue estimates must not call providers or the network.')
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function createAccount(imageModel = CONFIGURED_MODEL) {
  const organizationId = generateId();
  const userId = generateId();
  const styleId = generateId();
  const sequenceId = generateId();
  await fixture.db.insert(organization).values({
    id: organizationId,
    name: 'Mock continue organization',
    slug: organizationId,
  });
  await fixture.db.insert(user).values({
    id: userId,
    name: 'Mock continue user',
    email: userId + '@mock.invalid',
  });
  await fixture.db
    .insert(credits)
    .values({ organizationId, balance: STARTING_BALANCE });
  await fixture.db.insert(styles).values({
    id: styleId,
    organizationId,
    name: 'Mock continue style',
    config: MOCK_STYLE_CONFIG,
  });
  await fixture.db.insert(sequences).values({
    id: sequenceId,
    organizationId,
    styleId,
    title: 'Mock continue sequence',
    imageModel,
    videoModel: STORED_VIDEO_MODEL,
    resolution: '720p',
    aspectRatio: '16:9',
    generateStartFrames: true,
    status: 'completed',
  });
  const scopedDb = createScopedDb(organizationId, userId);
  const shotId = await createFirstStill(scopedDb, sequenceId, userId);
  const sequence = await scopedDb.sequences.getById(sequenceId);
  if (!sequence) throw new Error('Missing mock sequence.');
  return { scopedDb, sequence, userId, shotId };
}

async function createFirstStill(
  scopedDb: ReturnType<typeof createScopedDb>,
  sequenceId: string,
  userId: string
) {
  const scene = await scopedDb.scenes.create(
    { sequenceId, orderIndex: 0 },
    {
      title: 'Empty room',
      location: null,
      timeOfDay: 'day',
      storyBeat: null,
      continuity: null,
    },
    { createdBy: userId }
  );
  const shotId = generateId();
  const frameId = generateId();
  await fixture.db.insert(shots).values({
    id: shotId,
    sequenceId,
    sceneId: scene.id,
    shotNumber: 1,
    durationMs: 5000,
  });
  await fixture.db.insert(frames).values({ id: frameId, shotId, sequenceId });
  await scopedDb.framePromptVersions.write({
    frameId,
    text: 'A synthetic empty room.',
    source: 'user-edit',
    inputHash: null,
    analysisModel: null,
    createdBy: userId,
  });
  return shotId;
}

type Account = Awaited<ReturnType<typeof createAccount>>;

function estimate(account: Account, sequence: Sequence = account.sequence) {
  const work: PlanUnit[] = [
    {
      kind: 'still',
      id: account.shotId,
      state: 'missing',
      requires: [],
      cascaded: false,
    },
  ];
  return prepareContinueEstimate({
    promptLocale: 'zh-CN',
    scopedDb: account.scopedDb,
    userId: account.userId,
    sequence,
    work,
    requested: { generateStartFrames: true, generateVoices: false },
    draftMotion: false,
  });
}

describe('Continue quotes with unsaved model and resolution selections', () => {
  it('prices the requested resolution while the stored selection and balance remain unchanged', async () => {
    const account = await createAccount();
    const requested = {
      ...account.sequence,
      resolution: '1080p',
      videoModel: REQUESTED_VIDEO_MODEL,
    } satisfies Sequence;
    const { plan, estimate: quote } = await estimate(account, requested);
    expect(plan.skipped).toEqual([]);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      imageModel: CONFIGURED_MODEL,
      regenImage: true,
    });
    expect({
      resolution: plan.sequence.resolution,
      micros: quote.micros,
    }).toEqual({
      resolution: '1080p',
      micros: usdToMicros(0.9),
    });
    expect(plan.sequence.videoModel).toBe(REQUESTED_VIDEO_MODEL);
    expect(plan.resolution).toBe('1080p');
    expect(quote).toMatchObject({ priced: true, imageSource: 'platform' });
    expect(
      await account.scopedDb.sequences.getById(account.sequence.id)
    ).toMatchObject({
      resolution: '720p',
      videoModel: STORED_VIDEO_MODEL,
    });
    expect(await account.scopedDb.billing.getBalance()).toBe(STARTING_BALANCE);
  });

  it('uses an unsaved configured model for a first still and preserves the model snapshot', async () => {
    const account = await createAccount('nano_banana_2');
    const prepared = await estimate(account, {
      ...account.sequence,
      imageModel: CONFIGURED_MODEL,
    });
    expect(prepared.plan.skipped).toEqual([]);
    expect(prepared.plan.targets).toHaveLength(1);
    expect(prepared.plan.targets[0]?.imageModel).toBe(CONFIGURED_MODEL);
    expect(prepared.plan.sequence.imageModel).toBe(CONFIGURED_MODEL);
    expect(prepared.estimate).toMatchObject({
      micros: usdToMicros(0.1),
      imageSource: 'platform',
    });
    expect(prepared.modelConfiguration.imageModelRouting).toHaveLength(1);
    expect(
      (await account.scopedDb.sequences.getById(account.sequence.id))
        ?.imageModel
    ).toBe('nano_banana_2');
  });

  it('returns the same quote after the requested selection is saved', async () => {
    const account = await createAccount();
    const requested = {
      ...account.sequence,
      resolution: '1080p',
    } satisfies Sequence;
    const preview = await estimate(account, requested);
    await account.scopedDb.sequences.update({
      id: account.sequence.id,
      resolution: '1080p',
    });
    const saved = await account.scopedDb.sequences.getById(account.sequence.id);
    if (!saved) throw new Error('Missing saved sequence.');
    const persisted = await estimate(account, saved);
    expect(preview.estimate.micros).toBe(usdToMicros(0.9));
    expect(persisted.estimate).toEqual(preview.estimate);
    expect(persisted.plan.sequence.resolution).toBe('1080p');
    expect(await account.scopedDb.billing.getBalance()).toBe(STARTING_BALANCE);
  });

  it('quotes the old persisted selection after a simulated save rejection without mutating the earlier plan', async () => {
    const account = await createAccount();
    const preview = await estimate(account, {
      ...account.sequence,
      resolution: '1080p',
    });
    const failure = new Error('Simulated selection save rejection.');
    vi.spyOn(account.scopedDb.sequences, 'update').mockRejectedValueOnce(
      failure
    );
    await expect(
      account.scopedDb.sequences.update({
        id: account.sequence.id,
        resolution: '1080p',
      })
    ).rejects.toBe(failure);
    const saved = await account.scopedDb.sequences.getById(account.sequence.id);
    if (!saved) throw new Error('Missing persisted sequence.');
    const reverted = await estimate(account, saved);
    expect(saved.resolution).toBe('720p');
    expect(reverted.estimate.micros).toBe(usdToMicros(0.1));
    expect(preview.plan.sequence.resolution).toBe('1080p');
    expect(preview.estimate.micros).toBe(usdToMicros(0.9));
    expect(await account.scopedDb.billing.getBalance()).toBe(STARTING_BALANCE);
  });
});
