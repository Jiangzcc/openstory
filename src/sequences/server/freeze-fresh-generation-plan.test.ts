import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { Shot } from '@/platform/server/db/schema';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { StyleConfig } from '@/look/style-config';
import { asStub } from '@/test/as-stub';
import type { PlanUnit, PlanUnitKind } from '@/sequences/generation-plan';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import type { TextToImageModel } from '@/models/models';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import * as realCostEstimation from '@/billing/cost-estimation';
import { ZERO_MICROS, usdToMicros } from '@/billing/money';

const computeGenerationPlan = vi.fn(
  async (): Promise<{ units: PlanUnit[]; speakerConflicts: [] }> => ({
    units: [
      {
        kind: 'sheet:character',
        id: 'cast',
        state: 'missing',
        requires: [],
        cascaded: false,
      },
      {
        kind: 'clip',
        id: 'shot',
        state: 'missing',
        requires: [],
        cascaded: false,
      },
    ],
    speakerConflicts: [],
  })
);
const computePlan = vi.fn(async () =>
  asStub<UpdateStalePlan>({ targets: [], references: null, music: null })
);
const mockBuiltinImagePrice = usdToMicros(0.03);
const mockPricing = {
  'bytedance/seedance-2.5/image-to-video': {
    unitPrice: usdToMicros(0.001),
    unit: '1000 tokens',
  },
  'bytedance/seedance-2.5/reference-to-video': {
    unitPrice: usdToMicros(0.002),
    unit: '1000 tokens',
  },
  'fal-ai/nano-banana-2': {
    unitPrice: mockBuiltinImagePrice,
    unit: 'images',
    typicalUnitsPerCall: 1,
  },
};
const estimatePlanCost = vi.fn(
  (_options: Parameters<typeof realCostEstimation.estimatePlanCost>[0]) =>
    ZERO_MICROS
);
vi.doMock('./generation-plan', () => ({ computeGenerationPlan }));
vi.doMock('@/shots/server/update-stale-plan', () => ({ computePlan }));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: vi.fn(async () => mockPricing),
}));
vi.doMock('@/billing/cost-estimation', () => ({
  ...realCostEstimation,
  estimatePlanCost,
}));
const { freezeFreshGenerationPlan } =
  await import('./freeze-fresh-generation-plan');

const styleConfig: StyleConfig = {
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
};
const input: StoryboardWorkflowInput & { sequenceId: string } = {
  promptLocale: 'en' as const,
  title: 'Test',
  script: 'Hello',
  elementIds: [],
  cast: [],
  sequenceUrl: '/sequence',
  organizationId: 'organization',
  sequenceId: 'sequence',
  userId: 'user',
  referenceOnly: true,
  generateVoices: true,
  includeMusic: false,
  stopAt: 'references',
  imageModel: 'nano_banana_2',
  videoModel: 'grok_imagine_video_1_5',
  analysisModelId: 'google/gemini-3-flash-preview',
  aspectRatio: '16:9',
  styleConfig,
  musicPromptSource: 'ai-generated',
};
// focused planning read surface
const db = asStub<ScopedDb>({
  shots: { listBySequence: vi.fn(async () => []) },
});

const CONFIGURED_IMAGE_MODEL = 'custom-image:qwen';
const BUILTIN_IMAGE_MODEL = 'nano_banana_2';
const mockImageRouting = createImageModelRoutingSnapshot(
  imageConfigurationFixture()
);
const mockModelConfiguration = packModelRuntimeConfiguration({
  ...DEFAULT_MODEL_CONFIGURATION,
  imageModelRouting: mockImageRouting,
});
const mockNonImageCost = usdToMicros(0.07);

function imagePlan(alternateModel: TextToImageModel): UpdateStalePlan {
  return asStub<UpdateStalePlan>({
    aspectRatio: input.aspectRatio,
    sequence: { resolution: '720p' },
    music: null,
    targets: [
      {
        imageModel: CONFIGURED_IMAGE_MODEL,
        regenImage: true,
        referenceIds: [],
        imageReferenceCount: 0,
      },
      {
        imageModel: alternateModel,
        regenImage: true,
        referenceIds: ['mock-reference'],
        imageReferenceCount: 1,
      },
      {
        imageModel: CONFIGURED_IMAGE_MODEL,
        regenImage: false,
        referenceIds: [],
        imageReferenceCount: 0,
      },
    ],
    references: {
      characterSheets: [{ imageModel: alternateModel, face: null }],
      lookSheetsAfterDefault: [{ imageModel: CONFIGURED_IMAGE_MODEL }],
      locationSheets: [
        {
          imageModel: CONFIGURED_IMAGE_MODEL,
          referencePhotoUrls: ['mock-photo'],
        },
      ],
      elementSheets: {
        imageModel: CONFIGURED_IMAGE_MODEL,
        entries: [{ elementId: 'mock-element' }],
      },
    },
  });
}

function imagePlanUnits(): PlanUnit[] {
  const kinds: PlanUnitKind[] = [
    'still',
    'still',
    'sheet:character',
    'sheet:character',
    'sheet:location',
    'ref:element',
    'spec',
    'clip',
  ];
  return kinds.map((kind, index) => ({
    kind,
    id: `mock-${index}`,
    state: 'missing',
    requires: [],
    cascaded: false,
  }));
}

function renderQuotePlan(referenceOnly: boolean): UpdateStalePlan {
  const plan = imagePlan(BUILTIN_IMAGE_MODEL);
  plan.targets = plan.targets
    .slice(0, 1)
    .map((target) => ({ ...target, regenImage: !referenceOnly }));
  plan.renderOptions = {
    imageModels: [CONFIGURED_IMAGE_MODEL, BUILTIN_IMAGE_MODEL],
  };
  plan.references = referenceOnly
    ? asStub<NonNullable<UpdateStalePlan['references']>>({
        characterSheets: [],
        lookSheetsAfterDefault: [],
        elementSheets: null,
        locationSheets: [
          {
            imageModel: CONFIGURED_IMAGE_MODEL,
            referencePhotoUrls: ['mock-photo'],
          },
        ],
      })
    : null;
  return plan;
}

async function freezeRenderQuote(
  options: Required<
    Pick<
      StoryboardWorkflowInput,
      'referenceOnly' | 'draftMotion' | 'resolution'
    >
  >
) {
  const kinds: PlanUnitKind[] = [
    options.referenceOnly ? 'sheet:location' : 'still',
    'clip',
  ];
  computeGenerationPlan.mockResolvedValueOnce({
    units: kinds.map((kind) => ({
      kind,
      id: 'mock-' + kind,
      state: 'missing',
      requires: [],
      cascaded: false,
    })),
    speakerConflicts: [],
  });
  const plan = renderQuotePlan(options.referenceOnly);
  plan.sequence.resolution = options.resolution;
  computePlan.mockResolvedValueOnce(plan);
  vi.spyOn(db.shots, 'listBySequence').mockResolvedValueOnce([
    asStub<Shot>({ durationMs: 5000 }),
  ]);
  estimatePlanCost.mockImplementationOnce(realCostEstimation.estimatePlanCost);
  return freezeFreshGenerationPlan(db, {
    ...input,
    ...options,
    stopAt: 'motion',
    imageModels: [CONFIGURED_IMAGE_MODEL, BUILTIN_IMAGE_MODEL],
    videoModels: ['seedance_v2_5'],
    modelConfiguration: mockModelConfiguration,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Planning regression tests must not call paid or network APIs.')
  );
});
afterEach(() => vi.restoreAllMocks());

describe('fresh planning checkpoint', () => {
  it('caps the work and freezes click language, switches, style and models', async () => {
    await freezeFreshGenerationPlan(db, { ...input, promptLocale: 'zh-CN' });
    expect(computeGenerationPlan).toHaveBeenCalledWith(
      db,
      'sequence',
      { generateStartFrames: false, generateVoices: true, includeMusic: false },
      expect.objectContaining({
        ignoreOwnProcessing: true,
        sequenceOverrides: expect.objectContaining({
          styleConfig,
          analysisModel: input.analysisModelId,
        }),
      })
    );
    expect(computePlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        promptLocale: 'zh-CN',
        units: [
          expect.objectContaining({ kind: 'sheet:character', id: 'cast' }),
        ],
        sequenceOverrides: expect.objectContaining({
          status: 'completed',
          generateStartFrames: false,
          generateVoices: true,
          includeMusic: false,
          styleConfig,
          analysisModel: input.analysisModelId,
        }),
        renderOptions: expect.objectContaining({
          imageModels: ['nano_banana_2'],
          videoModels: ['grok_imagine_video_1_5'],
        }),
      })
    );
  });
  it('uses the auto style materialized by analysis when the original snapshot was a placeholder', async () => {
    await freezeFreshGenerationPlan(db, {
      ...input,
      pendingAutoStyleId: 'style',
    });
    expect(computePlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sequenceOverrides: expect.not.objectContaining({ styleConfig }),
      })
    );
  });

  it.each([
    {
      name: 'configured',
      imageModel: CONFIGURED_IMAGE_MODEL,
      expectedImageUsd: 0.9,
    },
    {
      name: 'mixed with a built-in default',
      imageModel: BUILTIN_IMAGE_MODEL,
      expectedImageUsd: 0.66,
    },
  ] as const)(
    'preserves frozen routes and prices $name plan images exactly once',
    async ({ imageModel, expectedImageUsd }) => {
      const plan = imagePlan(imageModel);
      computeGenerationPlan.mockResolvedValueOnce({
        units: imagePlanUnits(),
        speakerConflicts: [],
      });
      computePlan.mockResolvedValueOnce(plan);
      estimatePlanCost.mockReturnValueOnce(mockNonImageCost);
      const result = await freezeFreshGenerationPlan(db, {
        ...input,
        referenceOnly: false,
        stopAt: 'motion',
        imageModel,
        imageModels: [CONFIGURED_IMAGE_MODEL, BUILTIN_IMAGE_MODEL],
        modelConfiguration: mockModelConfiguration,
      });
      expect(computePlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          imageModelRouting: mockImageRouting,
          renderOptions: expect.objectContaining({
            imageModels: [CONFIGURED_IMAGE_MODEL, BUILTIN_IMAGE_MODEL],
          }),
        })
      );
      expect(estimatePlanCost).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          counts: expect.objectContaining({
            still: 0,
            'sheet:character': 0,
            'sheet:location': 0,
            'ref:element': 0,
            spec: 1,
            clip: 1,
          }),
          imageModelRouting: mockImageRouting,
          pricing: mockPricing,
        })
      );
      expect(result.plan).toBe(plan);
      expect(result.remainingCost).toBe(
        usdToMicros(expectedImageUsd) + mockNonImageCost
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      imageModels: [BUILTIN_IMAGE_MODEL, CONFIGURED_IMAGE_MODEL],
      references: false,
      expectedImageUsd: 0.13,
    },
    {
      imageModels: [
        CONFIGURED_IMAGE_MODEL,
        BUILTIN_IMAGE_MODEL,
        CONFIGURED_IMAGE_MODEL,
      ],
      references: false,
      expectedImageUsd: 0.13,
    },
    {
      imageModels: [BUILTIN_IMAGE_MODEL, CONFIGURED_IMAGE_MODEL],
      references: true,
      expectedImageUsd: 0.66,
    },
  ] satisfies {
    imageModels: TextToImageModel[];
    references: boolean;
    expectedImageUsd: number;
  }[])(
    'funds the full frozen fanout $imageModels with references=$references',
    async ({ imageModels, references, expectedImageUsd }) => {
      const plan = imagePlan(BUILTIN_IMAGE_MODEL);
      plan.targets = plan.targets.slice(0, 1);
      plan.renderOptions = { imageModels };
      if (!references) plan.references = null;
      computeGenerationPlan.mockResolvedValueOnce({
        units: imagePlanUnits(),
        speakerConflicts: [],
      });
      computePlan.mockResolvedValueOnce(plan);
      estimatePlanCost.mockReturnValueOnce(mockNonImageCost);
      const result = await freezeFreshGenerationPlan(db, {
        ...input,
        referenceOnly: false,
        stopAt: 'images',
        imageModel: imageModels[0] ?? BUILTIN_IMAGE_MODEL,
        imageModels,
        modelConfiguration: mockModelConfiguration,
      });
      expect(result.remainingCost).toBe(
        usdToMicros(expectedImageUsd) + mockNonImageCost
      );
      expect(estimatePlanCost.mock.calls[0]?.[0].counts).toMatchObject({
        still: 0,
        'sheet:character': 0,
        'sheet:location': 0,
        'ref:element': 0,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );
});

// Existing render estimates conservatively use the reference route at every 5s tier.
it.each([
  {
    resolution: '720p',
    draftMotion: false,
    referenceOnly: false,
    expectedVideoMicros: 226800,
  },
  {
    resolution: '1080p',
    draftMotion: false,
    referenceOnly: false,
    expectedVideoMicros: 510300,
  },
  {
    resolution: '1080p',
    draftMotion: true,
    referenceOnly: false,
    expectedVideoMicros: 100879,
  },
  {
    resolution: '720p',
    draftMotion: false,
    referenceOnly: true,
    expectedVideoMicros: 226800,
  },
  {
    resolution: '1080p',
    draftMotion: true,
    referenceOnly: true,
    expectedVideoMicros: 100879,
  },
] as const)(
  'keeps real render pricing at $resolution with draft=$draftMotion and reference-only=$referenceOnly',
  async ({ expectedVideoMicros, ...options }) => {
    const result = await freezeRenderQuote(options);
    const expectedImageMicros = usdToMicros(options.referenceOnly ? 0.2 : 0.13);
    expect(result.remainingCost).toBe(
      expectedImageMicros + expectedVideoMicros
    );
    expect(estimatePlanCost).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ...options,
        counts: expect.objectContaining({
          still: 0,
          'sheet:character': 0,
          'sheet:location': 0,
          'ref:element': 0,
          clip: 1,
        }),
        imageModelCount: 2,
        videoModels: ['seedance_v2_5'],
        videoDurationSeconds: 5,
        imageModelRouting: mockImageRouting,
      })
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }
);

it.each([
  { imageModel: BUILTIN_IMAGE_MODEL, expectedUsd: 0.06 },
  { imageModel: 'grok_imagine_image', expectedUsd: 0.2 },
] as const)(
  'retains the legacy fanout estimate or floor for unbound $imageModel',
  async ({ imageModel, expectedUsd }) => {
    const imageModels = [imageModel, 'flux_2_max'] satisfies TextToImageModel[];
    const plan = renderQuotePlan(false);
    plan.targets = plan.targets.map((target) => ({ ...target, imageModel }));
    plan.renderOptions = { imageModels };
    computePlan.mockResolvedValueOnce(plan);
    computeGenerationPlan.mockResolvedValueOnce({
      units: imagePlanUnits()
        .filter((unit) => unit.kind === 'still')
        .slice(0, 1),
      speakerConflicts: [],
    });
    estimatePlanCost.mockImplementationOnce(
      realCostEstimation.estimatePlanCost
    );
    const result = await freezeFreshGenerationPlan(db, {
      ...input,
      imageModel,
      imageModels,
      stopAt: 'images',
      modelConfiguration: mockModelConfiguration,
    });
    expect(result.remainingCost).toBe(usdToMicros(expectedUsd));
    expect(estimatePlanCost).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        counts: expect.objectContaining({ still: 1 }),
        imageModelCount: 2,
      })
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }
);
