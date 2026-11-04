import { readCookie } from '@/ui/cookie';
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale } from './locale';

export function readLocale() {
  try {
    return resolveLocale(readCookie(LOCALE_COOKIE));
  } catch (error) {
    if (error instanceof URIError) return DEFAULT_LOCALE;
    throw error;
  }
}
