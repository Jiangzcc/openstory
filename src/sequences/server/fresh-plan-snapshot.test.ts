import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type {
  Sequence,
  SequenceElementMinimal,
} from '@/platform/server/db/schema';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { PlanUnit } from '@/sequences/generation-plan';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { usdToMicros } from '@/billing/money';
import { asStub } from '@/test/as-stub';

const mocks = vi.hoisted(() => ({
  loadConfiguration: vi.fn(),
  network: vi.fn(async () => {
    throw new Error('Unexpected network in synthetic fresh-plan fixture');
  }),
}));
vi.mock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: mocks.loadConfiguration,
}));
vi.mock('./generation-plan', () => ({
  computeGenerationPlan: async () => ({
    units: [
      {
        kind: 'ref:element',
        id: 'synthetic-element',
        state: 'missing',
        requires: [],
        cascaded: false,
      },
    ],
    speakerConflicts: [],
  }),
}));
vi.mock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => ({
    'fal-ai/nano-banana-2': {
      unitPrice: usdToMicros(0.03),
      unit: 'images',
      typicalUnitsPerCall: 1,
    },
  }),
}));
import { freezeFreshGenerationPlan } from './freeze-fresh-generation-plan';
import { computePlan } from '@/shots/server/update-stale-plan';

// Synthetic row readers; freeze, computePlan, reference construction and routing/billing helpers are real.
const input: StoryboardWorkflowInput & { sequenceId: string } = {
  promptLocale: 'en',
  userId: 'synthetic-user',
  organizationId: 'synthetic-organization',
  sequenceId: 'synthetic-sequence',
  sequenceUrl: '/synthetic-sequence',
  title: 'Synthetic snapshot plan',
  script: '原文保持 original script',
  cast: [],
  elementIds: [],
  referenceOnly: true,
  generateVoices: false,
  includeMusic: false,
  stopAt: 'references',
  imageModel: 'nano_banana_2',
  videoModel: 'grok_imagine_video_1_5',
  analysisModelId: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
  aspectRatio: '16:9',
  styleConfig: {
    version: 2,
    look: {
      artStyle: 'watercolor',
      mood: 'quiet',
      lighting: 'soft',
      colorPalette: ['blue'],
      colorGrading: 'cool',
    },
    motion: { camera: 'locked' },
    references: [],
  },
  musicPromptSource: 'ai-generated',
};
const sequence = asStub<Sequence>({
  id: input.sequenceId,
  organizationId: input.organizationId,
  title: input.title,
  aspectRatio: input.aspectRatio,
  resolution: '720p',
  imageModel: input.imageModel,
  videoModel: input.videoModel,
  analysisModel: input.analysisModelId,
  styleId: null,
  styleConfig: input.styleConfig,
  generateStartFrames: false,
  draftMotion: false,
});
const element = asStub<SequenceElementMinimal>({
  id: 'synthetic-element',
  token: '@synthetic',
  description: 'Synthetic element',
  consistencyTag: 'synthetic',
  firstMentionSceneId: 'synthetic-scene',
  firstMentionText: '原文',
  firstMentionLine: 1,
});
const scope = asStub<ScopedDb>({
  userId: input.userId,
  organizationId: input.organizationId,
  sequences: { getById: async () => sequence },
  shots: { listBySequence: async () => [] },
  sequenceElements: { list: async () => [element] },
});
const units: PlanUnit[] = [
  {
    kind: 'ref:element',
    id: element.id,
    state: 'missing',
    requires: [],
    cascaded: false,
  },
];
const liveRoutes = createImageModelRoutingSnapshot(
  imageConfigurationFixture()
).map((route) => ({ ...route, modelId: 'nano_banana_2' as const }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.network);
  mocks.loadConfiguration.mockResolvedValue({
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: liveRoutes,
  });
});

afterAll(() => vi.unstubAllGlobals());

describe('fresh workflow planning keeps a complete frozen routing decision', () => {
  it.each([
    { label: 'no model snapshot', modelConfiguration: undefined },
    {
      label: 'legacy defaults and text-only snapshot',
      modelConfiguration: {
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: [],
      },
    },
    {
      label: 'explicit empty image routing',
      modelConfiguration: {
        ...DEFAULT_MODEL_CONFIGURATION,
        imageModelRouting: [],
      },
    },
  ])(
    'uses built-in pricing without loading current channels for $label',
    async ({ modelConfiguration }) => {
      const result = await freezeFreshGenerationPlan(scope, {
        ...input,
        modelConfiguration,
      });
      expect(result.plan.references?.elementSheets).toMatchObject({
        imageModel: input.imageModel,
        entries: [{ elementId: element.id, token: element.token }],
      });
      expect(result.plan.references?.cost.sheets).toBe(usdToMicros(0.03));
      expect(mocks.loadConfiguration).not.toHaveBeenCalled();
      expect(mocks.network).not.toHaveBeenCalled();
    }
  );

  it('uses an explicit packed route for planning and remaining cost even when current settings differ', async () => {
    const route = liveRoutes[0];
    if (!route) throw new Error('Missing synthetic configured route');
    const frozenRoutes = [
      {
        ...route,
        priceCards: [
          {
            id: 'synthetic',
            operation: 'generate' as const,
            match: {},
            unitPriceUsd: 0.07,
          },
        ],
      },
    ];
    const result = await freezeFreshGenerationPlan(scope, {
      ...input,
      modelConfiguration: packModelRuntimeConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        imageModelRouting: frozenRoutes,
      }),
    });
    expect(result.plan.references?.cost.sheets).toBe(usdToMicros(0.07));
    expect(result.remainingCost).toBe(usdToMicros(0.07));
    expect(mocks.loadConfiguration).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
  });

  it('keeps request-side plans able to capture current routing when no frozen choice was supplied', async () => {
    const result = await computePlan({
      scopedDb: scope,
      sequenceId: input.sequenceId,
      userId: input.userId,
      promptLocale: input.promptLocale,
      units,
    });
    expect(result.references?.elementSheets?.entries).toHaveLength(1);
    expect(mocks.loadConfiguration).toHaveBeenCalledOnce();
    expect(mocks.network).not.toHaveBeenCalled();
  });
});
