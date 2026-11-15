import {
  mergeTextModelCatalog,
  textModelSupportsVision,
  resolveTextModelForVision,
} from './text-model-catalog';
import { describe, expect, it } from 'vitest';
import {
  analysisModelSupportsVision,
  DEFAULT_VISION_MODEL,
  resolveVisionModel,
} from './models.config';

// Text-only analysis models can't see the rendered still the motion-prompt pass
// conditions on (#929), so an image-bearing call on one routes to
// DEFAULT_VISION_MODEL. GLM-4.6V was tried as GLM-5.2's companion (#942) but
// couldn't do strict structured outputs, so we fell back to the default (#944).
// GLM-5.3 Flash can (#1367), so it runs its own image calls.
describe('vision-model routing', () => {
  it('routes a text-only model with an image to DEFAULT_VISION_MODEL', () => {
    expect(analysisModelSupportsVision('deepseek/deepseek-v3.2')).toBe(false);
    expect(resolveVisionModel('deepseek/deepseek-v3.2', true)).toBe(
      DEFAULT_VISION_MODEL
    );
  });

  it('leaves a text-only model unchanged when there is no image', () => {
    expect(resolveVisionModel('deepseek/deepseek-v3.2', false)).toBe(
      'deepseek/deepseek-v3.2'
    );
  });

  it('leaves a vision-capable model unchanged even with an image', () => {
    expect(resolveVisionModel('x-ai/grok-4.7', true)).toBe('x-ai/grok-4.7');
  });

  // The fallback target must itself accept images, or routing to it is pointless.
  it('DEFAULT_VISION_MODEL is itself vision-capable', () => {
    expect(analysisModelSupportsVision(DEFAULT_VISION_MODEL)).toBe(true);
  });
});

describe('configured vision fallback', () => {
  const visionModel = 'google/gemini-3.8-flash';

  it('uses the supplied model only for a text-only model carrying images', () => {
    expect(
      resolveTextModelForVision('deepseek/deepseek-v3.2', true, visionModel)
    ).toBe(visionModel);
    expect(
      resolveTextModelForVision('deepseek/deepseek-v3.2', false, visionModel)
    ).toBe('deepseek/deepseek-v3.2');
  });

  it('keeps the vision-capable model chosen by the user', () => {
    expect(resolveTextModelForVision('x-ai/grok-4.7', true, visionModel)).toBe(
      'x-ai/grok-4.7'
    );
  });

  it('does not change the default of later calls', () => {
    resolveTextModelForVision('deepseek/deepseek-v3.2', true, visionModel);
    expect(resolveTextModelForVision('deepseek/deepseek-v3.2', true)).toBe(
      DEFAULT_VISION_MODEL
    );
  });
});

const MOCK_CONFIGURED_VISION_MODEL = {
  name: 'Mock deployment',
  vision: false,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.2,
};

describe('vision policy on a supplied text catalog', () => {
  const fallback = 'custom:mock-vision';

  it('uses the configured vision capability without changing the static registry', () => {
    const id = 'x-ai/grok-4.7';
    const catalog = mergeTextModelCatalog([
      { ...MOCK_CONFIGURED_VISION_MODEL, id },
    ]);
    expect(textModelSupportsVision(id, catalog)).toBe(false);
    expect(resolveTextModelForVision(id, true, fallback, catalog)).toBe(
      fallback
    );
    expect(analysisModelSupportsVision(id)).toBe(true);
    expect(resolveVisionModel(id, true)).toBe(id);
  });

  it('preserves custom choices when no image is sent or the custom model accepts images', () => {
    const textOnly = 'custom:mock-text';
    const visual = 'custom:mock-visual';
    const catalog = mergeTextModelCatalog([
      { ...MOCK_CONFIGURED_VISION_MODEL, id: textOnly },
      { ...MOCK_CONFIGURED_VISION_MODEL, id: visual, vision: true },
    ]);
    expect(resolveTextModelForVision(textOnly, false, fallback, catalog)).toBe(
      textOnly
    );
    expect(resolveTextModelForVision(textOnly, true, fallback, catalog)).toBe(
      fallback
    );
    expect(resolveTextModelForVision(visual, true, fallback, catalog)).toBe(
      visual
    );
    expect(textModelSupportsVision('custom:missing', catalog)).toBe(false);
  });
});
