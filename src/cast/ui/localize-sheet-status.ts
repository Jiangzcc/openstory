import type { i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

export function localizeSheetRetry(i18n: I18n, source: string | null) {
  if (source === null) return null;
  const attempts = /^Retrying \((\d+)\/(\d+)\)…$/.exec(source);
  return attempts
    ? i18n.t('Retrying ({{attempt}}/{{maximum}})…', {
        ns: 'cast',
        attempt: attempts[1],
        maximum: attempts[2],
      })
    : translateStaticLabel(i18n, 'cast', source);
}
