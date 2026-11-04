import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
/**
 * The shot spec above a prompt (#1929). The still's tab edits framing and
 * action; the video's tab edits action, camera move, pacing, direction and
 * sound. Saving rebuilds the prompts from the spec for free. A written
 * prompt is replaced only when the user says so.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/platform/errors';
import {
  shotSpecEditSchema,
  type StoredShotSpec,
} from '@/shots/shot-list.schema';
import {
  CAMERA_ANGLES,
  CAMERA_MOVES,
  MOVE_PACINGS,
  SHOT_SIZES,
} from '@/shots/shot-spec-vocabulary';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/shadcn/alert-dialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { useSaveShotSpec, useShotSpec } from './use-shot-spec';

type Part = 'still' | 'motion';

type Field = {
  name: string;
  label: string;
  read: (spec: StoredShotSpec) => string;
  suggestions?: readonly string[];
};

const FIELDS = {
  shotSize: {
    name: 'shotSize',
    label: 'Shot size',
    read: (s) => s.framing.shotSize,
    suggestions: SHOT_SIZES,
  },
  angle: {
    name: 'angle',
    label: 'Angle',
    read: (s) => s.framing.angle,
    suggestions: CAMERA_ANGLES,
  },
  composition: {
    name: 'composition',
    label: 'Composition',
    read: (s) => s.framing.composition,
  },
  subjectStartState: {
    name: 'subjectStartState',
    label: 'Subject at the start',
    read: (s) => s.framing.subjectStartState,
  },
  action: { name: 'action', label: 'Action', read: (s) => s.action },
  move: {
    name: 'move',
    label: 'Camera move',
    read: (s) => s.cameraMovement.move,
    suggestions: CAMERA_MOVES,
  },
  pacing: {
    name: 'pacing',
    label: 'Pacing',
    read: (s) => s.cameraMovement.pacing,
    suggestions: MOVE_PACINGS,
  },
  direction: {
    name: 'direction',
    label: 'Direction',
    read: (s) => s.direction,
  },
  soundCue: { name: 'soundCue', label: 'Sound', read: (s) => s.soundCue },
} satisfies Record<string, Field>;

const PART_FIELDS: Record<Part, Field[]> = {
  still: [
    FIELDS.shotSize,
    FIELDS.angle,
    FIELDS.composition,
    FIELDS.subjectStartState,
    FIELDS.action,
  ],
  motion: [
    FIELDS.action,
    FIELDS.move,
    FIELDS.pacing,
    FIELDS.direction,
    FIELDS.soundCue,
  ],
};

/** The saved spec with this tab's fields read off the form. */
function specFromForm(form: FormData, spec: StoredShotSpec): StoredShotSpec {
  const value = (name: string, fallback: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : fallback;
  };
  return {
    framing: {
      shotSize: value('shotSize', spec.framing.shotSize),
      angle: value('angle', spec.framing.angle),
      composition: value('composition', spec.framing.composition),
      subjectStartState: value(
        'subjectStartState',
        spec.framing.subjectStartState
      ),
    },
    action: value('action', spec.action),
    cameraMovement: {
      move: value('move', spec.cameraMovement.move),
      pacing: value('pacing', spec.cameraMovement.pacing),
    },
    direction: value('direction', spec.direction),
    soundCue: value('soundCue', spec.soundCue),
  };
}

function writtenLabel(visual: boolean, motion: boolean): string {
  if (visual && motion) return 'start frame and video prompts';
  return visual ? 'start frame prompt' : 'video prompt';
}

export function ShotSpecForm({
  sequenceId,
  shotId,
  part,
}: {
  sequenceId: string;
  shotId: string;
  part: Part;
}) {
  const { t } = useTranslation('shots');

  const { data } = useShotSpec({ sequenceId, shotId });
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (!data.spec) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('No shot spec yet. Rewrite shot writes one.')}
      </p>
    );
  }
  return (
    <SpecFields
      // A new spec (a save, a rewrite landing) resets the fields to it.
      key={JSON.stringify(data.spec)}
      sequenceId={sequenceId}
      shotId={shotId}
      part={part}
      spec={data.spec}
      verdict={data.verdict}
      visualWritten={data.visualWritten}
      motionWritten={data.motionWritten}
    />
  );
}

function SpecFields({
  sequenceId,
  shotId,
  part,
  spec,
  verdict,
  visualWritten,
  motionWritten,
}: {
  sequenceId: string;
  shotId: string;
  part: Part;
  spec: StoredShotSpec;
  verdict: 'current' | 'stale' | 'missing' | 'updating';
  visualWritten: boolean;
  motionWritten: boolean;
}) {
  const translateEvent = useLiveTranslation('shots');
  const translateLabel = useLabelTranslation('shots');

  const { t } = useTranslation('shots');

  const save = useSaveShotSpec(sequenceId);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<StoredShotSpec | null>(null);
  const updating = verdict === 'updating';

  const submit = (next: StoredShotSpec, replace: boolean) => {
    setPending(null);
    save.mutate(
      {
        shotId,
        spec: next,
        replace: {
          visual: replace && visualWritten,
          motion: replace && motionWritten,
        },
      },
      {
        onSuccess: () => {
          setDirty(false);
          toast.success(translateEvent('Shot spec saved'));
        },
        onError: (error) =>
          toast.error(translateEvent('Could not save the shot spec'), {
            description: errorMessage(error),
          }),
      }
    );
  };

  return (
    <form
      className="flex flex-col gap-3"
      onChange={() => setDirty(true)}
      onReset={() => setDirty(false)}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = shotSpecEditSchema.safeParse(
          specFromForm(new FormData(event.currentTarget), spec)
        );
        if (!parsed.success) {
          toast.error(translateEvent('Could not save the shot spec'), {
            description: parsed.error.issues[0]?.message,
          });
          return;
        }
        if (visualWritten || motionWritten) setPending(parsed.data);
        else submit(parsed.data, false);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('Shot spec')}</span>
        {verdict === 'stale' && (
          <span className="text-xs text-muted-foreground">
            {t('Script changed since it was written')}
          </span>
        )}
        {updating && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {t('Rewriting…')}
          </span>
        )}
      </div>
      <fieldset
        className="grid gap-3 sm:grid-cols-2"
        disabled={updating || save.isPending}
      >
        {PART_FIELDS[part].map((field) => {
          const id = `${shotId}-${part}-${field.name}`;
          const listId = field.suggestions ? `${id}-suggestions` : undefined;
          return (
            <label key={field.name} className="text-xs" htmlFor={id}>
              {translateLabel(field.label)}
              <Input
                id={id}
                name={field.name}
                defaultValue={field.read(spec)}
                maxLength={2000}
                list={listId}
                autoComplete="off"
              />
              {field.suggestions && (
                <datalist id={listId}>
                  {field.suggestions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </datalist>
              )}
            </label>
          );
        })}
      </fieldset>
      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="reset"
            size="sm"
            variant="outline"
            disabled={save.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={save.isPending || updating}>
            {save.isPending ? t('Saving…') : t('Save')}
          </Button>
        </div>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Replace your written prompt?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'You wrote the {{value1}}. Replace it with one built from this spec, or keep your text.',
                { value1: writtenLabel(visualWritten, motionWritten) }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) submit(pending, false);
              }}
            >
              {t('Keep mine')}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (pending) submit(pending, true);
              }}
            >
              {t('Replace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
