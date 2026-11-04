import { useTranslation } from 'react-i18next';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/shadcn/tooltip';
import type { ModelCoverage } from './sequence-model-coverage';
import { Check, CircleAlert, CircleCheck, Loader2 } from 'lucide-react';

/**
 * Sequence-wide per-model coverage marker for the header image/video dropdowns
 * (#547). Mirrors the per-scene status icons but reads "for the whole sequence":
 * ⊙ live primary / ✓ generated (with an N/M count while only partially filled)
 * / ⟳ generating / ! failed. `pending` renders nothing.
 */
export const ModelCoverageMarker = ({
  coverage,
}: {
  coverage?: ModelCoverage;
}) => {
  const { t } = useTranslation('models');
  const translateLabel = useLabelTranslation('models');

  if (!coverage || coverage.status === 'pending') return null;
  const { status, completed, total } = coverage;
  const partial =
    status === 'completed' && total > 0 && completed > 0 && completed < total;

  const { Icon, className, label } = (() => {
    switch (status) {
      case 'set':
        return {
          Icon: CircleCheck,
          className: 'text-emerald-500',
          label: 'Live primary across the sequence',
        };
      case 'generating':
        return {
          Icon: Loader2,
          className: 'text-muted-foreground animate-spin',
          label: 'Generating…',
        };
      case 'failed':
        return {
          Icon: CircleAlert,
          className: 'text-destructive',
          label: 'Generation failed',
        };
      default:
        return {
          Icon: Check,
          className: 'text-muted-foreground',
          label: partial
            ? t(
                'Generated for {{value1}} of {{value2}} scenes — select, then Set to use',
                { value1: completed, value2: total }
              )
            : 'Generated for every scene — select, then Set to use',
        };
    }
  })();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
            aria-label={translateLabel(label)}
          >
            {partial && (
              <span className="tabular-nums">
                {completed}/{total}
              </span>
            )}
            <Icon className={`size-3.5 ${className}`} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{translateLabel(label)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
