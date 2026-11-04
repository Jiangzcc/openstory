import { useTemplateTranslation } from '@/look/ui/use-template-translation';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
import { StyleHoverPreview } from '@/look/ui/style-hover-preview';
import { styleCategoryLabel } from '@/look/ui/style-assets';
import type { Style } from '@/platform/server/db/schema';
import type { FC } from 'react';
import { useCallback } from 'react';

type StyleLibraryCardProps = {
  style: Style;
  onSelect: (style: Style) => void;
};

/**
 * One style tile on the top-level styles page: a hover-to-play preview plus the
 * style name and category. Activating it opens the style detail dialog. Built on
 * a real <button> so keyboard activation and focus semantics come for free.
 */
export const StyleLibraryCard: FC<StyleLibraryCardProps> = ({
  style,
  onSelect,
}) => {
  const translateTemplate = useTemplateTranslation(style);

  const { t } = useTranslation('look');
  const translateLabel = useLabelTranslation('labels');

  const handleSelect = useCallback(() => onSelect(style), [onSelect, style]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      aria-label={t('{{value1}} style details', {
        value1: translateTemplate(style.name),
      })}
      data-testid={`style-library-card-${style.id}`}
      className="group block w-full overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <StyleHoverPreview style={style} className="rounded-t-xl" />
      <div className="flex flex-col gap-0.5 p-3">
        <h3
          className="truncate text-sm font-semibold"
          title={translateTemplate(style.name)}
        >
          {translateTemplate(style.name)}
        </h3>
        <span className="text-xs text-muted-foreground">
          {translateLabel(styleCategoryLabel(style.category))}
        </span>
      </div>
    </button>
  );
};
