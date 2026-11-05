import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
import {
  useAddLocationPhotos,
  useLocationPhotos,
  useRemoveLocationPhoto,
} from '@/cast/ui/use-organization-locations';
import { errorMessage } from '@/platform/errors';
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
import { AppImage } from '@/ui/shadcn/app-image';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * The photos a location's sheet is drawn from (#1695). They are the
 * location's own, so the section is the same through a sequence and from
 * none. Adding or removing one draws nothing: the sheet reads stale until it
 * is regenerated.
 */
export const LocationPhotos: React.FC<{
  locationId: string;
  /** While a sheet run is reading the photos. */
  disabled: boolean;
}> = ({ locationId, disabled }) => {
  const translateEvent = useLiveTranslation('cast');
  const { t } = useTranslation('cast');

  const { data: photos } = useLocationPhotos(locationId);
  const addPhotos = useAddLocationPhotos();
  const removePhoto = useRemoveLocationPhoto();
  const inputRef = useRef<HTMLInputElement>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  return (
    <section
      aria-label={t('Reference photos')}
      className="flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('Photos')}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            // Reset so picking the same file again re-fires onChange.
            event.currentTarget.value = '';
            if (files.length === 0) return;
            addPhotos.mutate(
              { locationId, files },
              {
                onSuccess: () =>
                  toast.success(
                    files.length === 1 ? 'Photo added' : 'Photos added'
                  ),
                onError: (error) =>
                  toast.error(translateEvent('Photos not added'), {
                    description: errorMessage(error),
                  }),
              }
            );
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || addPhotos.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {addPhotos.isPending ? t('Adding…') : t('Add photos')}
        </Button>
      </div>
      {!photos ? (
        <Skeleton className="h-20 w-full" />
      ) : photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('No photos. The sheet is drawn from the description.')}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              className="relative aspect-video overflow-hidden rounded-md bg-muted"
            >
              <AppImage
                src={photo.url}
                alt={t('Photo {{value1}}', { value1: index + 1 })}
                width={240}
                height={135}
                className="h-full w-full object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t('Remove photo {{value1}}', { value1: index + 1 })}
                className="absolute right-1 top-1 h-7 w-7"
                disabled={disabled || removePhoto.isPending}
                onClick={() => setRemovingId(photo.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={removingId !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Remove this photo?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('The sheet reads stale until it is regenerated.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removingId === null) return;
                removePhoto.mutate(
                  { locationId, photoId: removingId },
                  {
                    onError: (error) =>
                      toast.error(translateEvent('Photo not removed'), {
                        description: errorMessage(error),
                      }),
                  }
                );
              }}
            >
              {t('Remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
