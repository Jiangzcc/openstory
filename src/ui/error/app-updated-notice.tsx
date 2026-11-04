import { useTranslation } from 'react-i18next';
import { isReloadPending, isStaleChunkError } from '@/ui/chunk-reload';
import { use } from 'react';
import { Button } from '@/ui/shadcn/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/ui/shadcn/empty';

/**
 * Did this tab fall behind a deploy (#2034)? Either the one automatic reload
 * is on its way — the suppressed chunk error leaves the import resolving
 * `undefined`, so the router throws on `.component` until the page leaves — or
 * that reload is spent and the chunk is still missing.
 */
export function isAppUpdatedError(error: unknown): boolean {
  return isReloadPending() || isStaleChunkError(error);
}

const LEAVING = new Promise<never>(() => {});

export const AppUpdatedNotice: React.FC = () => {
  const { t } = useTranslation('interface');

  // The page is leaving: suspend, so the screen the visitor was on stays up
  // until the reload lands. Same move the router makes for its own reload.
  if (isReloadPending()) use(LEAVING);
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>{t('OpenStory was updated')}</EmptyTitle>
        <EmptyDescription>
          {t('Reload to get the new version.')}
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={() => location.reload()}>
        {t('Reload')}
      </Button>
    </Empty>
  );
};
