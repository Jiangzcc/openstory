import type { FlatNamespace } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Event notifications use the language active when the event completes. */
export function useLiveTranslation<Ns extends FlatNamespace>(namespace: Ns) {
  const { i18n } = useTranslation(namespace);
  // oxlint-disable-next-line typescript/unbound-method -- i18next binds getFixedT to its instance.
  const { getFixedT } = i18n;
  return useMemo(() => getFixedT(null, namespace), [getFixedT, namespace]);
}
