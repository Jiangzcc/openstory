import type { FlatNamespace } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Event notifications use the language active when the event completes. */
export function useLiveTranslation<Ns extends FlatNamespace>(namespace: Ns) {
  const { i18n } = useTranslation(namespace);
  return useMemo(() => i18n.getFixedT(null, namespace), [i18n, namespace]);
}
