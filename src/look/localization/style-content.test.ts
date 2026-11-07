import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { StyleConfigSchema } from '@/look/style-config';
import type { StyleConfig } from '@/look/style-config';
import {
  localizeTemplateStyleConfig,
  translateStyleContent,
} from './style-content';
import enPresets from '@/ui/i18n/locales/en/presets.json';
import zhPresets from '@/ui/i18n/locales/zh-CN/presets.json';

const englishParts = import.meta.glob<Record<string, string>>(
  './locales/en/style-content-*.json',
  { eager: true, import: 'default' }
);
const chineseParts = import.meta.glob<Record<string, string>>(
  './locales/zh-CN/style-content-*.json',
  { eager: true, import: 'default' }
);
const englishEntries = Object.values(englishParts).flatMap(Object.entries);
const chineseEntries = Object.values(chineseParts).flatMap(Object.entries);
const englishLabels: Readonly<Record<string, string>> = enPresets;
const chineseLabels: Readonly<Record<string, string>> = zhPresets;

function proseFields(config: StyleConfig) {
  return [
    config.look.mood,
    config.look.artStyle,
    config.look.lighting,
    config.look.colorGrading,
    config.motion.camera,
    ...(config.look.medium ? [config.look.medium] : []),
    ...(config.motion.shots ? [config.motion.shots] : []),
    ...config.references,
  ];
}

function firstTemplate() {
  const style = DEFAULT_STYLE_TEMPLATES[0];
  if (!style) throw new Error('The platform style catalog is empty');
  return style;
}

describe('platform style content localization', () => {
  it('covers exactly the current template content in both resources', () => {
    const sources = new Set(
      DEFAULT_STYLE_TEMPLATES.flatMap((style) => [
        ...proseFields(style.config),
        ...(style.config.motion.pace ? [style.config.motion.pace] : []),
        ...(style.tags ?? []),
      ])
    );
    expect(sources.size).toBeGreaterThan(0);
    for (const entries of [englishEntries, chineseEntries]) {
      const keys = entries.map(([source]) => source);
      expect(new Set(keys)).toEqual(sources);
      expect(keys).toHaveLength(sources.size);
    }
  });

  it('covers every platform style name and description in the preset resources', () => {
    for (const style of DEFAULT_STYLE_TEMPLATES) {
      for (const source of [
        style.name,
        ...(style.description ? [style.description] : []),
      ]) {
        expect(englishLabels[source], source).toBe(source);
        expect(chineseLabels[source], source).not.toBe(source);
        expect(chineseLabels[source], source).toMatch(/[\u4e00-\u9fff]/);
      }
    }
  });

  it('keeps independent English resources faithful to their source keys', () => {
    for (const [source, value] of englishEntries) {
      expect(value).toBe(source);
      expect(translateStyleContent(source, 'en')).toBe(value);
      expect(translateStyleContent(source, 'zh-CN'), source).not.toBe(value);
    }
  });

  it.each(DEFAULT_STYLE_TEMPLATES)(
    'covers $name without changing protocol fields',
    (style) => {
      const original = structuredClone(style.config);
      const localized = localizeTemplateStyleConfig(style, 'zh-CN');
      expect(StyleConfigSchema.safeParse(localized).success).toBe(true);
      for (const source of [
        ...proseFields(style.config),
        ...(style.tags ?? []),
      ]) {
        expect(translateStyleContent(source, 'zh-CN'), source).not.toBe(source);
        expect(translateStyleContent(source, 'en')).toBe(source);
      }
      expect(localized.look.colorPalette).toEqual(
        style.config.look.colorPalette
      );
      expect(localized.motion.pace).toBe(style.config.motion.pace);
      expect(localized.motion.energy).toBe(style.config.motion.energy);
      expect(localized.version).toBe(style.config.version);
      expect(style.config).toEqual(original);
      expect(localizeTemplateStyleConfig(style, 'en')).toEqual(original);
      expect(
        localizeTemplateStyleConfig({ ...style, config: localized }, 'zh-CN')
      ).toEqual(localized);
    }
  );

  it.each([false, null])(
    'preserves non-template styles with isTemplate=%s even when their text matches',
    (isTemplate) => {
      const style = firstTemplate();
      expect(
        localizeTemplateStyleConfig({ ...style, isTemplate }, 'zh-CN')
      ).toEqual(style.config);
    }
  );

  it('preserves edited fields and translates only exact known source text', () => {
    const style = firstTemplate();
    const customMood = 'My own mood. Keep this exact wording.';
    const config = {
      ...style.config,
      look: { ...style.config.look, mood: customMood },
      references: ['My own reference'],
    };
    const localized = localizeTemplateStyleConfig(
      { ...style, config },
      'zh-CN'
    );
    expect(localized.look.mood).toBe(customMood);
    expect(localized.look.artStyle).not.toBe(config.look.artStyle);
    expect(localized.references).toEqual(config.references);
    expect(translateStyleContent('__proto__', 'zh-CN')).toBe('__proto__');
    expect(translateStyleContent('unrecognized-upstream-tag', 'zh-CN')).toBe(
      'unrecognized-upstream-tag'
    );
  });

  it('up-converts a stored v1 recipe before applying exact translations', () => {
    const style = firstTemplate();
    const { look, motion, references } = style.config;
    const config = {
      mood: look.mood,
      artStyle: look.artStyle,
      lighting: look.lighting,
      colorPalette: look.colorPalette,
      colorGrading: look.colorGrading,
      cameraWork: motion.camera,
      referenceFilms: references,
    };
    const localized = localizeTemplateStyleConfig(
      { isTemplate: true, config },
      'zh-CN'
    );
    expect(localized.look.mood).toBe(translateStyleContent(look.mood, 'zh-CN'));
    expect(localized.motion.camera).toBe(
      translateStyleContent(motion.camera, 'zh-CN')
    );
    expect(localized.version).toBe(2);
  });
});
