import type { ImageChannelModelId } from '@/models/image-channels';
/**
 * `prepareShotImageWorkflowInput` must not read what it cannot use.
 *
 * The prompt read (`framePromptVersions.getSelected`) and the model reads
 * (`frameVariants.getSelected` / `getLastFailed`) both used to execute
 * unconditionally, including on the fully-overridden path update-stale's
 * chained renders take — results discarded. That is a wasted query AND a live
 * read of a mutable selection pointer, one careless edit away from silently
 * regaining a consumer and reintroducing the mid-run staleness class (#1067).
 *
 * These tests pin BOTH directions: skipped when nothing consumes them, and
 * still executed on every path that does. The second half is the one that
 * catches an over-eager guard — dropping the `promptVersionOverride ===
 * undefined` case would null `promptVersionId` for `generateShotImageFn`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { unpackModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_IMAGE_MODEL } from '@/models/models';
import type { Frame, Shot } from '@/platform/server/db/schema';
import { asStub } from '@/test/as-stub';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import type { Scene } from '@/shots/scene-analysis.schema';
import { storedShotSpec } from '@/shots/shot-list.schema';

vi.doMock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => ({}),
}));
const requireCredits = vi.fn(async () => undefined);
vi.doMock('@/billing/server/preflight', () => ({
  requireCredits,
}));

const loadConfiguration = vi
  .fn<() => Promise<ModelRuntimeConfiguration>>()
  .mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
vi.doMock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: loadConfiguration,
}));

// Dynamic import so the mocks above apply (vi.doMock is not hoisted).
const { prepareShotImageWorkflowInput } = await import('./shot-image-input');
const { NO_STILL_PROMPT_MESSAGE } = await import('./still-prompt');

const FRAME_ID = 'frm_1';

function makeScopedDb() {
  const writePrompt = vi.fn(async () => ({ id: 'fpv_user_edit' }));
  const getSelectedPrompt = vi.fn(async () => ({
    id: 'fpv_selected',
    text: 'Stored prompt',
  }));
  const getSelectedVariant = vi.fn(async () => ({ model: 'flux_2_max' }));
  const getLastFailed = vi.fn(async () => ({ model: 'seedream_v5' }));
  const stub = {
    framePromptVersions: { getSelected: getSelectedPrompt, write: writePrompt },
    frameVariants: {
      getSelected: getSelectedVariant,
      getLastFailed,
    },
  };
  // minimal stub: the mocks above remove every other scopedDb consumer
  const scopedDb =
    asStub<Parameters<typeof prepareShotImageWorkflowInput>[0]['scopedDb']>(
      stub
    );
  return {
    scopedDb,
    getSelectedPrompt,
    getSelectedVariant,
    getLastFailed,
    writePrompt,
  };
}

function baseArgs(scopedDb: ReturnType<typeof makeScopedDb>['scopedDb']) {
  // only `id` is read off the shot on this path
  const shot = asStub<Shot>({ id: 'sht_1' });
  // only `id` is read off the frame
  const frame = asStub<Frame>({ id: FRAME_ID });
  return {
    scopedDb,
    sequence: {
      id: 'seq_1',
      organizationId: 'team_1',
      aspectRatio: '16:9' as const,
      resolution: '720p' as const,
      imageModel: DEFAULT_IMAGE_MODEL,
      styleId: null,
      analysisModel: 'anthropic/claude-haiku-4.5',
      referenceOnly: false,
    },
    shot,
    frame,
    scene: null,
    scriptExtract: 'INT. HALLWAY — NIGHT',
    userId: 'usr_1',
    deriveMissingPrompt: true,
    // Sequence-scoped refs supplied, so the bible reads don't run either.
    refs: { characters: [], locations: [], elements: [] },
  };
}

describe('prepareShotImageWorkflowInput skips reads nothing consumes', () => {
  it('a fully-overridden chained render reads neither the prompt nor the variants', async () => {
    const { scopedDb, getSelectedPrompt, getSelectedVariant, getLastFailed } =
      makeScopedDb();

    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...baseArgs(scopedDb),
      promptOverride: 'Prompt resolved by the caller',
      promptVersionOverride: 'fpv_from_caller',
      modelOverride: 'nano_banana_pro',
    });

    expect(getSelectedPrompt).not.toHaveBeenCalled();
    expect(getSelectedVariant).not.toHaveBeenCalled();
    expect(getLastFailed).not.toHaveBeenCalled();
    // And the overrides are what actually land on the payload.
    expect(input.prompt).toBe('Prompt resolved by the caller');
    expect(input.promptVersionId).toBe('fpv_from_caller');
    expect(input.model).toBe('nano_banana_pro');
  });

  it('an explicit null version override still skips the prompt read', async () => {
    // `null` means "this prompt came from no version" — a real answer, not an
    // omission, so there is nothing left to look up.
    const { scopedDb, getSelectedPrompt } = makeScopedDb();

    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...baseArgs(scopedDb),
      promptOverride: 'Prompt resolved by the caller',
      promptVersionOverride: null,
      modelOverride: 'nano_banana_pro',
    });

    expect(getSelectedPrompt).not.toHaveBeenCalled();
    expect(input.promptVersionId).toBeNull();
  });
});

describe('prepareShotImageWorkflowInput still reads what it does consume', () => {
  it('no overrides at all → both reads run and feed the payload', async () => {
    const { scopedDb, getSelectedPrompt, getSelectedVariant, getLastFailed } =
      makeScopedDb();

    const input = await prepareShotImageWorkflowInput({
      ...baseArgs(scopedDb),
      promptLocale: 'en',
    });

    expect(getSelectedPrompt).toHaveBeenCalledWith(FRAME_ID);
    expect(getSelectedVariant).toHaveBeenCalledWith(FRAME_ID);
    expect(getLastFailed).toHaveBeenCalledWith(FRAME_ID);
    expect(input.prompt).toBe('Stored prompt');
    expect(input.promptVersionId).toBe('fpv_selected');
    // A failed attempt awaiting retry outranks the selected version (#1066).
    expect(input.model).toBe('seedream_v5');
  });

  it('a prompt override WITHOUT a version override still reads the selection', async () => {
    // `generateShotImageFn`'s shape: it supplies the prompt but relies on the
    // live pointer for `promptVersionId`. Skipping the read here would stamp
    // null and detach the render from its prompt's history.
    const { scopedDb, getSelectedPrompt } = makeScopedDb();

    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...baseArgs(scopedDb),
      promptOverride: 'Hand-typed prompt',
      modelOverride: 'nano_banana_pro',
    });

    expect(getSelectedPrompt).toHaveBeenCalledWith(FRAME_ID);
    expect(input.promptVersionId).toBe('fpv_selected');
  });

  it('a claimed user edit reads the selection to check it is not a no-op edit', async () => {
    const { scopedDb, getSelectedPrompt, writePrompt } = makeScopedDb();

    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...baseArgs(scopedDb),
      promptOverride: 'Hand-typed prompt',
      promptVersionOverride: 'fpv_from_caller',
      modelOverride: 'nano_banana_pro',
      userEditedPrompt: true,
    });

    expect(getSelectedPrompt).toHaveBeenCalledWith(FRAME_ID);
    // The edit lands at the click, and the run renders from that row (#1786).
    expect(writePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hand-typed prompt',
        source: 'user-edit',
      })
    );
    expect(input.promptVersionId).toBe('fpv_user_edit');
  });

  it('an override naming a retired model still falls through to the variant reads', async () => {
    // The guard is on VALIDITY, not presence: `resolveImageModel` takes the
    // first valid candidate, so an id dropped from the catalog must still
    // resolve through the last-failed / selected rows exactly as before.
    const { scopedDb, getSelectedVariant, getLastFailed } = makeScopedDb();

    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...baseArgs(scopedDb),
      promptOverride: 'Prompt resolved by the caller',
      promptVersionOverride: 'fpv_from_caller',
      // simulating an id retired from the catalog since the row was written
      modelOverride: asStub<
        Parameters<typeof prepareShotImageWorkflowInput>[0]['modelOverride']
      >('model_retired_from_catalog'),
    });

    expect(getSelectedVariant).toHaveBeenCalledWith(FRAME_ID);
    expect(getLastFailed).toHaveBeenCalledWith(FRAME_ID);
    expect(input.model).toBe('seedream_v5');
  });
});

describe('prepareShotImageWorkflowInput refuses a blank prompt before credits', () => {
  it('throws on a whitespace-only override without reserving credits', async () => {
    requireCredits.mockClear();
    const { scopedDb } = makeScopedDb();

    await expect(
      prepareShotImageWorkflowInput({
        promptLocale: 'en' as const,
        ...baseArgs(scopedDb),
        promptOverride: '   ',
        promptVersionOverride: 'fpv_from_caller',
        modelOverride: 'nano_banana_pro',
      })
    ).rejects.toThrow(NO_STILL_PROMPT_MESSAGE);

    expect(requireCredits).not.toHaveBeenCalled();
  });
});

function configuredModels(
  modelId: ImageChannelModelId = 'custom-image:qwen'
): ModelRuntimeConfiguration {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock image binding.');
  model.id = modelId;
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: createImageModelRoutingSnapshot(configuration),
  };
}

describe('configured shot image billing snapshots', () => {
  beforeEach(() => {
    loadConfiguration.mockReset();
    requireCredits.mockClear();
  });

  it.each([
    { change: 'disabled', modelId: 'custom-image:qwen' },
    { change: 'repriced', modelId: 'custom-image:qwen' },
    { change: 'disabled', modelId: 'gpt_image_2' },
    { change: 'repriced', modelId: 'gpt_image_2' },
  ] as const)(
    'keeps the $modelId workflow snapshot after the live channel is $change',
    async ({ change, modelId }) => {
      const frozen = configuredModels(modelId);
      loadConfiguration.mockResolvedValue({
        ...frozen,
        imageModelRouting:
          change === 'disabled'
            ? []
            : frozen.imageModelRouting?.map((route) => ({
                ...route,
                priceCards: route.priceCards.map((card) => ({
                  ...card,
                  unitPriceUsd: 1,
                })),
              })),
      });
      const { scopedDb } = makeScopedDb();
      const input = await prepareShotImageWorkflowInput({
        promptLocale: 'en' as const,
        ...baseArgs(scopedDb),
        modelOverride: modelId,
        modelConfiguration: frozen,
        promptOverride: 'Mock frozen prompt',
        promptVersionOverride: 'mock-prompt-version',
        reservationId: 'mock-frozen-hold',
      });
      expect(loadConfiguration).not.toHaveBeenCalled();
      expect(requireCredits).toHaveBeenCalledWith(
        scopedDb,
        100000,
        expect.objectContaining({
          imageSource: 'platform',
          reservationId: 'mock-frozen-hold',
        })
      );
      expect(
        unpackModelRuntimeConfiguration(
          input.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION
        )
      ).toEqual(frozen);
    }
  );

  it('gates the exact sequence resolution frozen onto the image workflow', async () => {
    const frozen = configuredModels();
    const route = frozen.imageModelRouting?.[0];
    if (!route) throw new Error('Missing mock resolution route.');
    route.parameters = route.parameters.map((parameter) => ({
      ...parameter,
      defaultValue: '1280x720',
      values: ['1280x720', '1920x1080'],
    }));
    route.priceCards = route.priceCards.flatMap((card) => [
      {
        ...card,
        id: card.id + '-720',
        match: { size: '1280x720' },
        unitPriceUsd: 0.1,
      },
      {
        ...card,
        id: card.id + '-1080',
        match: { size: '1920x1080' },
        unitPriceUsd: 0.2,
      },
    ]);
    const { scopedDb } = makeScopedDb();
    const args = baseArgs(scopedDb);
    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...args,
      sequence: { ...args.sequence, resolution: '1080p' },
      modelOverride: 'custom-image:qwen',
      modelConfiguration: frozen,
    });
    expect(requireCredits).toHaveBeenCalledWith(
      scopedDb,
      200000,
      expect.objectContaining({ imageSource: 'platform' })
    );
    expect(input.resolution).toBe('1080p');
    expect(
      unpackModelRuntimeConfiguration(
        input.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION
      )
    ).toEqual(frozen);
    expect(loadConfiguration).not.toHaveBeenCalled();
  });

  it('loads current prices for a request without a trusted workflow snapshot', async () => {
    const current = configuredModels();
    current.imageModelRouting = current.imageModelRouting?.map((route) => ({
      ...route,
      priceCards: route.priceCards.map((card) => ({
        ...card,
        unitPriceUsd: 1,
      })),
    }));
    loadConfiguration.mockResolvedValue(current);
    const { scopedDb } = makeScopedDb();
    const input = await prepareShotImageWorkflowInput({
      promptLocale: 'en' as const,
      ...baseArgs(scopedDb),
      modelOverride: 'custom-image:qwen',
    });
    expect(loadConfiguration).toHaveBeenCalledTimes(1);
    expect(requireCredits).toHaveBeenCalledWith(
      scopedDb,
      1000000,
      expect.objectContaining({ imageSource: 'platform' })
    );
    expect(
      unpackModelRuntimeConfiguration(
        input.modelConfiguration ?? DEFAULT_MODEL_CONFIGURATION
      )
    ).toEqual(current);
  });

  it('refuses a request whose configured model is currently disabled', async () => {
    loadConfiguration.mockResolvedValue({
      ...configuredModels(),
      imageModelRouting: [],
    });
    const { scopedDb } = makeScopedDb();
    await expect(
      prepareShotImageWorkflowInput({
        promptLocale: 'en' as const,
        ...baseArgs(scopedDb),
        modelOverride: 'custom-image:qwen',
      })
    ).rejects.toThrow('Configured image model is unavailable.');
    expect(loadConfiguration).toHaveBeenCalledTimes(1);
    expect(requireCredits).not.toHaveBeenCalled();
  });
});

describe('prepareShotImageWorkflowInput never prompts a still with the script (#2291)', () => {
  beforeEach(() => {
    loadConfiguration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
  });

  const LINE = 'We open in five minutes.';
  const scene = asStub<Scene>({
    metadata: { location: 'INT. BAKERY KITCHEN', timeOfDay: 'early morning' },
    continuity: {},
    originalScript: {
      extract: `MARA kneads dough.\n\nMARA\n${LINE}`,
      dialogue: [{ character: 'MARA', line: LINE, tone: '' }],
    },
  });
  const spec = storedShotSpec({
    shotNumber: 1,
    framing: {
      shotSize: 'medium wide',
      angle: 'eye level',
      composition: 'MARA at the steel bench',
      subjectStartState: 'MARA leans over the dough',
    },
    action: 'MARA kneads the dough',
    cameraMovement: { move: 'handheld drift', pacing: 'unhurried' },
    direction: '',
    soundCue: '',
    dialogue: [{ character: 'MARA', line: LINE, tone: '' }],
    durationSeconds: 5,
  });
  const styleConfig = migrateStyleConfigV1ToV2({
    mood: 'calm',
    artStyle: 'documentary',
    lighting: 'natural',
    colorPalette: ['#eee'],
    cameraWork: 'handheld',
    referenceFilms: [],
    colorGrading: 'natural',
  });

  function promptlessDb(withSpec: boolean) {
    return asStub<
      Parameters<typeof prepareShotImageWorkflowInput>[0]['scopedDb']
    >({
      framePromptVersions: { getSelected: vi.fn(async () => null) },
      frameVariants: {
        getSelected: vi.fn(async () => null),
        getLastFailed: vi.fn(async () => null),
      },
      shotSpecVersions: {
        getSelected: vi.fn(async () => (withSpec ? { spec } : null)),
      },
      sequences: { getById: vi.fn(async () => ({ styleConfig })) },
      styles: { getById: vi.fn(async () => null) },
    });
  }

  it.each([
    ['en', 'Natural lighting appropriate to early morning'],
    ['zh-CN', '符合early morning的自然光'],
  ] as const)(
    'derives a %s prompt without the spoken line',
    async (promptLocale, lighting) => {
      const scopedDb = promptlessDb(true);
      const input = await prepareShotImageWorkflowInput({
        ...baseArgs(scopedDb),
        promptLocale,
        scene,
        scriptExtract: scene.originalScript.extract,
      });
      expect(input.prompt).toContain('MARA leans over the dough');
      expect(input.prompt).toContain(lighting);
      expect(input.prompt).not.toContain(LINE);
      expect(input.promptLocale).toBe(promptLocale);
    }
  );

  it('a workflow step never reads the spec pointer mid-run', async () => {
    const scopedDb = promptlessDb(true);
    await expect(
      prepareShotImageWorkflowInput({
        ...baseArgs(scopedDb),
        promptLocale: 'en',
        scene,
        scriptExtract: scene.originalScript.extract,
        deriveMissingPrompt: false,
      })
    ).rejects.toThrow(NO_STILL_PROMPT_MESSAGE);
    expect(scopedDb.shotSpecVersions.getSelected).not.toHaveBeenCalled();
  });

  it('refuses a shot with no prompt and no spec', async () => {
    const scopedDb = promptlessDb(false);
    await expect(
      prepareShotImageWorkflowInput({
        ...baseArgs(scopedDb),
        promptLocale: 'en',
        scene,
        scriptExtract: scene.originalScript.extract,
      })
    ).rejects.toThrow(NO_STILL_PROMPT_MESSAGE);
  });
});
