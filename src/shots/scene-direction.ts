import type { Scene } from './scene-analysis.schema';
import type { StyleConfig } from '@/look/style-config';
import type { Locale } from '@/platform/i18n/locale';
import { localizedPrompt } from '@/platform/i18n/prompt-locale';

/** The moment belongs to the scene; palette, grading and art style to the look. */
export function sceneDirection(
  scene: {
    metadata?: { location?: string | null; timeOfDay?: string | null } | null;
    continuity?: {
      lightingSetup?: string | null;
      colorPalette?: string | null;
    } | null;
  },
  style?: StyleConfig,
  locale: Locale = 'en'
) {
  const timeOfDay = scene.metadata?.timeOfDay?.trim() || '';
  return {
    location: scene.metadata?.location?.trim() || '',
    timeOfDay,
    lightingSetup:
      scene.continuity?.lightingSetup?.trim() ||
      (timeOfDay
        ? localizedPrompt(
            locale,
            `Natural lighting appropriate to ${timeOfDay}`,
            `符合${timeOfDay}的自然光`
          )
        : localizedPrompt(
            locale,
            'Natural, even lighting',
            '自然、均匀的光线'
          )),
    colorPalette:
      scene.continuity?.colorPalette?.trim() ||
      style?.look.colorPalette.join(', ') ||
      '',
    look: [style?.look.medium, style?.look.artStyle, style?.look.colorGrading]
      .filter(Boolean)
      .join(', '),
  };
}

/** Prompt authors receive only the editable direction; legacy styleTag never competes. */
export function scenePromptContext(scene: Scene, style: StyleConfig) {
  const direction = sceneDirection(scene, style);
  return {
    ...scene,
    continuity: scene.continuity && {
      ...scene.continuity,
      lightingSetup: direction.lightingSetup,
      colorPalette: direction.colorPalette,
      styleTag: undefined,
    },
    direction,
  };
}
