import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  localizeHistorySummary,
  localizeHistoryTarget,
} from './localize-history';

describe('history display localization', () => {
  it('preserves user names and model names inside known event sentences', () => {
    const i18n = createApplicationI18n();
    expect(
      localizeHistorySummary(
        i18n,
        'character.created',
        'Added character Alice [A]'
      )
    ).toBe('已添加角色 Alice [A]');
    expect(
      localizeHistorySummary(
        i18n,
        'video.rendered',
        'Rendered Seedance 2.5 video'
      )
    ).toBe('已渲染 Seedance 2.5 视频');
    expect(localizeHistoryTarget(i18n, 'Shot 12')).toBe('镜头 12');
  });
  it('translates sheet events without changing the user name or model', () => {
    const i18n = createApplicationI18n();
    expect(
      localizeHistorySummary(
        i18n,
        'sheet.generated',
        'Generated a sheet for Alice with Seedream 4.5'
      )
    ).toBe('已使用 Seedream 4.5 为 Alice 生成设定图');
  });
  it('translates compound settings while preserving model names and ratios', async () => {
    const i18n = createApplicationI18n();
    const summary =
      'Changed aspect ratio to 16:9. Changed the video model to Kling 3.0. Changed where generation stops to Motion & Music';
    expect(
      localizeHistorySummary(i18n, 'sequence.settings-changed', summary)
    ).toBe(
      '已将画面比例更改为 16:9；已将视频模型更改为 Kling 3.0；已将生成终点改为视频与配乐'
    );
    expect(
      localizeHistorySummary(
        i18n,
        'sequence.settings-changed',
        'Future wording. Changed the style'
      )
    ).toBe('Future wording. Changed the style');
    await i18n.changeLanguage('en');
    expect(
      localizeHistorySummary(i18n, 'sequence.settings-changed', summary)
    ).toBe(summary);
  });
  it.each([
    [
      'sheet.generated',
      'Generated a sheet for Alice with Bob with Seedream 4.5',
    ],
    ['look.updated', 'Edited look Night of Summer of Alice'],
    ['look.updated', 'Edited look Summer of Alice of Wonderland'],
    ['location.replaced', 'Replaced Home with Friends with Town'],
    ['location.replaced', 'Replaced Home with Town with Friends'],
  ])('preserves ambiguous names in %s summaries', (kind, summary) => {
    const i18n = createApplicationI18n();
    expect(localizeHistorySummary(i18n, kind, summary)).toBe(summary);
  });

  it.each([
    ['image.selected', 'Selected uploaded image', '已选择上传图片'],
    ['run.failed', 'Preview failed', '预览生成失败'],
    ['run.failed', 'Image generation failed', '图片生成失败'],
    ['run.failed', 'Storyboard failed', '分镜生成失败'],
  ])(
    'uses exact wording before generic %s templates',
    (kind, summary, expected) => {
      const i18n = createApplicationI18n();
      expect(localizeHistorySummary(i18n, kind, summary)).toBe(expected);
    }
  );

  it('does not guess translations for unknown events or modified source text', () => {
    const i18n = createApplicationI18n();
    expect(
      localizeHistorySummary(i18n, 'custom.event', 'Added character Alice')
    ).toBe('Added character Alice');
    expect(
      localizeHistorySummary(
        i18n,
        'character.created',
        'New upstream wording: Alice'
      )
    ).toBe('New upstream wording: Alice');
  });
  it('responds to language changes without editing the stored summary', async () => {
    const i18n = createApplicationI18n();
    const summary = 'Added character 中文角色';
    expect(localizeHistorySummary(i18n, 'character.created', summary)).toBe(
      '已添加角色 中文角色'
    );
    await i18n.changeLanguage('en');
    expect(localizeHistorySummary(i18n, 'character.created', summary)).toBe(
      summary
    );
  });
});
