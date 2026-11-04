import { createI18n } from '@/platform/i18n/runtime';
import { DEFAULT_LOCALE } from '@/platform/i18n/locale';
import type { Locale } from '@/platform/i18n/locale';
import { applicationResources } from './resources';
import { escapeRichTextValue, unescapeRichTextValue } from './rich-text';

export function createApplicationI18n(locale: Locale = DEFAULT_LOCALE) {
  return createI18n(locale, applicationResources, {
    interpolation: { escape: escapeRichTextValue },
    react: { unescape: unescapeRichTextValue },
  });
}
