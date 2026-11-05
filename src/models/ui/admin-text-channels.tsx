import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { AdminTextChannelForm } from './admin-text-channels-channel-form';
import {
  AdminTextChannelsList,
  AdminTextModelsList,
} from './admin-text-channels-lists';
import { AdminTextModelForm } from './admin-text-channels-model-form';
import { AdminTextChannelsSync } from './admin-text-channels-sync';
import { useAdminTextChannels } from './use-admin-text-channels';
import type { AdminTextChannelsState } from './use-admin-text-channels';

export function AdminTextChannels() {
  const { t } = useTranslation('admin');
  const state = useAdminTextChannels();
  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {t('Text channels')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'Manage platform text channels and the local models routed through them.'
            )}
          </p>
        </div>
        <Alert>
          <AlertTitle>{t('Admin-only channel settings')}</AlertTitle>
          <AlertDescription>
            {t(
              'Channel addresses and key metadata stay in the admin configuration. Users only receive available model candidates.'
            )}
          </AlertDescription>
        </Alert>
        {state.loadError && <TextChannelsLoadError state={state} />}
        {state.data ? (
          <TextChannelsWorkspace state={state} />
        ) : (
          state.isLoading && <TextChannelsSkeleton />
        )}
      </div>
    </div>
  );
}

function TextChannelsWorkspace({ state }: { state: AdminTextChannelsState }) {
  return (
    <>
      <AdminTextChannelsList state={state} />
      <AdminTextChannelForm
        editor={state.channelEditor}
        isBusy={state.isBusy}
        onRefresh={state.refresh}
        isRefreshing={state.isRefreshing}
      />
      <AdminTextChannelsSync state={state} />
      <AdminTextModelsList state={state} />
      <AdminTextModelForm state={state} />
    </>
  );
}

function TextChannelsLoadError({ state }: { state: AdminTextChannelsState }) {
  const { t } = useTranslation('admin');
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('Could not load text channels.')}</AlertTitle>
      <AlertDescription>
        <p>{t('Reload the configuration to try again.')}</p>
        <Button
          type="button"
          variant="outline"
          onClick={state.refresh}
          disabled={state.isBusy}
        >
          {state.isRefreshing ? t('Reloading…') : t('Reload configuration')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function TextChannelsSkeleton() {
  const { t } = useTranslation('admin');
  return (
    <output
      aria-label={t('Loading text channels')}
      className="flex flex-col gap-6"
    >
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </output>
  );
}
