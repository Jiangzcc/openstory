import type { i18n as I18n, ParseKeys } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';
import type { SequenceAsset } from '@/sequences/sequence-assets';

type LabelPattern = {
  kinds: readonly SequenceAsset['kind'][];
  pattern: RegExp;
  key: ParseKeys<'sequences'>;
};

const LABEL_PATTERNS: readonly LabelPattern[] = [
  {
    kinds: ['still'],
    pattern: /^Scene (\d+) shot (\d+) still$/,
    key: 'Scene {{value1}} shot {{value2}} still',
  },
  {
    kinds: ['prompt'],
    pattern: /^Scene (\d+) shot (\d+) prompt$/,
    key: 'Scene {{value1}} shot {{value2}} prompt',
  },
  {
    kinds: ['voice'],
    pattern: /^(.+) voice take (\d+)$/,
    key: '{{value1}} voice take {{value2}}',
  },
  {
    kinds: ['character_sheet', 'location_sheet'],
    pattern: /^(.+) sheet$/,
    key: '{{value1}} sheet',
  },
  {
    kinds: ['character_portrait', 'location_portrait'],
    pattern: /^(.+) portrait$/,
    key: '{{value1}} portrait',
  },
  {
    kinds: ['location_photo'],
    pattern: /^(.+) photo$/,
    key: '{{value1}} photo',
  },
  {
    kinds: ['style'],
    pattern: /^Style sample (\d+)$/,
    key: 'Style sample {{value1}}',
  },
];

export function localizeAssetGroup(i18n: I18n, source: string) {
  const scene = /^Scene (\d+)$/.exec(source);
  return scene
    ? i18n.t('Scene {{value1}}', { ns: 'sequences', value1: scene[1] })
    : translateStaticLabel(i18n, 'sequences', source);
}

export function localizeAssetLabel(
  i18n: I18n,
  asset: Pick<SequenceAsset, 'kind' | 'label'>
) {
  if (asset.kind === 'element') return asset.label;
  const rule = LABEL_PATTERNS.find((candidate) =>
    candidate.kinds.includes(asset.kind)
  );
  const match = rule?.pattern.exec(asset.label);
  if (rule && match) {
    return i18n.t(rule.key, {
      ns: 'sequences',
      value1: match[1],
      value2: match[2],
    });
  }
  return translateStaticLabel(i18n, 'sequences', asset.label);
}
