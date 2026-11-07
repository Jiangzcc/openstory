import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale } from './locale';
import type { Locale } from './locale';

export type PromptLocaleContext = { promptLocale: Locale };

export const EXTERNAL_PROMPT_LOCALE: Locale = 'en';

export function localizedPrompt(
  locale: Locale,
  english: string,
  chinese: string
) {
  return locale === 'zh-CN' ? chinese : english;
}

export function promptLocaleFromRequest(request: Request): Locale {
  const prefix = `${LOCALE_COOKIE}=`;
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return DEFAULT_LOCALE;
  try {
    return resolveLocale(decodeURIComponent(cookie.slice(prefix.length)));
  } catch (error) {
    if (error instanceof URIError) return DEFAULT_LOCALE;
    throw error;
  }
}
