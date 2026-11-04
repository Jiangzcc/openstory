import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';

export function AttestationStatementText({
  id,
  text,
}: {
  id: string;
  text: string;
}) {
  const translateLabel = useLabelTranslation('cast');
  const { t } = useTranslation('cast');
  const translated = translateLabel(text);
  return (
    <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p id={id}>{translated}</p>
      {translated !== text && (
        <div>
          <p className="font-medium">{t('Original English statement')}</p>
          <p lang="en">{text}</p>
        </div>
      )}
    </div>
  );
}
