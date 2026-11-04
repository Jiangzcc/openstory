import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { localizePricingText } from './localize-pricing';

const PRICE_CASES = [
  ['~$0.0600 / generation', '约 $0.0600 / 次生成'],
  ['from $0.04 / image', '$0.04 起 / 张图片'],
  ['$0.15 / minute', '$0.15 / 分钟'],
  [
    '$2.50 / M in · $15.00 / M out',
    '$2.50 / 百万输入 token · $15.00 / 百万输出 token',
  ],
  [
    'Free / M in · Free / M out',
    '免费 / 百万输入 token · 免费 / 百万输出 token',
  ],
  [
    '6 × 5s MiniMax H3 Max (with refs)',
    '6 段 × 5 秒 MiniMax H3 Max（含参考素材）',
  ],
  ['3 character + 2 location sheets', '3 份角色设定图与 2 份地点设定图'],
  ['30s target · defaults', '目标时长 30 秒 · 默认设置'],
  ['One 2m track (ElevenLabs Music)', '1 段 2 分钟 配乐（ElevenLabs Music）'],
] as const;

describe('pricing display localization', () => {
  const zh = createApplicationI18n();
  const en = createApplicationI18n('en');

  it.each(PRICE_CASES)(
    'localizes %s while preserving amounts and models',
    (source, expected) => {
      expect(localizePricingText(zh, source)).toBe(expected);
      expect(localizePricingText(en, source)).toBe(source);
    }
  );

  it('preserves unknown upstream messages and technical identifiers', () => {
    const source = 'New upstream tariff: USD 0.123 / custom-unit';
    expect(localizePricingText(zh, source)).toBe(source);
    expect(localizePricingText(zh, 'fal-ai/example/v2')).toBe(
      'fal-ai/example/v2'
    );
  });

  it('localizes refresh metadata without changing the calendar date', () => {
    expect(
      localizePricingText(
        zh,
        'Media (fal.ai): pending refresh · Script analysis (OpenRouter): Nov 3, 2026'
      )
    ).toBe('媒体（fal.ai）：待刷新 · 剧本分析（OpenRouter）：2026年11月3日');
  });
});
