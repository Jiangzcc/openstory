import type { SequenceAsset } from '@/sequences/sequence-assets';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { describe, expect, it } from 'vitest';
import { localizeAssetGroup, localizeAssetLabel } from './localize-asset-label';

// Mock manifest labels cover upstream templates without reading or writing business data.
const cases: [SequenceAsset['kind'], string, string][] = [
  ['still', 'Scene 1 shot 2 still', '场景 1 镜头 2 静帧'],
  ['prompt', 'Scene 1 shot 2 prompt', '场景 1 镜头 2 提示词'],
  ['voice', 'Alice voice take 3', 'Alice 候选音色 3'],
  ['character_sheet', 'Alice Summer sheet', 'Alice Summer 设定图'],
  ['location_sheet', 'Old Town sheet', 'Old Town 设定图'],
  ['character_portrait', 'Alice Summer portrait', 'Alice Summer 缩略图'],
  ['location_portrait', 'Old Town portrait', 'Old Town 缩略图'],
  ['location_photo', 'Old Town photo', 'Old Town 照片'],
  ['style', 'Style sample 2', '风格示例 2'],
  ['video', 'Segment clip', '镜头视频片段'],
  ['element', 'Script', 'Script'],
  ['still', 'Unknown provider label', 'Unknown provider label'],
];

describe('asset display localization', () => {
  it.each(cases)(
    'translates %s labels while preserving names',
    (kind, label, chinese) => {
      const asset = { kind, label };
      expect(localizeAssetLabel(createApplicationI18n('zh-CN'), asset)).toBe(
        chinese
      );
      expect(localizeAssetLabel(createApplicationI18n('en'), asset)).toBe(
        label
      );
      expect(asset).toEqual({ kind, label });
    }
  );

  it('translates groups while retaining unknown source text', () => {
    const i18n = createApplicationI18n('zh-CN');
    expect(localizeAssetGroup(i18n, 'Scene 12')).toBe('场景 12');
    expect(localizeAssetGroup(i18n, 'Cast')).toBe('角色');
    expect(localizeAssetGroup(i18n, 'Custom group')).toBe('Custom group');
  });
});
