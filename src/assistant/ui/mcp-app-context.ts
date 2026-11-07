import type { i18n as I18n } from 'i18next';
import { isValidId } from '@/platform/id';
import { translateStaticLabel } from '@/platform/i18n/labels';
import { resolveLocale } from '@/platform/i18n/locale';

type StyleLabel = { id: string; name: string; isTemplate: boolean | null };

export function mcpResultStyleId(content: unknown): string {
  let data: unknown;
  try {
    data = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    return '';
  }
  if (typeof data !== 'object' || data === null || !('style' in data))
    return '';
  const style = data.style;
  if (typeof style !== 'object' || style === null || !('id' in style))
    return '';
  return typeof style.id === 'string' && isValidId(style.id) ? style.id : '';
}

export function mcpAppHostContext(i18n: I18n, style?: StyleLabel | null) {
  const locale = resolveLocale(i18n.resolvedLanguage);
  return {
    locale,
    'openstory/styleNames':
      style?.isTemplate === true
        ? {
            [style.id]: translateStaticLabel(
              i18n,
              'presets',
              style.name,
              locale
            ),
          }
        : {},
  };
}
