import { createInstance } from 'i18next';
import type { InitOptions, Resource } from 'i18next';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locale';
import type { Locale } from './locale';
import { resources } from './resources';

export function createI18n(
  locale: Locale = DEFAULT_LOCALE,
  additionalResources: Resource = {},
  options: Pick<InitOptions, 'interpolation' | 'react'> = {}
) {
  const mergedResources = Object.fromEntries(
    SUPPORTED_LOCALES.map((language) => [
      language,
      { ...resources[language], ...additionalResources[language] },
    ])
  );
  const i18n = createInstance();
  void i18n.init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALES],
    load: 'currentOnly',
    defaultNS: 'common',
    keySeparator: false,
    nsSeparator: false,
    ns: Object.keys(mergedResources.en ?? {}),
    resources: mergedResources,
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false, ...options.interpolation },
    react: { useSuspense: false, ...options.react },
  });
  return i18n;
}
