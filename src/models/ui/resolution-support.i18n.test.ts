import { resolutionCeilingNote } from '@/models/ui/resolution-support';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { describe, expect, it } from 'vitest';

describe('resolution note localization', () => {
  it('translates known constraints and retains the default English contract', () => {
    const selection = {
      imageModels: ['nano_banana_2_lite'],
      videoModels: ['seedance_v2_mini'],
    } as const;
    const chinese = createApplicationI18n('zh-CN').getFixedT(null, 'interface');
    const english = createApplicationI18n('en').getFixedT(null, 'interface');
    expect(resolutionCeilingNote('720p', selection, chinese)).toBe(
      'Nano Banana 2 Lite、Seedance 2.0 Mini仅支持固定输出尺寸'
    );
    expect(resolutionCeilingNote('720p', selection, english)).toBe(
      resolutionCeilingNote('720p', selection)
    );
  });
});
