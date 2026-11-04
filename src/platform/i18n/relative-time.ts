import type { Locale } from './locale';

const ENGLISH_SUFFIX = {
  minute: 'm',
  hour: 'h',
  day: 'd',
  month: 'mo',
  year: 'y',
} as const;

export function formatRelativeUnit(
  value: number,
  unit: keyof typeof ENGLISH_SUFFIX,
  locale: Locale
) {
  if (locale === 'en') return `${value}${ENGLISH_SUFFIX[unit]} ago`;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(
    -value,
    unit
  );
}

export function formatJustNow(locale: Locale) {
  return locale === 'en' ? 'just now' : '刚刚';
}
