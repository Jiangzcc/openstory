import { useLocale } from './use-locale';
import type { Locale } from '@/platform/i18n/locale';
import { Button } from '@/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { useHydrated } from '@/ui/use-hydrated';
import { LanguagesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
] satisfies { value: Locale; label: string }[];

export function LanguageSwitcher() {
  const { t } = useTranslation('common');
  const { locale, changeLocale, saveFailed } = useLocale();
  const hydrated = useHydrated();

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 sm:size-8"
            aria-label="语言 / Language"
            title={t('Language')}
            disabled={!hydrated}
          >
            <LanguagesIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={t('Language')}>
          <DropdownMenuRadioGroup value={locale}>
            {LANGUAGES.map(({ value, label }) => (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                lang={value}
                className="min-h-11 sm:min-h-8"
                onSelect={() => void changeLocale(value)}
              >
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {saveFailed && (
        <output className="text-xs text-muted-foreground">
          {t(
            'Language changed, but your browser could not save the preference. Refreshing may restore the previous language.'
          )}
        </output>
      )}
    </div>
  );
}
