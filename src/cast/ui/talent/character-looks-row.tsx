import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { AskAssistantButton } from '@/assistant/ui/ask-assistant-button';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { BibleField } from '@/cast/ui/bible-field';
import { lookFieldsSchema } from '@/cast/look-field';
import {
  restoreCharacterLook,
  useCreateCharacterLook,
  useRemoveCharacterLook,
  useUpdateCharacterLook,
} from '@/cast/ui/use-character-looks';
import { errorMessage } from '@/platform/errors';
import type { CharacterLook } from '@/platform/server/db/schema';
import { AppImage } from '@/ui/shadcn/app-image';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

/** What the row needs of a look; the scoped read's look has all of it. */
export type LookRowItem = Pick<
  CharacterLook,
  | 'id'
  | 'name'
  | 'isDefault'
  | 'clothing'
  | 'styling'
  | 'lookVersionId'
  | 'sheetImageUrl'
  | 'sheetStatus'
>;

/** `''` clears clothing or styling; the name is never blank. */
function parseLookForm(form: HTMLFormElement) {
  const fields = Object.fromEntries(new FormData(form));
  return lookFieldsSchema.safeParse({
    name: fields.name,
    clothing: fields.clothing || null,
    styling: fields.styling || null,
  });
}

/** What is wrong with the form, in the field's own words. */
function lookFormError(error: z.ZodError, t: TFunction<'cast'>): string {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (field === 'name') return t('A look needs a name, up to 255 characters.');
  if (field === 'clothing') return t('Clothing is too long.');
  if (field === 'styling') return t('Hair, makeup, injuries is too long.');
  return issue?.message ?? t('Check the fields and try again.');
}

const LookFields: React.FC<{ idPrefix: string; look?: LookRowItem }> = ({
  idPrefix,
  look,
}) => {
  const { t } = useTranslation('cast');
  return (
    <>
      <BibleField
        idPrefix={idPrefix}
        label={t('Name')}
        name="name"
        defaultValue={look?.name ?? ''}
        placeholder={t('Gala gown')}
        required
      />
      <BibleField
        idPrefix={idPrefix}
        label={t('Clothing')}
        name="clothing"
        defaultValue={look?.clothing ?? ''}
        textarea
      />
      <BibleField
        idPrefix={idPrefix}
        label={t('Hair, makeup, injuries')}
        name="styling"
        defaultValue={look?.styling ?? ''}
        textarea
      />
    </>
  );
};

/**
 * A character's looks (#2015): one outfit each, with its own sheet. Picking
 * one shows its sheet in the panel; a scene wears a look from its cast chip.
 * The sheet, versions and staleness below the row are the picked look's.
 *
 * `sequenceId` null is the Characters page, for a character no sequence
 * casts (#2065): the same editor, writing the looks' current versions.
 */
export const CharacterLooksRow: React.FC<{
  sequenceId: string | null;
  characterId: string;
  /** Live looks, the default first. */
  looks: readonly LookRowItem[];
  activeLookId: string;
  onSelect: (lookId: string) => void;
}> = ({ sequenceId, characterId, looks, activeLookId, onSelect }) => {
  const translateEvent = useLiveTranslation('cast');
  const { t } = useTranslation('cast');

  const queryClient = useQueryClient();
  const createLook = useCreateCharacterLook();
  const updateLook = useUpdateCharacterLook();
  const removeLook = useRemoveCharacterLook();
  const [panel, setPanel] = useState<'add' | 'edit' | null>(null);
  const active = looks.find((look) => look.id === activeLookId);
  const defaultLookId = looks.find((look) => look.isDefault)?.id ?? characterId;

  const onAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseLookForm(event.currentTarget);
    if (!parsed.success) {
      toast.error(translateEvent('Look not saved'), {
        description: lookFormError(parsed.error, translateEvent),
      });
      return;
    }
    createLook.mutate(
      { sequenceId, characterId, ...parsed.data },
      {
        onSuccess: (created) => {
          setPanel(null);
          onSelect(created.lookId);
        },
        onError: (error) =>
          toast.error(translateEvent('Failed to add look'), {
            description: errorMessage(error),
          }),
      }
    );
  };

  const onEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active) return;
    const parsed = parseLookForm(event.currentTarget);
    if (!parsed.success) {
      toast.error(translateEvent('Look not saved'), {
        description: lookFormError(parsed.error, translateEvent),
      });
      return;
    }
    updateLook.mutate(
      { sequenceId, characterId, lookId: active.id, ...parsed.data },
      {
        onSuccess: () => setPanel(null),
        onError: (error) =>
          toast.error(translateEvent('Failed to save look'), {
            description: errorMessage(error),
          }),
      }
    );
  };

  const onRemove = (look: LookRowItem) => {
    const ref = { sequenceId, characterId, lookId: look.id };
    removeLook.mutate(ref, {
      onSuccess: () => {
        setPanel(null);
        onSelect(defaultLookId);
        toast(translateEvent('Removed {{value1}}', { value1: look.name }), {
          duration: 60_000,
          action: {
            label: translateEvent('Undo'),
            onClick: () =>
              void restoreCharacterLook(queryClient, ref).catch(
                (error: Error) =>
                  toast.error(translateEvent('Failed to restore look'), {
                    description: errorMessage(error),
                  })
              ),
          },
        });
      },
      // A look a scene still wears is refused; the message names the scenes.
      onError: (error) =>
        toast.error(translateEvent('Look not removed'), {
          description: errorMessage(error),
        }),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label={t('Looks')}
          value={activeLookId}
          onValueChange={(value) => {
            // Radix sends '' when the pressed item is pressed again.
            if (!value) return;
            setPanel(null);
            onSelect(value);
          }}
          className="flex-wrap justify-start"
        >
          {looks.map((look) => (
            <ToggleGroupItem
              key={look.id}
              value={look.id}
              className="flex h-auto items-center gap-2 py-1"
            >
              {look.sheetImageUrl ? (
                <AppImage
                  src={look.sheetImageUrl}
                  alt=""
                  width={48}
                  height={27}
                  className="h-7 w-12 rounded object-cover"
                />
              ) : null}
              <span>{look.name}</span>
              {look.isDefault ? <Badge>{t('Default look')}</Badge> : null}
              {look.sheetStatus === 'generating' ? (
                <Badge variant="secondary">{t('Generating…')}</Badge>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={panel === 'add'}
          onClick={() => setPanel(panel === 'add' ? null : 'add')}
        >
          {t('Add look')}
        </Button>
        {active ? (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={panel === 'edit'}
            onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
          >
            {t('Edit look')}
          </Button>
        ) : null}
        {active ? (
          <AskAssistantButton
            variant="ghost"
            context={[{ kind: 'look', id: active.id, label: active.name }]}
          />
        ) : null}
      </div>

      {panel === 'add' ? (
        <form
          onSubmit={onAdd}
          className="flex flex-col gap-3 rounded-lg border p-3"
        >
          <LookFields idPrefix="new-look" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={createLook.isPending}>
              {createLook.isPending ? t('Adding…') : t('Add look')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPanel(null)}
            >
              {t('Cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {panel === 'edit' && active ? (
        <form
          // Reseed when the look or its definition changes.
          key={`${active.id}:${active.lookVersionId}`}
          onSubmit={onEdit}
          className="flex flex-col gap-3 rounded-lg border p-3"
        >
          <LookFields idPrefix={`look-${active.id}`} look={active} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={updateLook.isPending}>
              {updateLook.isPending ? t('Saving…') : t('Save look')}
            </Button>
            {active.isDefault ? null : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={removeLook.isPending}
                onClick={() => onRemove(active)}
              >
                {removeLook.isPending ? t('Removing…') : t('Remove look')}
              </Button>
            )}
          </div>
        </form>
      ) : null}
    </div>
  );
};
