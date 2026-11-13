import { describe, expect, it, vi } from 'vitest';
import { TEST_FAL_PRICING } from '@/billing/fal-pricing-fixture';
import { estimateVideoCost, gateEstimate } from '@/billing/cost-estimation';
import { ZERO_MICROS } from '@/billing/money';
import { resolveShotDuration } from '@/motion/resolve-shot-duration';
import type { ReferenceImageDescription } from '@/stills/reference-image-prompt';
import { asStub } from '@/test/as-stub';

const triggerWorkflow = vi.fn(async () => 'wf_video');
const buildMotionReferenceImagesMock = vi.fn(
  (): ReferenceImageDescription[] => []
);
vi.doMock('@/platform/server/workflow/client', () => ({ triggerWorkflow }));
vi.doMock('@/motion/server/build-motion-references', async () => ({
  ...(await vi.importActual<
    typeof import('@/motion/server/build-motion-references')
  >('@/motion/server/build-motion-references')),
  buildMotionReferenceImages: buildMotionReferenceImagesMock,
}));
vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => TEST_FAL_PRICING,
}));
vi.doMock('@/platform/server/db/scoped-workflow', () => ({
  toWorkflowScopedDb: (db: unknown) => db,
}));
vi.doMock('@/motion/server/motion-generation', () => ({
  canRenderReferenceOnly: async () => true,
  seedanceRunsOnArk: async () => false,
}));
vi.doMock('@/look/server/sequence-style', () => ({
  loadSequenceStyle: async () => ({
    look: {
      mood: 'quiet',
      artStyle: 'watercolour',
      lighting: 'soft light',
      colorPalette: ['silver'],
      colorGrading: 'cool shadows',
    },
    motion: { camera: 'locked' },
    references: [],
  }),
}));
vi.doMock('@/shots/server/scene-script', () => ({
  loadSceneContextBySequence: async () => new Map(),
  resolveSceneForShot: () => ({
    scene: {
      metadata: { title: 'Kitchen' },
      originalScript: { extract: 'A baker works.', dialogue: [] },
      continuity: { characterTags: [] },
    },
  }),
}));
vi.doMock('@/shots/shot-view', () => ({
  toShotView: (
    shot: Record<string, unknown>,
    frame: unknown,
    extras: Record<string, unknown>
  ) => ({
    ...shot,
    frame,
    ...extras,
    imageStatus: 'completed',
    image: extras.image,
  }),
}));

const { addModelToSequence } = await import('./sequence-models');
type Context = Parameters<typeof addModelToSequence>[0];

describe('add video model duration pricing', () => {
  it('uses each shot duration for both the reservation and payload', async () => {
    const shot = {
      id: 'shot-1',
      sceneId: 'scene-1',
      durationMs: 10_000,
      useStartFrame: true,
    };
    const frame = { id: 'frame-1', shotId: shot.id };
    const still = { id: 'still-1', url: 'https://cdn/still.png' };
    const createReservation = vi.fn(async () => ({
      ok: true as const,
      reservationId: 'reservation-1',
      remaining: ZERO_MICROS,
      replay: false,
    }));
    const context = asStub<Context>({
      promptLocale: 'en',
      user: { id: 'user-1' },
      sequence: {
        id: 'sequence-1',
        organizationId: 'organization-1',
        aspectRatio: '16:9',
        resolution: '720p',
        styleId: null,
        styleConfig: null,
        generateStartFrames: true,
      },
      scopedDb: {
        apiKeys: { hasUsableKey: vi.fn(async () => false) },
        billing: { createReservation },
        shots: {
          listBySequence: vi.fn(async () => [shot]),
          ensureAnchorFrames: vi.fn(async () => {}),
        },
        frames: {
          listAnchorsBySequence: vi.fn(async () => [frame]),
        },
        frameVariants: {
          getSelectedByFrameIds: vi.fn(
            async () => new Map([['frame-1', still]])
          ),
          getPrimaryByFrameIds: vi.fn(
            async () => new Map([['frame-1', still]])
          ),
        },
        framePromptVersions: {
          getSelectedByFrameIds: vi.fn(async () => new Map()),
        },
        videoVariants: {
          listBySequence: vi.fn(async () => []),
          getSelectedByShotIds: vi.fn(async () => new Map()),
          getPrimaryByShotIds: vi.fn(async () => new Map()),
        },
        characters: {
          listWithSheets: vi.fn(async () => []),
          list: vi.fn(async () => []),
        },
        sequenceElements: { list: vi.fn(async () => []) },
        locations: { listWithReferences: vi.fn(async () => []) },
        shotDialogue: { getSelectedBySequence: vi.fn(async () => []) },
        shotPromptVersions: {
          getSelectedMotionByShots: vi.fn(async () => new Map()),
        },
      },
    });

    const model = 'kling_v3_pro' as const;
    const references: ReferenceImageDescription[] = [
      {
        referenceImageUrl: 'https://cdn/sarah.png',
        provenanceKey: 'character:char-sarah:sheet-1',
        description: 'Sarah - Short dark hair',
        role: 'character',
        token: 'Sarah',
        isPerson: true,
      },
    ];
    buildMotionReferenceImagesMock.mockReturnValue(references);
    const result = await addModelToSequence(context, {
      variantType: 'video',
      model,
    });

    const duration = resolveShotDuration({
      durationMs: shot.durationMs,
      model,
    });
    const expectedCost = gateEstimate(
      estimateVideoCost(model, duration, {
        pricing: TEST_FAL_PRICING,
        resolution: '720p',
        hasReferenceImages: true,
        referenceOnly: false,
      }),
      { model, operation: 'add-video-model' }
    );
    expect(result).toMatchObject({ variantType: 'video', model, count: 1 });
    expect(createReservation).toHaveBeenCalledWith(
      expectedCost,
      expect.objectContaining({ sequenceId: 'sequence-1' })
    );
    expect(triggerWorkflow).toHaveBeenCalledWith(
      '/motion-batch',
      expect.objectContaining({
        shots: [
          expect.objectContaining({
            shotId: shot.id,
            duration,
            referenceImages: references,
          }),
        ],
      }),
      expect.anything()
    );
  });
});
