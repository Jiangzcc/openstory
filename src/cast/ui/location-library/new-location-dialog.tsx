import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { LocationMediaUpload } from '@/cast/ui/location-library/location-media-upload';
import { useCreateOrganizationLocation } from '@/cast/ui/use-organization-locations';
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
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';
import { useHydrated } from '@/ui/use-hydrated';

const newLocationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000),
});

/**
 * Make a location with no sequence (#1695): a name, an optional description
 * and any number of photos. Its sheet is drawn from the photos, or from the
 * description when there are none. A sequence uses it later with @.
 */
export const NewLocationDialog: React.FC<{
  trigger?: React.ReactNode;
  onCreated: (location: { id: string; name: string }) => void;
}> = ({ trigger, onCreated }) => {
  const translateEvent = useLiveTranslation('cast');
  const { t } = useTranslation('cast');

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const createLocation = useCreateOrganizationLocation();
  const hydrated = useHydrated();

  const close = () => {
    setOpen(false);
    setFiles([]);
    setPhotoUrls([]);
    setUploading(false);
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Opened from inside the create screen's picker, which is a form too.
    event.stopPropagation();
    const result = newLocationSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget))
    );
    if (!result.success) {
      toast.error(translateEvent('Check the location fields'), {
        description: result.error.issues[0]?.message,
      });
      return;
    }
    createLocation.mutate(
      {
        name: result.data.name,
        description: result.data.description || null,
        rendering: PHOTOREAL_RENDERING,
        photoUrls,
      },
      {
        onSuccess: (location) => {
          close();
          onCreated(location);
        },
        onError: (error) =>
          toast.error(translateEvent('Location not created'), {
            description: errorMessage(error),
          }),
      }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <DialogTrigger asChild>
        {trigger ?? <Button disabled={!hydrated}>{t('New location')}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New location')}</DialogTitle>
          <DialogDescription>
            {t('Its sheet is drawn from the photos, or from the description.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-organization-location-name">{t('Name')}</Label>
            <Input
              id="new-organization-location-name"
              name="name"
              autoComplete="off"
              placeholder={t('Coffee shop…')}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-organization-location-description">
              {t('Description (optional)')}
            </Label>
            <Textarea
              id="new-organization-location-description"
              name="description"
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('Photos (optional)')}</Label>
            <LocationMediaUpload
              files={files}
              onFilesChange={setFiles}
              onUploadedUrlsChange={setPhotoUrls}
              onUploadingChange={setUploading}
              disabled={createLocation.isPending}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={createLocation.isPending || uploading}
            >
              {createLocation.isPending
                ? t('Creating…')
                : uploading
                  ? t('Uploading…')
                  : t('Create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
