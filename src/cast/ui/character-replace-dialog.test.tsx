import { describe, expect, it } from 'vitest';
import { replaceConfirmCopy } from './character-replace-dialog';
import { createApplicationI18n } from '@/ui/i18n/runtime';

const english = createApplicationI18n('en').getFixedT('en', 'cast');

describe('replaceConfirmCopy', () => {
  it('says the slot stays when the pick is not in this sequence', () => {
    const copy = replaceConfirmCopy('Marloe', 'Ada', false, english);
    expect(copy.title).toBe('Replace Marloe with Ada?');
    expect(copy.description).toContain('Scenes stay on this slot');
    expect(copy.description).toContain('Shots that used this slot go stale');
    expect(copy.description).toContain('Nothing is copied');
  });

  it('says this card is dropped when the pick is already cast', () => {
    const copy = replaceConfirmCopy('Marloe', 'Ada', true, english);
    expect(copy.description).toContain('This card is dropped');
    expect(copy.description).toContain('remembered there');
    expect(copy.description).not.toContain('Scenes stay on this slot');
  });

  it('localizes the consequence while preserving the character names', () => {
    const chinese = createApplicationI18n('zh-CN').getFixedT('zh-CN', 'cast');
    const copy = replaceConfirmCopy('Marloe', 'Ada', true, chinese);
    expect(copy.title).toBe('将 Marloe 替换为 Ada？');
    expect(copy.description).toContain('此卡片会被移除');
    expect(copy.description).toContain('Ada');
    expect(copy.description).not.toContain('This card is dropped');
  });
});
