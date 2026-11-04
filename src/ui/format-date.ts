import type { Locale } from '@/platform/i18n/locale';
import {
  formatJustNow,
  formatRelativeUnit,
} from '@/platform/i18n/relative-time';

/**
 * Format a date as a relative time string (e.g., "2 hours ago")
 */
export function formatDistanceToNow(date: Date, locale: Locale = 'en'): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return formatJustNow(locale);
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return formatRelativeUnit(diffInMinutes, 'minute', locale);
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return formatRelativeUnit(diffInHours, 'hour', locale);
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return formatRelativeUnit(diffInDays, 'day', locale);
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return formatRelativeUnit(diffInMonths, 'month', locale);
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return formatRelativeUnit(diffInYears, 'year', locale);
}
