import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import {
  ALL_COMPOSER_STYLE_CATEGORIES,
  composerStyleCategoryOptions,
} from '@/look/ui/composer-style-row';
import { styleCategoryLabel } from '@/look/ui/style-assets';
import type { Style } from '@/platform/server/db/schema';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';

type StyleCategorySelectProps = {
  styles: Style[];
  value: string;
  onChange: (category: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'lg';
  /** Rank styles for the current script. Lives in this menu so the strip
   *  chrome stays one control, not a row of buttons (#1526). */
  onRecommend?: () => void;
  recommendDisabled?: boolean;
  recommendLabel?: string;
  isRecommending?: boolean;
};

export function StyleCategorySelect({
  styles,
  value,
  onChange,
  disabled = false,
  size = 'sm',
  onRecommend,
  recommendDisabled = false,
  recommendLabel = 'Recommend',
  isRecommending = false,
}: StyleCategorySelectProps) {
  const { t } = useTranslation('look');
  const translateLabel = useLabelTranslation('look');

  const families = composerStyleCategoryOptions(styles);
  const isAll = value === ALL_COMPOSER_STYLE_CATEGORIES;
  const selected = families.find((option) => option.value === value);
  const label = isAll
    ? t('All styles')
    : (selected?.label ?? styleCategoryLabel(value));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          aria-label={t('Style category: {{value1}}', {
            value1: translateLabel(label),
          })}
          className="gap-1.5 whitespace-nowrap"
        >
          <span>{translateLabel(label)}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-56">
        {onRecommend ? (
          <>
            <DropdownMenuItem
              disabled={recommendDisabled || isRecommending}
              onSelect={() => onRecommend()}
            >
              {isRecommending ? (
                <Loader2 className="size-3.5 animate-spin text-primary" />
              ) : (
                <Sparkles className="size-3.5 text-primary" />
              )}
              {translateLabel(recommendLabel)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {families.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="whitespace-nowrap"
            >
              {translateLabel(option.label)}
            </DropdownMenuRadioItem>
          ))}
          {families.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuRadioItem
            value={ALL_COMPOSER_STYLE_CATEGORIES}
            className="whitespace-nowrap"
          >
            {t('All styles')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
