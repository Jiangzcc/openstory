import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { AdminImageSelect } from './admin-image-channels-fields';
import type { AdminImageChannelsState } from './use-admin-image-channels';

export function AdminImageChannelsSync({
  state,
}: {
  state: AdminImageChannelsState;
}) {
  const { t } = useTranslation('imageChannels');
  if (state.sync.isPending)
    return <output aria-live="polite">{t('Reading model candidates…')}</output>;
  if (state.sync.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('Could not read model candidates.')}</AlertTitle>
        <AlertDescription>
          {t(
            'Check the saved channel and its key. You can still add a model manually.'
          )}
        </AlertDescription>
      </Alert>
    );
  const result = state.sync.data;
  if (!result) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Model candidates')}</CardTitle>
        <CardDescription>
          {t(
            'This only reads the provider model directory. It does not generate images, spend model credits, save bindings or infer supported parameters and prices.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('{{count}} model candidates returned', {
            count: result.candidates.length,
          })}
        </p>
        {result.candidates.length ? (
          <ImageCandidateSelection key={result.channelId} state={state} />
        ) : (
          <p>
            {t('No candidates returned. You can still add a model manually.')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ImageCandidateSelection({
  state,
}: {
  state: AdminImageChannelsState;
}) {
  const { t } = useTranslation('imageChannels');
  const candidates = state.sync.data?.candidates ?? [];
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const candidate = new FormData(event.currentTarget).get(
          'image-candidate'
        );
        if (typeof candidate === 'string') state.useCandidate(candidate);
      }}
    >
      <AdminImageSelect
        name="image-candidate"
        label="Model candidate"
        defaultValue={candidates[0]?.upstreamModel}
        options={candidates.map((candidate) => ({
          value: candidate.upstreamModel,
          label: candidate.name + ' · ' + candidate.upstreamModel,
        }))}
      />
      <Button type="submit" disabled={state.busy}>
        {t('Use candidate as a disabled draft')}
      </Button>
    </form>
  );
}
