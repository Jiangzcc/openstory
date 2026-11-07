import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

/** Localize the system default without changing the rendering submitted by the form. */
export const RenderingField: React.FC<{
  idPrefix: string;
  defaultValue: string | null;
  required?: boolean;
}> = ({ idPrefix, defaultValue, required }) => {
  const { t } = useTranslation('cast');
  const [draft, setDraft] = useState<string | null>(null);
  const original = defaultValue ?? '';
  const display =
    original === PHOTOREAL_RENDERING ? t('Photoreal live action') : original;
  const id = `${idPrefix}-rendering`;

  return (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor={id}
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('Rendered as')}
      </Label>
      <input type="hidden" name="rendering" value={draft ?? original} />
      <Input
        id={id}
        value={draft ?? display}
        required={required}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft(value === display ? null : value);
        }}
      />
    </div>
  );
};
