import type { FlatNamespace, i18n as I18n } from 'i18next';
import { DEFAULT_LOCALE } from './locale';

export function translateStaticLabel(
  i18n: I18n,
  namespace: FlatNamespace,
  source: string,
  locale: string = i18n.resolvedLanguage ?? DEFAULT_LOCALE
) {
  const value: unknown =
    i18n.getResource(locale, namespace, source) ??
    i18n.getResource(locale, 'labels', source);
  return typeof value === 'string' ? value : source;
}
