import { createApplicationI18n } from '@/ui/i18n/runtime';
import { describe, expect, it } from 'vitest';
import { localizeDialogueTakeLabel } from './localize-dialogue-take-label';

describe('dialogue take display localization', () => {
  it.each([
    ['One take · 1 shot', '同次配音 · 1 个镜头'],
    ['One take · 3 shots', '同次配音 · 3 个镜头'],
    ['Older take · 2 shots', '较早的配音 · 2 个镜头'],
    ['Newer take · 2 shots', '较新的配音 · 2 个镜头'],
    ['Your take', '你的录音'],
    ['Unrecognized caption', 'Unrecognized caption'],
  ])('localizes %s without changing source captions', (source, chinese) => {
    expect(
      localizeDialogueTakeLabel(createApplicationI18n('zh-CN'), source)
    ).toBe(chinese);
    expect(localizeDialogueTakeLabel(createApplicationI18n('en'), source)).toBe(
      source
    );
  });
});
