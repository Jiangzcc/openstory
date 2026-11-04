import type { Character } from '@/platform/server/db/schema';
import { useTranslation } from 'react-i18next';

type FirstAppearanceProps = {
  mention:
    | Pick<
        Character,
        'firstMentionSceneId' | 'firstMentionLine' | 'firstMentionText'
      >
    | null
    | undefined;
};

export function FirstAppearance({ mention }: FirstAppearanceProps) {
  const { t } = useTranslation('cast');
  if (!mention?.firstMentionSceneId) return null;

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('First Appears')}
      </p>
      <p className="text-sm">
        {t('Scene {{value1}}{{value2}}', {
          value1: mention.firstMentionSceneId,
          value2: mention.firstMentionLine
            ? t(', Line {{value1}}', { value1: mention.firstMentionLine })
            : '',
        })}
      </p>
      {mention.firstMentionText && (
        <p className="border-l-2 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
          "{mention.firstMentionText}"
        </p>
      )}
    </div>
  );
}
