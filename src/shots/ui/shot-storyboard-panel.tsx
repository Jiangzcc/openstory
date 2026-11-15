import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLocale } from '@/platform/i18n/locale';
import type { Locale } from '@/platform/i18n/locale';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { useFalBillingGate } from '@/billing/ui/use-billing-gate';
import { errorMessage } from '@/platform/errors';
import type { ShotSpecSource } from '@/platform/server/db/schema';
import {
  getShotStoryboardFn,
  regenerateShotStoryboardFn,
} from '@/shots/shot-storyboard.fn';
import { AppImage } from '@/ui/shadcn/app-image';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/shadcn/sheet';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { useHydrated } from '@/ui/use-hydrated';
import { cn } from '@/ui/utils';
import { useSaveShotSpec } from './use-shot-spec';

type PanelProps = { sequenceId: string; shotId: string };

/** Under ['shots', sequenceId], so a landed sketch's realtime invalidation reaches it. */
export const storyboardQuery = (sequenceId: string, shotId: string) =>
  queryOptions({
    queryKey: ['shots', sequenceId, 'storyboard', shotId],
    queryFn: () => getShotStoryboardFn({ data: { sequenceId, shotId } }),
    refetchInterval: (query) => (query.state.data?.generating ? 3000 : false),
  });

const STALE_COPY = {
  missing: 'No sketch yet.',
  failed: 'The last sketch failed.',
  changed: 'The spec or cast changed since this sketch.',
} as const;

/**
 * A shot's storyboard (#2350): its sketch, whether it is stale, Regenerate,
 * and History, which lists every spec version with its sketch.
 */
export const ShotStoryboardPanel: React.FC<
  PanelProps & { onOpenHistory: () => void }
> = (props) => (
  <Suspense
    fallback={
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-16 w-24" />
      </div>
    }
  >
    <StoryboardBody {...props} />
  </Suspense>
);

const StoryboardBody: React.FC<PanelProps & { onOpenHistory: () => void }> = ({
  sequenceId,
  shotId,
  onOpenHistory,
}) => {
  const { t } = useTranslation('shots');
  const translateLabel = useLabelTranslation('shots');
  const translateEvent = useLiveTranslation('shots');
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const { needsBillingSetup, showGate } = useFalBillingGate();
  const { data } = useSuspenseQuery(storyboardQuery(sequenceId, shotId));
  const regenerate = useMutation({
    mutationFn: () =>
      regenerateShotStoryboardFn({ data: { sequenceId, shotId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['shots', sequenceId] }),
    onError: (error) =>
      toast.error(translateEvent('Sketch did not start'), {
        description: errorMessage(error),
      }),
  });
  const drawing = data.generating || regenerate.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {drawing
            ? t('Drawing a new sketch…')
            : data.staleReason === 'failed'
              ? `${translateLabel(STALE_COPY.failed)} ${data.history[0]?.error ?? ''}`.trim()
              : data.staleReason
                ? translateLabel(STALE_COPY[data.staleReason])
                : t('Up to date with the spec and cast.')}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hydrated}
            onClick={onOpenHistory}
          >
            {t('History')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={data.staleReason ? 'default' : 'outline'}
            disabled={!hydrated || drawing}
            onClick={() => {
              if (needsBillingSetup) {
                showGate();
                return;
              }
              regenerate.mutate();
            }}
          >
            {drawing ? t('Drawing…') : t('Regenerate')}
          </Button>
        </div>
      </div>

      {data.current?.url ? (
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
          <AppImage
            src={data.current.url}
            alt={t('Current storyboard sketch')}
            width={96}
            height={64}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
    </div>
  );
};

const SOURCE_LABEL: Record<ShotSpecSource, string> = {
  analysis: 'Analysis',
  rewrite: 'Rewrite',
  rename: 'Rename',
  edit: 'Edit',
};

function formatTimestamp(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** Every spec version of a shot, newest first, each with its sketch (#2350). */
export const ShotSpecHistorySheet: React.FC<
  PanelProps & { onOpenChange: (open: boolean) => void }
> = ({ onOpenChange, ...props }) => {
  const { t } = useTranslation('shots');
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{t('Shot history')}</SheetTitle>
          <SheetDescription>
            {t(
              'Each spec version and the sketch drawn from it. Using one saves it as a new version and keeps any prompt you wrote.'
            )}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <Suspense
            fallback={
              <div className="flex flex-col gap-2 pt-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            }
          >
            <SpecVersionList {...props} />
          </Suspense>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

const SpecVersionList: React.FC<PanelProps> = ({ sequenceId, shotId }) => {
  const { t, i18n } = useTranslation('shots');
  const translateLabel = useLabelTranslation('shots');
  const translateEvent = useLiveTranslation('shots');
  const { data } = useSuspenseQuery(storyboardQuery(sequenceId, shotId));
  const save = useSaveShotSpec(sequenceId);

  if (data.versions.length === 0) {
    return (
      <p className="pt-4 text-sm text-muted-foreground">
        {t('No spec versions.')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2 pt-2">
      {data.versions.map((version) => {
        const { sketch } = version;
        const drawing =
          sketch?.status === 'generating' || sketch?.status === 'pending';
        const summary = [
          version.spec.framing.shotSize,
          version.spec.framing.angle,
          version.spec.action,
        ]
          .filter((part) => part.trim().length > 0)
          .join(' · ');
        return (
          <li
            key={version.id}
            className={cn(
              'flex gap-3 rounded-md border p-3',
              version.selected && 'border-primary/40 bg-primary/5'
            )}
          >
            <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground">
              {sketch?.status === 'completed' && sketch.url ? (
                <AppImage
                  src={sketch.url}
                  alt=""
                  width={96}
                  height={64}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>
                  {drawing
                    ? t('Drawing…')
                    : sketch?.status === 'failed'
                      ? t('Sketch failed')
                      : t('No sketch')}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {translateLabel(SOURCE_LABEL[version.source])}
                  </Badge>
                  {version.selected && <Badge>{t('Current')}</Badge>}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatTimestamp(
                    version.createdAt,
                    resolveLocale(i18n.resolvedLanguage)
                  )}
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {summary}
              </p>
              {!version.selected && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-end"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate(
                      {
                        shotId,
                        spec: version.spec,
                        replace: { visual: false, motion: false },
                      },
                      {
                        onSuccess: () =>
                          toast.success(translateEvent('Spec version in use')),
                        onError: (error) =>
                          toast.error(
                            translateEvent('Could not use this version'),
                            {
                              description: errorMessage(error),
                            }
                          ),
                      }
                    )
                  }
                >
                  {save.isPending && save.variables.spec === version.spec
                    ? t('Saving…')
                    : t('Use this version')}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
