import type { Style } from '@/platform/server/db/schema';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';

/** Only server-managed templates have localized display names and descriptions. */
export function useTemplateTranslation(
  style: Pick<Style, 'isTemplate'> | null | undefined
) {
  const translateLabel = useLabelTranslation('presets');
  return (text: string) =>
    style?.isTemplate === true ? translateLabel(text) : text;
}
