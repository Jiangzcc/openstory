import { describe, expect, it } from 'vitest';
import type { Locale } from '@/platform/i18n/locale';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { pickShufflePrompt, studioShufflePrompts } from './prompt-shuffle';

describe('studioShufflePrompts', () => {
  it('returns a non-empty pool for each activity', () => {
    expect(studioShufflePrompts('image').length).toBeGreaterThan(3);
    expect(studioShufflePrompts('video').length).toBeGreaterThan(3);
    expect(studioShufflePrompts('image')).not.toEqual(
      studioShufflePrompts('video')
    );
  });

  const activities = ['image', 'video'] as const;
  const locales: Locale[] = ['zh-CN', 'en'];

  describe.each(activities)('%s sample translations', (activity) => {
    it.each(locales)('has a complete, distinct pool in %s', (locale) => {
      const t = createApplicationI18n(locale).getFixedT(locale, 'studio');
      const samples = studioShufflePrompts(activity);
      const translated = samples.map((sample) => t(sample));

      expect(new Set(translated).size).toBe(samples.length);
      for (const [index, sample] of samples.entries()) {
        if (locale === 'en') expect(translated[index]).toBe(sample);
        else {
          expect(translated[index]).not.toBe(sample);
          expect(translated[index]).toMatch(/\p{Script=Han}/u);
        }
      }
    });

    it('avoids repeating the current translated sample', () => {
      const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'studio');
      const prompts = studioShufflePrompts(activity).map((sample) => t(sample));

      for (const current of prompts) {
        expect(pickShufflePrompt(prompts, ` ${current} `, () => 0)).not.toBe(
          current
        );
        expect(pickShufflePrompt(prompts, current, () => 0.99)).not.toBe(
          current
        );
      }
    });
  });
});

describe('pickShufflePrompt', () => {
  const pool = ['alpha', 'bravo', 'charlie'] as const;

  it('never repeats the current prompt when another exists', () => {
    expect(pickShufflePrompt(pool, 'alpha', () => 0)).toBe('bravo');
    expect(pickShufflePrompt(pool, 'alpha', () => 0.99)).toBe('charlie');
  });

  it('picks across the full pool when the box is empty', () => {
    expect(pickShufflePrompt(pool, '', () => 0)).toBe('alpha');
    expect(pickShufflePrompt(pool, '  ', () => 0.99)).toBe('charlie');
  });

  it('returns the only prompt when the pool is a single item', () => {
    expect(pickShufflePrompt(['only'], 'only', () => 0)).toBe('only');
  });

  it('returns null for an empty pool', () => {
    expect(pickShufflePrompt([], '', () => 0)).toBeNull();
  });
});
