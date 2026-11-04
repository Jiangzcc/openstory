import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { openAssistant } from '@/assistant/ui/assistant-store';
import { UpdateAllDialog } from '@/shots/ui/staleness/update-all-dialog';
import { Button } from '@/ui/shadcn/button';
import {
  type ShotStaleness,
  shotIsStale,
  shotIsUpdating,
} from './use-shot-staleness';
import type { ShotView } from '@/shots/shot-view';
import type { SceneWithScript } from './use-scenes';
import type { UpdateStaleDepth } from '@/shots/update-stale-depth';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

type SceneStaleShotsProps = {
  /** The in-scope shots (a scene's, or the whole sequence's), in order. */
  shots: ShotView[];
  /** Dry-run preview scope for the depth dialog (#1194). */
  sequenceId: string;
  sceneId?: string;
  /** Batched staleness for those shots, keyed by shot id (#1077). */
  staleness: Record<string, ShotStaleness> | undefined;
  /**
   * The staleness check failed. Without this, an errored request is
   * indistinguishable from a clean scene — both render nothing.
   */
  stalenessFailed?: boolean;
  /** Same handler the left rail uses — lands at shot scope. */
  onSelectShot: (shotId: string) => void;
  /**
   * Across several scenes the chips are scenes, not shots: the rail numbers
   * shots within a scene, so a sequence-wide "Shot 7" names nothing on it.
   */
  scenes?: readonly Pick<SceneWithScript, 'id' | 'title'>[];
  onSelectScene?: (sceneId: string) => void;
  /**
   * Regenerate out-of-date artifacts across these shots at the chosen
   * cascade depth (#1085) — rendered as a depth menu on the action.
   */
  onUpdateAll?: (depth: UpdateStaleDepth) => void;
  isUpdating?: boolean;
};

/**
 * Scene-scope staleness summary (#1077): one quiet line ending in clickable
 * shot-number chips that navigate down to shot scope, where the inline
 * regenerate controls live. A single line — no thumbnails — so it can't read
 * as content or compete with the reference imagery below. Renders nothing
 * while everything is fresh — no permanent strip.
 */
export const SceneStaleShots: React.FC<SceneStaleShotsProps> = ({
  shots,
  sequenceId,
  sceneId,
  staleness,
  stalenessFailed = false,
  onSelectShot,
  scenes,
  onSelectScene,
  onUpdateAll,
  isUpdating = false,
}) => {
  const { t } = useTranslation('shots');

  // "Update all" opens the depth confirm dialog (#1085).
  const [updateAllOpen, setUpdateAllOpen] = useState(false);
  if (stalenessFailed) {
    return (
      <div
        data-testid="scene-stale-shots-error"
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50"
        />
        <span>{t('Couldn’t check whether these shots are up to date')}</span>
      </div>
    );
  }

  const staleShots = shots.filter((shot) => shotIsStale(staleness?.[shot.id]));
  // Shots whose stale artifacts are all already covered by a live server-side
  // claim (#1085) — a run (this tab's or someone else's) is fixing them now.
  const updatingShots = shots.filter(
    (shot) =>
      !shotIsStale(staleness?.[shot.id]) && shotIsUpdating(staleness?.[shot.id])
  );
  if (staleShots.length === 0 && updatingShots.length === 0) return null;

  const busy = isUpdating;

  // In one scene a chip is the shot's position in it, as the rail numbers
  // it. Across scenes a chip is a scene (its title, as the rail shows it),
  // which opens it, where the shot chips take over.
  const numberByShotId = new Map(shots.map((s, index) => [s.id, index + 1]));
  const sceneChips =
    !sceneId && scenes && onSelectScene
      ? sceneChipsOf(staleShots, updatingShots, shots, scenes, t)
      : null;

  return (
    <div
      data-testid="scene-stale-shots"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
    >
      {staleShots.length > 0 ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
        />
      ) : (
        <Loader2
          aria-hidden="true"
          className="h-3 w-3 shrink-0 animate-spin text-amber-600 motion-reduce:animate-none"
        />
      )}
      <span>
        {staleShots.length > 0
          ? t('Out of date since your edit')
          : t('Updating out-of-date shots…')}
      </span>
      <span aria-hidden="true">·</span>
      {sceneChips?.map((chip) => (
        <Button
          key={chip.sceneId}
          type="button"
          variant="outline"
          size="sm"
          className="h-5 max-w-56 rounded-full px-2 text-xs font-normal"
          onClick={() => onSelectScene?.(chip.sceneId)}
          aria-label={t('Open {{value1}} — {{value2}} {{value3}} {{value4}}', {
            value1: chip.title,
            value2: chip.count,
            value3: chip.count === 1 ? t('shot') : t('shots'),
            value4: chip.updating ? t('updating') : t('out of date'),
          })}
        >
          {chip.updating && (
            <Loader2
              aria-hidden="true"
              className="mr-1 h-2.5 w-2.5 shrink-0 animate-spin motion-reduce:animate-none"
            />
          )}
          <span className="truncate">{chip.title}</span>
          <span className="shrink-0 tabular-nums">· {chip.count}</span>
        </Button>
      ))}
      {(sceneChips ? [] : [...staleShots, ...updatingShots]).map((shot) => {
        const number = numberByShotId.get(shot.id) ?? shot.shotNumber ?? 0;
        const updating = updatingShots.includes(shot);
        return (
          <Button
            key={shot.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-5 rounded-full px-2 text-xs font-normal"
            onClick={() => onSelectShot(shot.id)}
            aria-label={
              updating
                ? t('Open shot {{value1}} — updating', { value1: number })
                : t('Open shot {{value1}} — out of date', { value1: number })
            }
          >
            {updating && (
              <Loader2
                aria-hidden="true"
                className="mr-1 h-2.5 w-2.5 animate-spin motion-reduce:animate-none"
              />
            )}
            <span>{t('Shot {{value1}}', { value1: number })}</span>
          </Button>
        );
      })}
      <span aria-hidden="true">·</span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() =>
          openAssistant({
            // Sequence and scene come off the route; the stale shots do not.
            // Six leaves room for those two under the eight-chip cap.
            context: staleShots.slice(0, 6).map((shot) => ({
              kind: 'shot',
              id: shot.id,
              label: t('Shot {{value1}}', {
                value1: numberByShotId.get(shot.id) ?? shot.shotNumber ?? 0,
              }),
            })),
            starters: ['What changed and what needs regenerating?'],
          })
        }
      >
        {t('Chat about this')}
      </Button>
      {onUpdateAll && staleShots.length > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setUpdateAllOpen(true)}
            disabled={busy}
            aria-busy={busy}
            aria-label={t('Update all out-of-date shots')}
          >
            {isUpdating && (
              <Loader2
                aria-hidden="true"
                className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none"
              />
            )}
            {isUpdating ? t('Updating…') : t('Update all')}
          </Button>
          <UpdateAllDialog
            open={updateAllOpen}
            onOpenChange={setUpdateAllOpen}
            staleShots={staleShots.flatMap((s) => staleness?.[s.id] ?? [])}
            scope={{ sequenceId, sceneId }}
            // Across scenes a position number names nothing on the rail;
            // the dialog says how many shots instead.
            shotNumberById={sceneChips ? undefined : numberByShotId}
            onConfirm={(depth: UpdateStaleDepth) => {
              setUpdateAllOpen(false);
              onUpdateAll(depth);
            }}
          />
        </>
      )}
    </div>
  );
};

/**
 * One chip per scene holding a flagged shot, in rail order. A scene reads
 * "updating" only when none of its flagged shots is still out of date.
 */
function sceneChipsOf(
  stale: readonly ShotView[],
  updating: readonly ShotView[],
  inOrder: readonly ShotView[],
  scenes: readonly Pick<SceneWithScript, 'id' | 'title'>[],
  translate?: TFunction<'shots'>
): { sceneId: string; title: string; count: number; updating: boolean }[] {
  const staleIds = new Set(stale.map((shot) => shot.id));
  const updatingIds = new Set(updating.map((shot) => shot.id));
  const chips = new Map<
    string,
    { sceneId: string; title: string; count: number; updating: boolean }
  >();
  for (const shot of inOrder) {
    const isStale = staleIds.has(shot.id);
    if ((!isStale && !updatingIds.has(shot.id)) || !shot.sceneId) continue;
    const index = scenes.findIndex((scene) => scene.id === shot.sceneId);
    const chip = chips.get(shot.sceneId) ?? {
      sceneId: shot.sceneId,
      title:
        scenes[index]?.title ||
        (translate?.('Scene {{value1}}', { ns: 'shots', value1: index + 1 }) ??
          `Scene ${index + 1}`),
      count: 0,
      updating: true,
    };
    chip.count += 1;
    if (isStale) chip.updating = false;
    chips.set(shot.sceneId, chip);
  }
  return [...chips.values()];
}
