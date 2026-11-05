import { useTranslation } from 'react-i18next';
import type { ChannelTextModel, TextChannel } from '@/models/text-channels';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import type { AdminTextChannelsState } from './use-admin-text-channels';

type ListProps = { state: AdminTextChannelsState };

export function AdminTextChannelsList({ state }: ListProps) {
  const { t } = useTranslation('admin');
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4 sm:flex-row">
        <div className="flex min-w-0 flex-col gap-2">
          <CardTitle>{t('Channels')}</CardTitle>
          <CardDescription>
            {t(
              'Platform-managed OpenAI-compatible connections for text models.'
            )}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => state.channelEditor.open()}
          disabled={state.isBusy}
        >
          {t('Add text channel')}
        </Button>
      </CardHeader>
      <CardContent>
        {!state.data?.channels.length && (
          <p className="text-sm text-muted-foreground">
            {t(
              'No text channels yet. Add a channel to configure text model bindings.'
            )}
          </p>
        )}
        {state.data?.channels.map((channel) => (
          <div
            key={channel.id}
            className="flex min-w-0 flex-col gap-4 border-b py-4 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <ChannelSummary channel={channel} />
            <ChannelActions channel={channel} state={state} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ChannelSummary({ channel }: { channel: TextChannel }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium break-words">{channel.name}</h3>
        <EnabledBadge enabled={channel.enabled} />
      </div>
      <p className="font-mono text-xs break-all text-muted-foreground">
        {channel.baseUrl}
      </p>
      <p className="text-xs break-all text-muted-foreground">
        {channel.hasKey
          ? t('Saved key: {{hint}}', { hint: channel.keyHint })
          : t('No API key saved')}
      </p>
    </div>
  );
}

function ChannelActions({
  channel,
  state,
}: ListProps & { channel: TextChannel }) {
  const { t } = useTranslation('admin');
  const syncing = state.sync.isPending && state.sync.channelId === channel.id;
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => state.channelEditor.open(channel)}
        disabled={state.isBusy}
        aria-label={t('Edit channel {{name}}', { name: channel.name })}
      >
        {t('Edit')}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => state.sync.start(channel.id)}
        disabled={state.isBusy || !channel.hasKey}
        aria-label={t('Sync models for {{name}}', { name: channel.name })}
      >
        {syncing ? t('Syncing…') : t('Sync text models')}
      </Button>
    </div>
  );
}

export function AdminTextModelsList({ state }: ListProps) {
  const { t } = useTranslation('admin');
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4 sm:flex-row">
        <div className="flex min-w-0 flex-col gap-2">
          <CardTitle>{t('Model bindings')}</CardTitle>
          <CardDescription>
            {t('Route built-in and custom text models through saved channels.')}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => state.modelEditor.open()}
          disabled={state.isBusy || !state.data?.channels.length}
        >
          {t('Add model binding')}
        </Button>
      </CardHeader>
      <CardContent>
        {!state.bindings.length && (
          <p className="text-sm text-muted-foreground">
            {t(
              'No channel model bindings yet. Manual model entry is always available after saving a channel.'
            )}
          </p>
        )}
        {state.bindings.map(({ model, channelName }) => (
          <TextModelRow
            key={model.id}
            model={model}
            channelName={channelName}
            state={state}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TextModelRow(
  props: ListProps & { model: ChannelTextModel; channelName: string }
) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex min-w-0 flex-col gap-4 border-b py-4 first:pt-0 last:border-0 last:pb-0 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium break-words">{props.model.name}</h3>
          <EnabledBadge enabled={props.model.enabled} />
        </div>
        <code className="text-xs break-all text-muted-foreground">
          {props.model.id}
        </code>
        <p className="text-sm break-all">
          {t('Channel: {{name}}', { name: props.channelName })}
          <span className="mx-2 text-muted-foreground" aria-hidden>
            ·
          </span>
          {props.model.upstreamModel}
        </p>
        <TextModelCapabilities model={props.model} />
      </div>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 lg:justify-end">
        <TextModelPrices model={props.model} />
        <Button
          type="button"
          variant="outline"
          disabled={props.state.isBusy}
          onClick={() => props.state.modelEditor.open(props.model)}
          aria-label={t('Edit binding {{name}}', { name: props.model.name })}
        >
          {t('Edit')}
        </Button>
      </div>
    </div>
  );
}

function TextModelCapabilities({ model }: { model: ChannelTextModel }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-wrap gap-1.5">
      {model.vision && <Badge variant="secondary">{t('Vision')}</Badge>}
      {model.structuredOutput && (
        <Badge variant="secondary">{t('Structured output')}</Badge>
      )}
      {model.tools && <Badge variant="secondary">{t('Tools')}</Badge>}
    </div>
  );
}

function TextModelPrices({ model }: { model: ChannelTextModel }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        {t('Input: {{price}} USD / 1M tokens', {
          price: model.inputPricePerMillion,
        })}
      </p>
      <p>
        {t('Output: {{price}} USD / 1M tokens', {
          price: model.outputPricePerMillion,
        })}
      </p>
    </div>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('admin');
  return (
    <Badge variant={enabled ? 'secondary' : 'outline'}>
      {enabled ? t('Enabled') : t('Disabled')}
    </Badge>
  );
}
