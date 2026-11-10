import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usdToMicros } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import type { Sequence } from '@/platform/server/db/schema';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { PlanUnit, PlanUnitKind } from '@/sequences/generation-plan';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import { asStub } from '@/test/as-stub';

const CONFIGURED_MODEL = 'custom-image:qwen';
const BUILTIN_MODEL = 'nano_banana_2';
const MOCK_ROUTING = createImageModelRoutingSnapshot(
  imageConfigurationFixture()
);
const computePlan = vi.fn<(...args: unknown[]) => Promise<UpdateStalePlan>>();

// Only planning reads and live configuration are mocked; both billing estimators run.
vi.doMock('@/shots/server/update-stale-plan', () => ({ computePlan }));
vi.doMock('./launchers', () => ({
  loadStoryboardModelConfiguration: async () => ({
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: MOCK_ROUTING,
  }),
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => ({}),
}));
const { prepareContinueEstimate } = await import('./continue-plan');

function mockPlan(imageModel: string, kinds: PlanUnitKind[]): UpdateStalePlan {
  const targets = kinds
    .filter((kind) => kind === 'still')
    .map((_, index) => ({
      id: 'mock-shot-' + index,
      imageModel: index === 0 ? imageModel : BUILTIN_MODEL,
      regenImage: true,
      imageReferenceCount: 0,
      referenceIds: [],
    }));
  return asStub<UpdateStalePlan>({
    targets,
    aspectRatio: '16:9',
    sequence: { resolution: '720p' },
    references: kinds.includes('sheet:character')
      ? {
          characterSheets: [{ imageModel: BUILTIN_MODEL, face: null }],
          lookSheetsAfterDefault: [],
          locationSheets: [],
          elementSheets: null,
        }
      : null,
  });
}

function prepareQuote(imageModel: string, kinds: PlanUnitKind[]) {
  const sequence = asStub<Sequence>({
    id: 'mock-sequence',
    imageModel,
    videoModel: 'seedance_v2_5',
    aspectRatio: '16:9',
    resolution: '720p',
  });
  const work: PlanUnit[] = kinds.map((kind, index) => ({
    kind,
    id: 'mock-unit-' + index,
    state: 'missing',
    requires: [],
    cascaded: false,
  }));
  computePlan.mockResolvedValueOnce(mockPlan(imageModel, kinds));
  return prepareContinueEstimate({
    promptLocale: 'zh-CN',
    scopedDb: asStub<ScopedDb>({ shots: { listBySequence: async () => [] } }),
    userId: 'mock-user',
    sequence,
    work,
    requested: { generateStartFrames: true, generateVoices: false },
    draftMotion: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Continue billing tests must not call providers.')
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it.each([
  {
    name: 'mixed images with an unknown built-in rate',
    imageModel: CONFIGURED_MODEL,
    kinds: ['still', 'still'],
    expectedUsd: 0.2,
    priced: false,
    imageSource: 'platform',
  },
  {
    name: 'unbound images with an unknown rate',
    imageModel: BUILTIN_MODEL,
    kinds: ['still'],
    expectedUsd: 0.1,
    priced: false,
    imageSource: undefined,
  },
  {
    name: 'no images despite a configured sequence model',
    imageModel: CONFIGURED_MODEL,
    kinds: ['prompt:visual'],
    expectedUsd: 0,
    priced: true,
    imageSource: undefined,
  },
  {
    name: 'legacy sheet-only pricing with no still',
    imageModel: BUILTIN_MODEL,
    kinds: ['sheet:character'],
    expectedUsd: 0.1,
    priced: true,
    imageSource: undefined,
  },
] satisfies {
  name: string;
  imageModel: string;
  kinds: PlanUnitKind[];
  expectedUsd: number;
  priced: boolean;
  imageSource?: 'platform';
}[])(
  'keeps the total and display eligibility for $name',
  async ({ imageModel, kinds, expectedUsd, priced, imageSource }) => {
    const prepared = await prepareQuote(imageModel, kinds);
    expect(prepared.estimate).toEqual({
      micros: usdToMicros(expectedUsd),
      priced,
      imageSource,
    });
    expect(prepared.modelConfiguration.imageModelRouting).toEqual(MOCK_ROUTING);
    expect(computePlan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ imageModelRouting: MOCK_ROUTING })
    );
  }
);
