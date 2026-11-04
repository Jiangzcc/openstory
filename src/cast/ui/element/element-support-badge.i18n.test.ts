import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { elementSupportSummary } from './element-support-badge';

describe('element support display localization', () => {
  it('localizes duration bounds while retaining default English output', () => {
    const chinese = createApplicationI18n('zh-CN').getFixedT(null, 'cast');
    const english = createApplicationI18n('en').getFixedT(null, 'cast');
    const original = elementSupportSummary('video', 20);
    const translated = elementSupportSummary('video', 20, null, chinese);
    expect(translated).toContain('最长');
    expect(translated).not.toContain('s max');
    expect(elementSupportSummary('video', 20, null, english)).toBe(original);
  });
});
