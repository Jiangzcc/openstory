import { readCookie, writeCookie } from '@/ui/cookie';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALE_COOKIE, resolveLocale } from '@/platform/i18n/locale';
import type { Locale } from '@/platform/i18n/locale';

export function useLocale() {
  const { i18n } = useTranslation('common');
  const [saveFailed, setSaveFailed] = useState(false);

  async function changeLocale(locale: Locale | null) {
    if (!locale) return;
    await i18n.changeLanguage(locale);
    try {
      writeCookie(LOCALE_COOKIE, locale);
      setSaveFailed(readCookie(LOCALE_COOKIE) !== locale);
    } catch {
      setSaveFailed(true);
    }
  }

  return {
    locale: resolveLocale(i18n.resolvedLanguage),
    changeLocale,
    saveFailed,
  };
}
