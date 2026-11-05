import { useTranslation } from 'react-i18next';
import {
  TEXT_CHANNEL_LIMITS,
  TEXT_CHANNEL_PROTOCOLS,
} from '@/models/text-channels';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  AdminTextEditorActions,
  AdminTextEditorFeedback,
  AdminTextInput,
  AdminTextSelect,
  AdminTextToggle,
} from './admin-text-channels-fields';
import type { AdminTextChannelEditor } from './use-admin-text-channels';

type ChannelFieldsEditor = Omit<AdminTextChannelEditor, 'focusRef'>;

type ChannelFormProps = {
  editor: AdminTextChannelEditor;
  isBusy: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
};

export function AdminTextChannelForm(props: ChannelFormProps) {
  const { t } = useTranslation('admin');
  const { focusRef, ...editor } = props.editor;
  if (!editor.draft) return null;
  return (
    <Card
      ref={focusRef}
      tabIndex={-1}
      aria-labelledby="text-channel-form-title"
      className="outline-none"
    >
      <CardHeader>
        <CardTitle id="text-channel-form-title">
          {editor.draft.isNew ? t('Add text channel') : t('Edit text channel')}
        </CardTitle>
        <CardDescription>
          {t(
            'Channel URLs and credentials are visible only to platform administrators.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChannelEditorBody
          editor={editor}
          isBusy={props.isBusy}
          onRefresh={props.onRefresh}
          isRefreshing={props.isRefreshing}
        />
      </CardContent>
    </Card>
  );
}

function ChannelEditorBody(
  props: Omit<ChannelFormProps, 'editor'> & { editor: ChannelFieldsEditor }
) {
  const { editor, isBusy } = props;
  if (!editor.draft) return null;
  return (
    <form
      onSubmit={editor.onSubmit}
      className="flex flex-col gap-5"
      aria-busy={editor.isSaving}
    >
      <fieldset disabled={isBusy} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <ChannelConnectionFields editor={editor} />
        <ChannelCredentialField editor={editor} />
        <div className="sm:col-span-2">
          <AdminTextToggle
            id="text-channel-enabled"
            label="Channel enabled"
            hint="Disabled channels are unavailable for new model calls."
            checked={editor.draft.values.enabled}
            onChange={(value) => editor.change('enabled', value)}
            switchControl
          />
        </div>
      </fieldset>
      <AdminTextEditorFeedback
        errors={editor.draft.errors}
        saveError={editor.saveError}
        isStale={editor.isStale}
        onRefresh={props.onRefresh}
        isRefreshing={props.isRefreshing || isBusy}
      />
      <AdminTextEditorActions
        label="Save channel"
        isSaving={editor.isSaving}
        disabled={isBusy || editor.isStale}
        onClose={editor.close}
      />
    </form>
  );
}

function ChannelConnectionFields({ editor }: { editor: ChannelFieldsEditor }) {
  if (!editor.draft) return null;
  const { values, errors } = editor.draft;
  return (
    <>
      <AdminTextInput
        id="text-channel-name"
        label="Channel name"
        value={values.name}
        onChange={(value) => editor.change('name', value)}
        error={errors.name}
        maxLength={TEXT_CHANNEL_LIMITS.name}
      />
      <AdminTextInput
        id="text-channel-base-url"
        label="Base URL"
        type="url"
        value={values.baseUrl}
        onChange={(value) => editor.change('baseUrl', value)}
        error={errors.baseUrl}
        maxLength={TEXT_CHANNEL_LIMITS.baseUrl}
        placeholder="API base URL, e.g. https://api.example.com/v1"
      />
      <ChannelProtocolField editor={editor} />
    </>
  );
}

function ChannelProtocolField({ editor }: { editor: ChannelFieldsEditor }) {
  const { t } = useTranslation('admin');
  if (!editor.draft) return null;
  const options = [
    {
      value: TEXT_CHANNEL_PROTOCOLS.chatCompletions,
      label: t('OpenAI Chat Completions'),
    },
    { value: TEXT_CHANNEL_PROTOCOLS.responses, label: t('OpenAI Responses') },
  ];
  return (
    <AdminTextSelect
      id="text-channel-protocol"
      label="Protocol"
      value={editor.draft.values.protocol}
      options={options}
      onChange={(value) => {
        const protocol = options.find(
          (option) => option.value === value
        )?.value;
        if (protocol) editor.change('protocol', protocol);
      }}
      error={editor.draft.errors.protocol}
    />
  );
}

function ChannelCredentialField({ editor }: { editor: ChannelFieldsEditor }) {
  const { t } = useTranslation('admin');
  if (!editor.draft) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AdminTextInput
        id="text-channel-api-key"
        label="API key"
        type="password"
        autoComplete="new-password"
        value={editor.draft.values.apiKey}
        onChange={(value) => editor.change('apiKey', value)}
        error={editor.draft.errors.apiKey}
        maxLength={TEXT_CHANNEL_LIMITS.apiKey}
        required={false}
        hint="Leave blank to keep the saved key. Changing the base URL requires a new key."
      />
      <p className="break-all text-sm text-muted-foreground">
        {editor.original?.hasKey
          ? t('Saved key: {{hint}}', { hint: editor.original.keyHint })
          : t('No API key saved')}
      </p>
    </div>
  );
}
