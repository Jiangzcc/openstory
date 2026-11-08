import { describe, expect, it, vi } from 'vitest';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import type { Locale } from '@/platform/i18n/locale';
import { storedShotSpec } from '@/shots/shot-list.schema';
import { asStub } from '@/test/as-stub';
import { derivedStillPrompt, lazySequenceStyle } from './still-prompt';

const line = 'We open in five minutes.';
const scene = {
  metadata: { location: '用户地点 / INT. KITCHEN', timeOfDay: '' },
  continuity: {},
  originalScript: { extract: `MARA\n${line}` },
};
const spec = storedShotSpec({
  shotNumber: 1,
  framing: {
    shotSize: 'medium wide',
    angle: 'eye level',
    composition: '保留用户构图 / SKU-A',
    subjectStartState: 'MARA leans over the dough',
  },
  action: 'MARA steps away',
  cameraMovement: { move: '', pacing: '' },
  direction: '',
  soundCue: '',
  dialogue: [{ character: 'MARA', line, tone: '' }],
  durationSeconds: 5,
});
const style = migrateStyleConfigV1ToV2({
  mood: 'calm',
  artStyle: 'documentary / 保留风格',
  lighting: 'natural',
  colorPalette: ['#eee'],
  cameraWork: 'handheld',
  referenceFilms: [],
  colorGrading: 'natural',
});

function mockDb(withSpec = true) {
  const getSelected = vi.fn(async () => (withSpec ? { spec } : null));
  // Only the selected-spec read participates in this helper.
  const scopedDb = asStub<Parameters<typeof derivedStillPrompt>[0]>({
    shotSpecVersions: { getSelected },
  });
  return { scopedDb, getSelected };
}

describe('derived still prompt language', () => {
  it.each<{ promptLocale: Locale; lighting: string; other: string }>([
    {
      promptLocale: 'en',
      lighting: 'Natural, even lighting',
      other: '自然、均匀的光线',
    },
    {
      promptLocale: 'zh-CN',
      lighting: '自然、均匀的光线',
      other: 'Natural, even lighting',
    },
  ])(
    'uses $promptLocale for fallback text and preserves content',
    async ({ promptLocale, lighting, other }) => {
      const { scopedDb, getSelected } = mockDb();
      const styleConfig = vi.fn(async () => style);
      const text = await derivedStillPrompt(scopedDb, {
        promptLocale,
        shotId: 'shot-1',
        scene,
        styleConfig,
      });

      expect(text).toContain(lighting);
      expect(text).not.toContain(other);
      expect(text).toContain(spec.framing.subjectStartState);
      expect(text).toContain(spec.framing.composition);
      expect(text).toContain(scene.metadata.location);
      expect(text).toContain(style.look.artStyle);
      expect(text).not.toContain(line);
      expect(text).not.toContain(spec.action);
      expect(getSelected).toHaveBeenCalledWith('shot-1');
      expect(styleConfig).toHaveBeenCalledTimes(1);
    }
  );

  it('does not load a style when the shot has no spec', async () => {
    const { scopedDb } = mockDb(false);
    const styleConfig = vi.fn(async () => style);
    expect(
      await derivedStillPrompt(scopedDb, {
        promptLocale: 'zh-CN',
        shotId: 'shot-1',
        scene,
        styleConfig,
      })
    ).toBeNull();
    expect(styleConfig).not.toHaveBeenCalled();
  });

  it('does not read a spec or style when the shot has no scene', async () => {
    const { scopedDb, getSelected } = mockDb();
    const styleConfig = vi.fn(async () => style);
    expect(
      await derivedStillPrompt(scopedDb, {
        promptLocale: 'zh-CN',
        shotId: 'shot-1',
        scene: null,
        styleConfig,
      })
    ).toBeNull();
    expect(getSelected).not.toHaveBeenCalled();
    expect(styleConfig).not.toHaveBeenCalled();
  });
});

it('loads a shared sequence style once for the batch', async () => {
  const getById = vi.fn(async () => ({ styleConfig: style }));
  // The sequence has a frozen style; no library query participates.
  const scopedDb = asStub<Parameters<typeof lazySequenceStyle>[0]>({
    sequences: { getById },
  });
  const load = lazySequenceStyle(scopedDb, { id: 'sequence-1' });
  expect(getById).not.toHaveBeenCalled();
  const first = load();
  expect(load()).toBe(first);
  expect(await first).toEqual(style);
  expect(getById).toHaveBeenCalledTimes(1);
});
