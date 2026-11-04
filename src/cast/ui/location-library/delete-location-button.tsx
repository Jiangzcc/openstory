import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/shadcn/alert-dialog';
import { Button } from '@/ui/shadcn/button';
import {
  useDeleteTeamLocation,
  useRestoreTeamLocation,
} from '@/cast/ui/use-team-locations';
import { errorMessage } from '@/platform/errors';
import { useHydrated } from '@/ui/use-hydrated';

/**
 * Delete one of the team's locations (#1695), with Undo on the toast.
 * Offered only while no sequence uses it; the server refuses otherwise.
 */
export const DeleteLocationButton: React.FC<{
  locationId: string;
  name: string;
}> = ({ locationId, name }) => {
  const translateEvent = useLiveTranslation('cast');
  const { t } = useTranslation('cast');

  const remove = useDeleteTeamLocation();
  const restore = useRestoreTeamLocation();
  const navigate = useNavigate();
  const hydrated = useHydrated();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={!hydrated || remove.isPending}>
          {remove.isPending ? t('Deleting…') : t('Delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('Delete {{value1}}?', { value1: name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('It leaves your locations and the @ picker.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            // Awaited, not `mutate` callbacks: the delete empties this page's
            // own read, the button unmounts, and its callbacks would not run.
            onClick={() =>
              void remove.mutateAsync({ locationId }).then(
                () => {
                  toast.success(
                    translateEvent('Deleted {{value1}}', { value1: name }),
                    {
                      // Undo is the only way back from this page.
                      duration: 60_000,
                      action: {
                        label: translateEvent('Undo'),
                        onClick: () =>
                          restore.mutate(
                            { locationId },
                            {
                              onSuccess: () =>
                                void navigate({
                                  to: '/locations/$locationId',
                                  params: { locationId },
                                }),
                            }
                          ),
                      },
                    }
                  );
                  void navigate({ to: '/locations' });
                },
                (error: unknown) =>
                  toast.error(
                    translateEvent('Could not delete {{value1}}', {
                      value1: name,
                    }),
                    {
                      description: errorMessage(error),
                    }
                  )
              )
            }
          >
            {t('Delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
