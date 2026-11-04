import type { i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

export function localizeAssetMessage(i18n: I18n, source: string) {
  const downloaded =
    /^Downloaded (\d+) files\. Skipped (\d+) already there\.$/.exec(source);
  if (downloaded) {
    return i18n.t(
      'Downloaded {{count}} files. Skipped {{skipped}} already there.',
      {
        ns: 'sequences',
        count: Number(downloaded[1]),
        skipped: downloaded[2],
      }
    );
  }
  const failure = /^Could not download (.+) \((\d+)\)$/.exec(source);
  if (failure) {
    return i18n.t('Could not download {{path}} ({{status}})', {
      ns: 'sequences',
      path: failure[1],
      status: failure[2],
    });
  }
  return translateStaticLabel(i18n, 'sequences', source);
}
