import { useTranslation } from 'react-i18next';
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
} from './admin-text-channels-fields';
import {
  AdminTextModelCapabilities,
  AdminTextModelCosts,
  AdminTextModelDetails,
  AdminTextModelIdFields,
  AdminTextModelLimits,
  AdminTextModelRoutingFields,
} from './admin-text-channels-model-fields';
import type {
  AdminTextChannelsState,
  AdminTextModelEditor,
} from './use-admin-text-channels';

type ModelBodyProps = {
  editor: Omit<AdminTextModelEditor, 'focusRef'>;
  channelOptions: AdminTextChannelsState['channelOptions'];
  isBusy: boolean;
  onRefresh: () => void;
};

export function AdminTextModelForm({
  state,
}: {
  state: AdminTextChannelsState;
}) {
  const { t } = useTranslation('admin');
  const { focusRef, ...editor } = state.modelEditor;
  if (!editor.draft) return null;
  return (
    <Card
      ref={focusRef}
      tabIndex={-1}
      aria-labelledby="text-model-form-title"
      className="outline-none"
    >
      <CardHeader>
        <CardTitle id="text-model-form-title">
          {editor.draft.isNew
            ? t('Add model binding')
            : t('Edit model binding')}
        </CardTitle>
        <CardDescription>
          {t(
            'Choose the local model ID, its channel route and explicit capabilities and costs.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TextModelEditorBody
          editor={editor}
          channelOptions={state.channelOptions}
          isBusy={state.isBusy}
          onRefresh={state.refresh}
        />
      </CardContent>
    </Card>
  );
}

function TextModelEditorBody(props: ModelBodyProps) {
  const { editor } = props;
  if (!editor.draft) return null;
  return (
    <form
      onSubmit={editor.onSubmit}
      className="flex flex-col gap-5"
      aria-busy={editor.isSaving}
    >
      <fieldset disabled={props.isBusy} className="flex min-w-0 flex-col gap-5">
        <AdminTextModelIdFields editor={editor} />
        <AdminTextModelRoutingFields
          editor={editor}
          channelOptions={props.channelOptions}
        />
        <AdminTextModelCapabilities editor={editor} />
        <AdminTextModelLimits editor={editor} />
        <AdminTextModelCosts editor={editor} />
        <AdminTextModelDetails editor={editor} />
      </fieldset>
      <AdminTextEditorFeedback
        errors={editor.draft.errors}
        saveError={editor.saveError}
        isStale={editor.isStale}
        onRefresh={props.onRefresh}
        isRefreshing={props.isBusy}
      />
      <AdminTextEditorActions
        label="Save model binding"
        isSaving={editor.isSaving}
        disabled={props.isBusy || editor.isStale}
        onClose={editor.close}
      />
    </form>
  );
}
