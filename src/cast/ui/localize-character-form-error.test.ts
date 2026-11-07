import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { localizeCharacterFormError } from './localize-character-form-error';

describe('local character form validation copy', () => {
  it.each([
    ['zh-CN', '此字段最多可填写 255 个字符。'],
    ['en', 'This field must be 255 characters or fewer.'],
  ] as const)('localizes the name length ceiling in %s', (locale, expected) => {
    const result = z.string().max(255).safeParse('a'.repeat(256));
    if (result.success) throw new Error('Expected invalid synthetic input');
    const t = createApplicationI18n(locale).getFixedT(locale, 'cast');
    expect(localizeCharacterFormError(result.error, t)).toBe(expected);
  });

  it.each([
    ['zh-CN', '此字段至少需要 1 个字符。'],
    ['en', 'Minimum number of characters: 1.'],
  ] as const)('localizes an empty required name in %s', (locale, expected) => {
    const result = z.string().trim().min(1).safeParse('  ');
    if (result.success) throw new Error('Expected invalid synthetic input');
    const t = createApplicationI18n(locale).getFixedT(locale, 'cast');
    expect(localizeCharacterFormError(result.error, t)).toBe(expected);
  });

  it('reports the actual description limit without exposing user content', () => {
    const input = 'Private description '.repeat(110);
    const result = z.string().max(2000).safeParse(input);
    if (result.success) throw new Error('Expected invalid synthetic input');
    const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
    expect(localizeCharacterFormError(result.error, t)).toBe(
      '此字段最多可填写 2000 个字符。'
    );
    expect(localizeCharacterFormError(result.error, t)).not.toContain(input);
  });

  it('uses translated guidance for other local validation failures', () => {
    const result = z.boolean().safeParse('not a boolean');
    if (result.success) throw new Error('Expected invalid synthetic input');
    const t = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
    expect(localizeCharacterFormError(result.error, t)).toBe(
      '请检查填写内容后重试。'
    );
  });
});
