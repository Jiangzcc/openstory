import { useLocale } from './use-locale';
import type { Locale } from '@/platform/i18n/locale';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
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
    <div className="flex flex-col items-end gap-2">
      <Select<Locale>
        value={locale}
        items={LANGUAGES}
        onValueChange={(value) => void changeLocale(value)}
      >
        <SelectTrigger aria-label="语言 / Language" disabled={!hydrated}>
          <LanguagesIcon aria-hidden="true" className="size-4" />
          <SelectValue>
            <span lang="zh-CN">中文</span>
            <span aria-hidden="true">/</span>
            <span lang="en">English</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {LANGUAGES.map(({ value, label }) => (
            <SelectItem key={value} value={value} lang={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
