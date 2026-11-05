import { useTranslation } from 'react-i18next';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { AdminTextSelect } from './admin-text-channels-fields';
import type { AdminTextChannelsState } from './use-admin-text-channels';

type SyncProps = { state: AdminTextChannelsState };

export function AdminTextChannelsSync({ state }: SyncProps) {
  const { t } = useTranslation('admin');
  if (state.sync.error) return <TextModelSyncError error={state.sync.error} />;
  if (state.sync.isPending)
    return (
      <output className="block text-sm text-muted-foreground">
        {t('Fetching text model candidates…')}
      </output>
    );
  if (!state.sync.result) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Synced text model candidates')}</CardTitle>
        <CardDescription>
          {t(
            'Sync only lists candidates. It never saves or enables a model binding.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('{{total}} text candidates returned', {
            total: state.sync.result.candidates.length,
          })}
        </p>
        {state.sync.result.candidates.length ? (
          <TextCandidatePicker state={state} />
        ) : (
          <p className="text-sm">
            {t(
              'No text candidates returned. You can still add a model manually.'
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TextCandidatePicker({ state }: SyncProps) {
  const { t } = useTranslation('admin');
  return (
    <>
      <AdminTextSelect
        id="text-channel-candidate"
        label="Text model candidate"
        value={state.sync.selected}
        options={state.sync.options}
        onChange={state.sync.select}
        hint="Choose a candidate to fill a new disabled custom binding. Set capabilities, token limits and USD costs before saving."
      />
      {state.sync.candidate && (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-4">
          <p className="font-medium break-words">{state.sync.candidate.name}</p>
          <code className="text-xs break-all text-muted-foreground">
            {state.sync.candidate.upstreamModel}
          </code>
          {state.sync.candidate.vendor && (
            <p className="text-sm break-words">{state.sync.candidate.vendor}</p>
          )}
          {state.sync.candidate.description && (
            <p className="text-sm break-words text-muted-foreground">
              {state.sync.candidate.description}
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={state.useCandidate}
          disabled={state.isBusy || !state.sync.candidate}
        >
          {t('Use candidate')}
        </Button>
      </div>
    </>
  );
}

function TextModelSyncError({ error }: { error: Error }) {
  const { t } = useTranslation('admin');
  const translate = useLabelTranslation('admin');
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('Could not sync text models.')}</AlertTitle>
      <AlertDescription className="break-words">
        <p>{translate(error.message)}</p>
        <p>
          {t(
            'Check the saved channel settings and try again. You can still add a model manually.'
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}
