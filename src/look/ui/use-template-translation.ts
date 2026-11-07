import type { Style } from '@/platform/server/db/schema';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
import { resolveLocale } from '@/platform/i18n/locale';
import { translateStyleContent } from '@/look/localization/style-content';

/** Only server-managed templates have localized display names and descriptions. */
export function useTemplateTranslation(
  style: Pick<Style, 'isTemplate'> | null | undefined
) {
  const translateLabel = useLabelTranslation('presets');
  const { i18n } = useTranslation('presets');
  const locale = resolveLocale(i18n.resolvedLanguage);
  return (text: string) =>
    style?.isTemplate === true
      ? translateStyleContent(translateLabel(text), locale)
      : text;
}
