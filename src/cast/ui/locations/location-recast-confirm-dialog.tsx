import { useTranslation } from 'react-i18next';
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

type LocationRecastConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  locationName: string;
  /** The team location the sequence will use instead. */
  withLocationName: string;
  affectedShotCount: number;
  isLoading: boolean;
};

/**
 * Confirm a Replace (#1695): the sequence is re-pointed at another of the
 * team's locations and the shots set here re-render. No sheet is drawn.
 */
export const LocationRecastConfirmDialog: React.FC<
  LocationRecastConfirmDialogProps
> = ({
  open,
  onOpenChange,
  onConfirm,
  locationName,
  withLocationName,
  affectedShotCount,
  isLoading,
}) => {
  const { t } = useTranslation('cast');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('Replace {{value1}} with {{value2}}?', {
              value1: locationName,
              value2: withLocationName,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              'This sequence uses {{value1}} instead. {{value2}} {{value3}} stays in your locations.',
              {
                value1: withLocationName,
                value2:
                  affectedShotCount === 0
                    ? t('No shot is set here.')
                    : affectedShotCount === 1
                      ? t('1 shot set here re-renders.')
                      : t('{{value1}} shots set here re-render.', {
                          value1: affectedShotCount,
                        }),
                value3: locationName,
              }
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {t('Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? t('Replacing…') : t('Replace')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
