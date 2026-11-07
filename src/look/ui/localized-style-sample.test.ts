import { describe, expect, it } from 'vitest';
import { briefForStyle } from '@/look/brief-for-style';
import { translateStyleSample } from '@/look/localization/style-samples';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { sampleScriptsForStyle } from './composer-sample';
import {
  canonicalStyleSample,
  localizedStyleSample,
} from './localized-style-sample';

const englishParts = import.meta.glob<Record<string, string>>(
  '../localization/locales/en/style-samples-*.json',
  { eager: true, import: 'default' }
);
const chineseParts = import.meta.glob<Record<string, string>>(
  '../localization/locales/zh-CN/style-samples-*.json',
  { eager: true, import: 'default' }
);
const englishEntries = Object.values(englishParts).flatMap(Object.entries);
const chineseEntries = Object.values(chineseParts).flatMap(Object.entries);
const chinese: Readonly<Record<string, string>> =
  Object.fromEntries(chineseEntries);

describe('localized platform style samples', () => {
  it('covers every effective canonical and alternate sample in both resources', () => {
    const samples = DEFAULT_STYLE_TEMPLATES.flatMap(sampleScriptsForStyle);
    const sources = new Set(samples);
    expect(sources.size).toBeGreaterThan(0);
    for (const entries of [englishEntries, chineseEntries]) {
      expect(entries).toHaveLength(sources.size);
      expect(new Set(entries.map(([source]) => source))).toEqual(sources);
    }
    for (const [source, translation] of englishEntries) {
      expect(translation).toBe(source);
    }
    for (const [source, translation] of chineseEntries) {
      expect(translation).not.toBe(source);
      expect(translation).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it.each(DEFAULT_STYLE_TEMPLATES)(
    'selects all six samples for $name in either language',
    (template) => {
      const style = { ...template, isTemplate: true };
      const originals = sampleScriptsForStyle(style);
      expect(originals).toHaveLength(6);
      expect(canonicalStyleSample(style, 'en')).toBe(briefForStyle(style));
      expect(canonicalStyleSample(style, 'zh-CN')).toBe(
        chinese[briefForStyle(style)]
      );
      originals.forEach((source, index) => {
        const random = () => (index + 0.5) / originals.length;
        expect(localizedStyleSample(style, 'en', random)).toBe(source);
        expect(localizedStyleSample(style, 'zh-CN', random)).toBe(
          chinese[source]
        );
      });
    }
  );

  it.each(DEFAULT_STYLE_TEMPLATES)(
    'preserves all samples of a same-named user style: $name',
    (template) => {
      const style = { ...template, isTemplate: false };
      const originals = sampleScriptsForStyle(style);
      expect(canonicalStyleSample(style, 'zh-CN')).toBe(briefForStyle(style));
      originals.forEach((source, index) => {
        expect(
          localizedStyleSample(
            style,
            'zh-CN',
            () => (index + 0.5) / originals.length
          )
        ).toBe(source);
      });
    }
  );

  it('preserves unknown upstream sample text and user-added text verbatim', () => {
    const unknown = 'A new upstream sample with <references> and {{tokens}}.';
    expect(translateStyleSample(unknown, 'zh-CN')).toBe(unknown);
    const [template] = DEFAULT_STYLE_TEMPLATES;
    if (!template) throw new Error('Expected a platform template');
    const edited = `${briefForStyle(template)}\nMy own ending stays as written.`;
    expect(translateStyleSample(edited, 'zh-CN')).toBe(edited);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'treats an unknown prototype property as literal source text: %s',
    (source) => {
      expect(translateStyleSample(source, 'zh-CN')).toBe(source);
    }
  );

  it('preserves a style without the managed-template flag', () => {
    const [template] = DEFAULT_STYLE_TEMPLATES;
    if (!template) throw new Error('Expected a platform template');
    const style = { ...template, isTemplate: null };
    expect(canonicalStyleSample(style, 'zh-CN')).toBe(briefForStyle(style));
    expect(localizedStyleSample(style, 'zh-CN', () => 0)).toBe(
      briefForStyle(style)
    );
  });

  it('keeps the existing empty-sample behavior for an unmapped category', () => {
    const style = { name: 'Future template', category: null, isTemplate: true };
    expect(localizedStyleSample(style, 'zh-CN')).toBeNull();
    expect(localizedStyleSample(style, 'en')).toBeNull();
    expect(() => canonicalStyleSample(style, 'zh-CN')).toThrow(
      'No canonical brief'
    );
  });
});
