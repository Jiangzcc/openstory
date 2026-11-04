import type { i18n as I18n } from 'i18next';
import { resolveLocale } from '@/platform/i18n/locale';
import { translateStaticLabel } from '@/platform/i18n/labels';

const PRICING_TEMPLATES = [
  { key: 'See {{value1}}', pattern: /^See (?<value1>.+)$/ },
  {
    key: '{{value1}} target · defaults',
    pattern: /^(?<value1>\d+[sm]) target · defaults$/,
    duration: true,
  },
  {
    key: '{{value1}} character + {{value2}} location sheets',
    pattern: /^(?<value1>\d+) character \+ (?<value2>\d+) location sheets$/,
  },
  {
    key: '{{value1}} stills ({{value2}})',
    pattern: /^(?<value1>\d+) stills \((?<value2>.+)\)$/,
  },
  {
    key: '{{value1}} × {{value2}}s {{value3}} (with refs)',
    pattern: /^(?<value1>\d+) × (?<value2>\d+)s (?<value3>.+) \(with refs\)$/,
  },
  {
    key: 'One {{value1}} track ({{value2}})',
    pattern: /^One (?<value1>\d+[sm]) track \((?<value2>.+)\)$/,
    duration: true,
  },
  {
    key: '~{{value1}} / {{value2}}',
    pattern: /^~(?<value1>\$[\d.,]+|Free) \/ (?<value2>.+)$/,
    labels: true,
  },
  {
    key: 'from {{value1}} / {{value2}}',
    pattern: /^from (?<value1>\$[\d.,]+|Free) \/ (?<value2>.+)$/,
    labels: true,
  },
  {
    key: '{{value1}} / M in · {{value2}} / M out',
    pattern:
      /^(?<value1>\$[\d.,]+|Free) \/ M in · (?<value2>\$[\d.,]+|Free) \/ M out$/,
    labels: true,
  },
  {
    key: '{{value1}} / {{value2}}',
    pattern: /^(?<value1>\$[\d.,]+|Free) \/ (?<value2>.+)$/,
    labels: true,
  },
  {
    key: 'Web search: {{value1}} / query · see {{value2}} for full tariff',
    pattern:
      /^Web search: (?<value1>\$[\d.,]+|Free) \/ query · see (?<value2>.+) for full tariff$/,
  },
  {
    key: 'Token rates — see {{value1}} for full tariff',
    pattern: /^Token rates — see (?<value1>.+) for full tariff$/,
  },
  {
    key: 'Media (fal.ai): {{value1}} · Script analysis (OpenRouter): {{value2}}',
    pattern:
      /^Media \(fal\.ai\): (?<value1>.+) · Script analysis \(OpenRouter\): (?<value2>.+)$/,
    dates: true,
  },
] as const;

function localizeDuration(i18n: I18n, source: string) {
  const match = /^(?<amount>\d+)(?<unit>[sm])$/.exec(source);
  if (!match?.groups) return source;
  const key = match.groups.unit === 's' ? '{{value1}}s' : '{{value1}}m';
  return i18n.t(key, { ns: 'billing', value1: match.groups.amount });
}

function localizeDate(i18n: I18n, source: string) {
  const date = new Date(source);
  if (Number.isNaN(date.valueOf()))
    return translateStaticLabel(i18n, 'billing', source);
  return date.toLocaleDateString(resolveLocale(i18n.resolvedLanguage), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function localizeValues(
  i18n: I18n,
  template: (typeof PRICING_TEMPLATES)[number],
  values: Record<string, string>
) {
  if ('duration' in template)
    values.value1 = localizeDuration(i18n, values.value1 ?? '');
  if ('labels' in template) {
    values.value1 = translateStaticLabel(i18n, 'billing', values.value1 ?? '');
    values.value2 = translateStaticLabel(i18n, 'billing', values.value2 ?? '');
  }
  if ('dates' in template) {
    values.value1 = localizeDate(i18n, values.value1 ?? '');
    values.value2 = localizeDate(i18n, values.value2 ?? '');
  }
  return values;
}

/** Translate known display templates while keeping prices and source records intact. */
export function localizePricingText(i18n: I18n, source: string) {
  if (resolveLocale(i18n.resolvedLanguage) === 'en') return source;
  const staticText = translateStaticLabel(i18n, 'billing', source);
  if (staticText !== source) return staticText;
  for (const template of PRICING_TEMPLATES) {
    const values = template.pattern.exec(source)?.groups;
    if (!values) continue;
    const localizedValues = localizeValues(i18n, template, values);
    return i18n.t(template.key, { ns: 'billing', ...localizedValues });
  }
  return source;
}
