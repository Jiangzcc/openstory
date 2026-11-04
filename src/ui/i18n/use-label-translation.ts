import type { FlatNamespace } from 'i18next';
import { useTranslation } from 'react-i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';

/** Only for labels from static UI catalogs; never pass user content. */
export function useLabelTranslation(namespace: FlatNamespace) {
  const { i18n } = useTranslation(namespace);
  return (source: string) => translateStaticLabel(i18n, namespace, source);
}
