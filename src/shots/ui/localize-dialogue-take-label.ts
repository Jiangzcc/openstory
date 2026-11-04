import type { i18n as I18n, ParseKeys } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

const TAKE_LABELS: Partial<Record<string, ParseKeys<'shots'>>> = {
  'One take': 'One take · {{count}} shots',
  'Older take': 'Older take · {{count}} shots',
  'Newer take': 'Newer take · {{count}} shots',
};

export function localizeDialogueTakeLabel(i18n: I18n, source: string) {
  const match = /^(One take|Older take|Newer take) · (\d+) shots?$/.exec(
    source
  );
  const kind = match?.[1];
  const key = kind ? TAKE_LABELS[kind] : undefined;
  if (match && key) {
    return i18n.t(key, { ns: 'shots', count: Number(match[2]) });
  }
  return translateStaticLabel(i18n, 'shots', source);
}
