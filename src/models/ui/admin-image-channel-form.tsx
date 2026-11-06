import { useTranslation } from 'react-i18next';
import { IMAGE_CHANNEL_LIMITS } from '@/models/image-channels';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/ui/shadcn/card';
import {
  AdminImageCheckbox,
  AdminImageEditorActions,
  AdminImageFeedback,
  AdminImageInput,
} from './admin-image-channels-fields';
import type {
  AdminImageChannelsState,
  AdminImageChannelEditor,
} from './use-admin-image-channels';

type EditorProps = {
  state: AdminImageChannelsState;
  editor: Omit<AdminImageChannelEditor, 'focusRef'>;
};

export function AdminImageChannelForm({
  state,
}: {
  state: AdminImageChannelsState;
}) {
  const { t } = useTranslation('imageChannels');
  const { focusRef, ...editor } = state.channelEditor;
  if (!editor.draft) return null;
  return (
    <Card
      ref={focusRef}
      tabIndex={-1}
      className="outline-none"
      aria-labelledby="image-channel-editor"
    >
      <CardHeader>
        <CardTitle id="image-channel-editor">
          {editor.draft.isNew
            ? t('Add image channel')
            : t('Edit image channel')}
        </CardTitle>
        <CardDescription>
          {t(
            'Credentials are stored encrypted. Saved API keys are never returned to this page.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ImageChannelFormBody
          key={editor.draft.formKey}
          state={state}
          editor={editor}
        />
      </CardContent>
    </Card>
  );
}

function ImageChannelFormBody({ state, editor }: EditorProps) {
  const { t } = useTranslation('imageChannels');
  if (!editor.draft) return null;
  return (
    <form
      onSubmit={editor.onSubmit}
      className="flex flex-col gap-5"
      aria-busy={editor.saving}
    >
      <fieldset
        disabled={state.busy}
        className="grid min-w-0 gap-5 sm:grid-cols-2"
      >
        <ImageChannelConnectionFields editor={editor} />
        <ImageChannelCredentialFields state={state} editor={editor} />
        <AdminImageCheckbox
          name="enabled"
          label="Channel enabled"
          defaultChecked={editor.draft.value.enabled}
        />
        <p className="text-sm text-muted-foreground">
          {t('Disabled channels are unavailable for new model calls.')}
        </p>
      </fieldset>
      <AdminImageFeedback
        issues={editor.issues}
        error={editor.error}
        stale={editor.stale}
        onReload={state.reload}
        busy={state.busy}
      />
      <AdminImageEditorActions
        saving={editor.saving}
        disabled={state.busy || editor.stale}
        onCancel={editor.close}
        label="Save channel"
      />
    </form>
  );
}

function ImageChannelConnectionFields({
  editor,
}: {
  editor: Omit<AdminImageChannelEditor, 'focusRef'>;
}) {
  const { t } = useTranslation('imageChannels');
  if (!editor.draft) return null;
  const values = editor.draft.value;
  return (
    <>
      <AdminImageInput
        name="id"
        label="Channel identifier"
        defaultValue={values.id}
        readOnly
      />
      <AdminImageInput
        name="name"
        label="Channel name"
        defaultValue={values.name}
        required
        maxLength={IMAGE_CHANNEL_LIMITS.name}
      />
      <AdminImageInput
        name="baseUrl"
        label="Base URL"
        type="url"
        defaultValue={values.baseUrl}
        required
        maxLength={IMAGE_CHANNEL_LIMITS.baseUrl}
        hint="API base URL including the version path, such as https://api.example.com/v1."
      />
      <AdminImageInput label="Protocol" value={t('OpenAI Images')} readOnly />
    </>
  );
}

function ImageChannelCredentialFields({ state, editor }: EditorProps) {
  const { t } = useTranslation('imageChannels');
  if (!editor.draft) return null;
  const saved = state.data.channels.find(
    (channel) => channel.id === editor.draft?.value.id
  );
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <AdminImageInput
        name="apiKey"
        label="Platform API key"
        type="password"
        defaultValue=""
        autoComplete="new-password"
        maxLength={IMAGE_CHANNEL_LIMITS.apiKey}
        hint="Leave blank to keep the saved key. Enter a new key when changing the base URL."
      />
      <p className="text-sm text-muted-foreground">
        {saved?.hasKey
          ? t('A platform key is configured.')
          : t('No platform key is configured.')}
      </p>
    </div>
  );
}
