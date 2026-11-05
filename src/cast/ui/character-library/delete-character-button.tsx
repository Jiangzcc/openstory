import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
import { librarySearchFor } from '@/cast/ui/library-search';
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
  useDeleteOrganizationCharacter,
  useRestoreOrganizationCharacter,
} from '@/cast/ui/use-organization-characters';
import { errorMessage } from '@/platform/errors';
import { useHydrated } from '@/ui/use-hydrated';

/**
 * Delete one of the organization's characters (#2065), with Undo on the toast.
 * Offered only while no sequence casts it; the server refuses otherwise.
 */
export const DeleteCharacterButton: React.FC<{
  characterId: string;
  name: string;
}> = ({ characterId, name }) => {
  const translateEvent = useLiveTranslation('cast');
  const { t } = useTranslation('cast');

  const remove = useDeleteOrganizationCharacter();
  const restore = useRestoreOrganizationCharacter();
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
            {t(
              'It leaves your characters and the @ picker. A saved voice is released.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              remove.mutate(
                { characterId },
                {
                  onSuccess: () => {
                    toast.success(
                      translateEvent('Deleted {{value1}}', { value1: name }),
                      {
                        // Undo is the only way back from this page.
                        duration: 60_000,
                        action: {
                          label: translateEvent('Undo'),
                          onClick: () =>
                            restore.mutate(
                              { characterId },
                              {
                                onSuccess: () =>
                                  void navigate({
                                    to: '/characters/$id',
                                    params: { id: characterId },
                                  }),
                              }
                            ),
                        },
                      }
                    );
                    void navigate({
                      to: '/characters',
                      search: librarySearchFor(),
                    });
                  },
                  onError: (error) =>
                    toast.error(
                      translateEvent('Could not delete {{value1}}', {
                        value1: name,
                      }),
                      {
                        description: errorMessage(error),
                      }
                    ),
                }
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
