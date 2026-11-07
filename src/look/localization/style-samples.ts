import type { Locale } from '@/platform/i18n/locale';

const resources = import.meta.glob<Record<string, string>>(
  './locales/zh-CN/style-samples-*.json',
  { eager: true, import: 'default' }
);
const chinese: Readonly<Record<string, string>> = Object.assign(
  {},
  ...Object.values(resources)
);

export function translateStyleSample(source: string, locale: Locale): string {
  return locale === 'zh-CN' && Object.hasOwn(chinese, source)
    ? (chinese[source] ?? source)
    : source;
}
