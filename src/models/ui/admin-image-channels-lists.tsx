import { useTranslation } from 'react-i18next';
import { IMAGE_MODELS, isBuiltinTextToImageModel } from '@/models/models';
import type { ImageChannel, ChannelImageModel } from '@/models/image-channels';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import type { AdminImageChannelsState } from './use-admin-image-channels';

type ListProps = { state: AdminImageChannelsState };

export function AdminImageChannelsList({ state }: ListProps) {
  const { t } = useTranslation('imageChannels');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Image channels')}</CardTitle>
        <CardDescription>
          {t(
            'Platform administrators manage the endpoint, credentials and availability.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.data.channels.map((channel) => (
          <ImageChannelRow key={channel.id} channel={channel} state={state} />
        ))}
        {!state.data.channels.length && (
          <p className="text-sm text-muted-foreground">
            {t('No image channels configured.')}
          </p>
        )}
        <div>
          <Button
            className="min-h-11 sm:min-h-8"
            type="button"
            disabled={state.busy}
            onClick={() => state.channelEditor.openChannel()}
          >
            {t('Add image channel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImageChannelRow({
  channel,
  state,
}: ListProps & { channel: ImageChannel }) {
  const { t } = useTranslation('imageChannels');
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{channel.name}</span>
          <Badge variant={channel.enabled ? 'secondary' : 'outline'}>
            {channel.enabled ? t('Enabled') : t('Disabled')}
          </Badge>
        </div>
        <code className="break-all text-xs text-muted-foreground">
          {channel.baseUrl}
        </code>
        <p className="text-sm text-muted-foreground">
          {channel.hasKey ? t('Platform key configured') : t('No platform key')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          type="button"
          variant="outline"
          disabled={state.busy}
          onClick={() => state.channelEditor.openChannel(channel)}
        >
          {t('Edit channel')}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          type="button"
          variant="outline"
          disabled={state.busy || !channel.hasKey}
          onClick={() => state.sync.mutate(channel.id)}
        >
          {t('Read model candidates')}
        </Button>
      </div>
    </div>
  );
}

export function AdminImageModelsList({ state }: ListProps) {
  const { t } = useTranslation('imageChannels');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Configured image models')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.data.models.map((model) => (
          <ImageModelRow key={model.id} model={model} state={state} />
        ))}
        {!state.data.models.length && (
          <p className="text-sm text-muted-foreground">
            {t('No image models configured.')}
          </p>
        )}
        <div>
          <Button
            className="min-h-11 sm:min-h-8"
            type="button"
            disabled={state.busy || !state.data.channels.length}
            onClick={() => state.modelEditor.openModel()}
          >
            {t('Add image model')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImageModelRow({
  model,
  state,
}: ListProps & { model: ChannelImageModel }) {
  const { t } = useTranslation('imageChannels');
  const channel = state.data.channels.find(
    (item) => item.id === model.channelId
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">
            {isBuiltinTextToImageModel(model.id)
              ? IMAGE_MODELS[model.id].name
              : model.name}
          </span>
          <Badge variant="outline">
            {isBuiltinTextToImageModel(model.id)
              ? t('Built-in binding')
              : t('Custom image model')}
          </Badge>
          <Badge variant={model.enabled ? 'secondary' : 'outline'}>
            {model.enabled ? t('Enabled') : t('Disabled')}
          </Badge>
        </div>
        <code className="break-all text-xs text-muted-foreground">
          {model.id}
        </code>
        <p className="text-sm">{channel?.name ?? model.channelId}</p>
        <ImageModelOperationBadges model={model} />
        <p className="text-sm text-muted-foreground">
          {t('{{parameters}} parameters · {{prices}} USD price cards', {
            parameters: model.parameters.length,
            prices: model.priceCards.length,
          })}
        </p>
      </div>
      <Button
        className="min-h-11 sm:min-h-8"
        type="button"
        variant="outline"
        disabled={state.busy}
        onClick={() => state.modelEditor.openModel(model)}
      >
        {t('Edit model')}
      </Button>
    </div>
  );
}

function ImageModelOperationBadges({ model }: { model: ChannelImageModel }) {
  const { t } = useTranslation('imageChannels');
  const translate = useLabelTranslation('imageChannels');
  const labels = {
    verified: 'Verified',
    unverified: 'Unverified',
    unsupported: 'Unsupported',
  };
  return (
    <div className="flex flex-wrap gap-2">
      {model.operations.generate && (
        <Badge variant="outline">
          {t('Generate')}: {translate(labels[model.operations.generate.status])}
        </Badge>
      )}
      {model.operations.edit && (
        <Badge variant="outline">
          {t('Edit')}: {translate(labels[model.operations.edit.status])}
        </Badge>
      )}
    </div>
  );
}
