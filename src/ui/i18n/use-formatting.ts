import { useTranslation } from 'react-i18next';
import { resolveLocale } from '@/platform/i18n/locale';

export function useLocaleFormatting() {
  const { i18n } = useTranslation();
  const locale = resolveLocale(i18n.resolvedLanguage);
  return {
    locale,
    formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) =>
      date.toLocaleDateString(locale, options),
    formatDateTime: (date: Date, options?: Intl.DateTimeFormatOptions) =>
      date.toLocaleString(locale, options),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      value.toLocaleString(locale, options),
  };
}
