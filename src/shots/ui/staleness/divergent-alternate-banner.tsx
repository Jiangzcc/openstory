import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/ui/utils';
import type {
  StalenessArtifact,
  StalenessEntityType,
  BannerDensity,
} from './staleness-indicator';

type DivergentAlternateBannerProps = {
  variantId: string;
  artifact: StalenessArtifact;
  entityType: StalenessEntityType;
  /** Render a Compare button (inline) / make the dot clickable (corner-dot). */
  onCompare?: () => void;
  /** Inline-only: promote button is rendered only when this is provided. */
  onPromote?: () => void;
  /** Inline-only: discard button is rendered only when this is provided. */
  onDiscard?: () => void;
  density?: BannerDensity;
  className?: string;
};

const ARTIFACT_LABEL: Record<StalenessArtifact, string> = {
  thumbnail: 'image',
  video: 'video',
  audio: 'audio',
  sheet: 'sheet',
  'visual-prompt': 'visual prompt',
  'motion-prompt': 'motion prompt',
  'music-prompt': 'music prompt',
  music: 'music',
};

export const DivergentAlternateBanner: React.FC<
  DivergentAlternateBannerProps
> = ({
  variantId,
  artifact,
  entityType,
  onCompare,
  onPromote,
  onDiscard,
  density = 'inline',
  className,
}) => {
  const { t } = useTranslation('shots');
  const translateLabel = useLabelTranslation('labels');

  const ariaLabel = t(
    'Divergent alternate {{value1}} available for this {{value2}}',
    {
      value1: translateLabel(ARTIFACT_LABEL[artifact]),
      value2: translateLabel(entityType),
    }
  );

  if (density === 'corner-dot') {
    return (
      <button
        type="button"
        onClick={onCompare}
        aria-label={ariaLabel}
        title={t('Alternate version available — click to compare')}
        data-slot="divergent-alternate-dot"
        data-variant-id={variantId}
        data-artifact={artifact}
        data-entity-type={entityType}
        className={cn(
          'group relative inline-flex h-6 w-6 items-center justify-center rounded-full',
          'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
      >
        <span
          aria-hidden="true"
          className="block h-2 w-2 rounded-full bg-sky-500 ring-2 ring-sky-500/30 transition-transform group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </button>
    );
  }

  return (
    <Alert
      aria-live="polite"
      data-slot="divergent-alternate-banner"
      data-density="inline"
      data-variant-id={variantId}
      data-artifact={artifact}
      data-entity-type={entityType}
      className={className}
    >
      <Info aria-hidden="true" />
      <AlertTitle>{t('Alternate version available')}</AlertTitle>
      <AlertDescription>
        {t(
          'An alternate {{value1}} was generated with the inputs you had at the time.',
          { value1: translateLabel(ARTIFACT_LABEL[artifact]) }
        )}
      </AlertDescription>
      <div className="col-start-2 mt-2 flex flex-wrap items-center gap-2">
        {onCompare && (
          <Button type="button" size="sm" variant="outline" onClick={onCompare}>
            {t('Compare')}
          </Button>
        )}
        {onPromote && (
          <Button type="button" size="sm" onClick={onPromote}>
            {t('Promote')}
          </Button>
        )}
        {onDiscard && (
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
            {t('Discard')}
          </Button>
        )}
      </div>
    </Alert>
  );
};
