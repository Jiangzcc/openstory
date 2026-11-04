import type { i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

export function localizeUploadError(i18n: I18n, source: string) {
  const maximum = /^Maximum (\d+) files allowed$/.exec(source);
  return maximum
    ? i18n.t('Maximum {{count}} files allowed', {
        ns: 'interface',
        count: Number(maximum[1]),
      })
    : translateStaticLabel(i18n, 'interface', source);
}
