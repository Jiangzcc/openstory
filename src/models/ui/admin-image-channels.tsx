import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { AdminImageChannelForm } from './admin-image-channel-form';
import { AdminImageModelForm } from './admin-image-model-form';
import {
  AdminImageChannelsList,
  AdminImageModelsList,
} from './admin-image-channels-lists';
import { AdminImageChannelsSync } from './admin-image-channels-sync';
import { useAdminImageChannels } from './use-admin-image-channels';

export function AdminImageChannels() {
  const { t } = useTranslation('imageChannels');
  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {t('Image channels')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'Manage platform image channels, model capabilities, dynamic parameters and USD price cards.'
            )}
          </p>
        </header>
        <Alert>
          <AlertTitle>{t('Verify actual provider behavior')}</AlertTitle>
          <AlertDescription>
            {t(
              'Verified means tested effective. Unverified and unsupported settings remain in the admin draft and are unavailable to users. Public catalogs can list candidates that this account cannot run.'
            )}
          </AlertDescription>
        </Alert>
        <Suspense
          fallback={
            <div
              aria-label={t('Loading image channels')}
              className="flex flex-col gap-6"
            >
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          }
        >
          <ImageChannelsWorkspace />
        </Suspense>
      </div>
    </div>
  );
}

function ImageChannelsWorkspace() {
  const { t } = useTranslation('imageChannels');
  const state = useAdminImageChannels();
  return (
    <>
      <div className="flex justify-end">
        <Button
          className="min-h-11 sm:min-h-8"
          type="button"
          variant="outline"
          onClick={state.reload}
          disabled={state.busy}
        >
          {state.refreshing ? t('Reloading…') : t('Reload configuration')}
        </Button>
      </div>
      {state.loadError && (
        <Alert variant="destructive">
          <AlertTitle>{t('Could not reload image channels.')}</AlertTitle>
          <AlertDescription>
            {t(
              'Your current configuration and draft are still displayed. Try reloading again.'
            )}
          </AlertDescription>
        </Alert>
      )}
      <AdminImageChannelsList state={state} />
      <AdminImageChannelForm state={state} />
      <AdminImageChannelsSync state={state} />
      <AdminImageModelsList state={state} />
      <AdminImageModelForm state={state} />
    </>
  );
}
