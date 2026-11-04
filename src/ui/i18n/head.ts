import type { MetaHTMLAttributes } from 'react';
import type { FlatNamespace, i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

const TEXT_META_NAMES = new Set([
  'description',
  'og:title',
  'og:description',
  'twitter:title',
  'twitter:description',
]);

export function translateHeadText(
  i18n: I18n,
  namespace: FlatNamespace,
  source: string
) {
  const translated = translateStaticLabel(i18n, namespace, source);
  if (translated !== source) return translated;

  const docsSuffix = ' - OpenStory Docs';
  if (source.endsWith(docsSuffix)) {
    const title = translateStaticLabel(
      i18n,
      namespace,
      source.slice(0, -docsSuffix.length)
    );
    const suffix = translateStaticLabel(i18n, namespace, 'OpenStory Docs');
    return title + ' - ' + suffix;
  }
  const separator = source.lastIndexOf(' — ');
  if (separator !== -1) {
    return (
      translateStaticLabel(i18n, namespace, source.slice(0, separator)) +
      source.slice(separator)
    );
  }
  return translateStaticLabel(i18n, namespace, source);
}

export function localizeMeta(
  i18n: I18n,
  namespace: FlatNamespace,
  meta: MetaHTMLAttributes<HTMLMetaElement>[]
) {
  return meta.map((entry) => {
    const name = entry.name ?? entry.property;
    const source =
      typeof entry.title === 'string'
        ? entry.title
        : typeof name === 'string' &&
            TEXT_META_NAMES.has(name) &&
            typeof entry.content === 'string'
          ? entry.content
          : undefined;
    if (source === undefined) return entry;
    const translated = translateHeadText(i18n, namespace, source);
    return {
      ...entry,
      ...(typeof entry.title === 'string'
        ? { title: translated }
        : { content: translated }),
      'data-i18n-source': source,
      'data-i18n-namespace': namespace,
    };
  });
}

function isHeadNamespace(i18n: I18n, value: unknown): value is FlatNamespace {
  return typeof value === 'string' && i18n.hasResourceBundle('en', value);
}

export function translateMarkedHeadText(i18n: I18n, entry: object) {
  const source =
    'data-i18n-source' in entry ? entry['data-i18n-source'] : undefined;
  if (typeof source !== 'string') return undefined;
  const namespace =
    'data-i18n-namespace' in entry ? entry['data-i18n-namespace'] : undefined;
  return translateHeadText(
    i18n,
    isHeadNamespace(i18n, namespace) ? namespace : 'labels',
    source
  );
}
