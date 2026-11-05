import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { NewCharacterForm } from '@/cast/ui/new-character-form';
import { useCreateOrganizationCharacter } from '@/cast/ui/use-organization-characters';
import { errorMessage } from '@/platform/errors';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/shadcn/dialog';
import { useHydrated } from '@/ui/use-hydrated';

/**
 * Make a character with no sequence (#2065), then open its page, where its
 * bible and looks are edited. A sequence casts it later with @.
 */
export const NewCharacterDialog: React.FC = () => {
  const translateEvent = useLiveTranslation('cast');
  const { t } = useTranslation('cast');

  const [open, setOpen] = useState(false);
  const createCharacter = useCreateOrganizationCharacter();
  const navigate = useNavigate();
  const hydrated = useHydrated();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!hydrated}>{t('New character')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New character')}</DialogTitle>
          <DialogDescription>
            {t(
              'Looks, sheets, voice and the rest of the bible are on its page.'
            )}
          </DialogDescription>
        </DialogHeader>
        <NewCharacterForm
          isPending={createCharacter.isPending}
          submitLabel={t('Create')}
          pendingLabel={t('Creating…')}
          onSubmit={(fields) =>
            createCharacter.mutate(
              { ...fields, rendering: PHOTOREAL_RENDERING },
              {
                onSuccess: (character) => {
                  setOpen(false);
                  void navigate({
                    to: '/characters/$id',
                    params: { id: character.id },
                  });
                },
                onError: (error) =>
                  toast.error(translateEvent('Character not created'), {
                    description: errorMessage(error),
                  }),
              }
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
};
