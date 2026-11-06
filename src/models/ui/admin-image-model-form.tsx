import { useTranslation } from 'react-i18next';
import { IMAGE_CHANNEL_LIMITS } from '@/models/image-channels';
import { isBuiltinTextToImageModel } from '@/models/models';
import { IMAGE_OPERATIONS } from '@/models/image-channel-parameters';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  AdminImageCheckbox,
  AdminImageEditorActions,
  AdminImageFeedback,
  AdminImageSelect,
  AdminImageTextarea,
} from './admin-image-channels-fields';
import { IMAGE_FORM_TEXT_ROWS } from './admin-image-channels-state';
import { AdminImageModelIdentity } from './admin-image-model-identity';
import { AdminImageOperationFields } from './admin-image-operation-fields';
import { AdminImageParameterForm } from './admin-image-parameter-form';
import { AdminImagePriceCardForm } from './admin-image-price-card-form';
import type { AdminImageChannelsState } from './use-admin-image-channels';

type ModelProps = { state: AdminImageChannelsState };

export function AdminImageModelForm({ state }: ModelProps) {
  const { t } = useTranslation('imageChannels');
  const { focusRef, ...editor } = state.modelEditor;
  if (!editor.draft) return null;
  return (
    <Card
      ref={focusRef}
      tabIndex={-1}
      className="outline-none"
      aria-labelledby="image-model-editor"
    >
      <CardHeader>
        <CardTitle id="image-model-editor">
          {editor.draft.isNew ? t('Add image model') : t('Edit image model')}
        </CardTitle>
        <CardDescription>
          {t(
            'Bind a built-in image model or create a custom-image: model. Built-in bindings keep the original model ID and name.'
          )}{' '}
          {t(
            'An enabled built-in binding uses this platform channel and its USD price cards. Disabling it restores the original route.'
          )}{' '}
          {t(
            'Enter the exact upstream model ID for each operation; it may differ from the local model ID.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ImageModelFormBody key={editor.draft.formKey} state={state} />
      </CardContent>
    </Card>
  );
}

function ImageModelFormBody({ state }: ModelProps) {
  const editor = state.modelEditor;
  if (!editor.draft) return null;
  const model = editor.draft.value;
  return (
    <form
      onSubmit={editor.onSubmit}
      className="flex flex-col gap-5"
      aria-busy={editor.saving}
    >
      <fieldset disabled={state.busy} className="flex min-w-0 flex-col gap-5">
        <ImageModelIdentityFields state={state} />
        <ImageModelOperations state={state} />
        <AdminImageParameterForm
          parameters={model.parameters}
          operations={IMAGE_OPERATIONS.filter(
            (operation) => !!model.operations[operation]
          )}
        />
        <AdminImagePriceCardForm priceCards={model.priceCards} />
        <AdminImageCheckbox
          name="enabled"
          label="Model enabled"
          defaultChecked={model.enabled}
        />
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
        label="Save model"
      />
    </form>
  );
}

function ImageModelIdentityFields({ state }: ModelProps) {
  const editor = state.modelEditor;
  if (!editor.draft) return null;
  const model = editor.draft.value;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminImageModelIdentity
          model={model}
          models={state.data.models}
          isNew={editor.draft.isNew}
        />
        <AdminImageSelect
          name="channelId"
          label="Image channel"
          defaultValue={model.channelId}
          options={state.data.channels.map((channel) => ({
            value: channel.id,
            label: channel.name,
          }))}
        />
      </div>
      <AdminImageTextarea
        name="description"
        label="Description (optional)"
        defaultValue={model.description ?? ''}
        rows={IMAGE_FORM_TEXT_ROWS}
        maxLength={IMAGE_CHANNEL_LIMITS.description}
      />
    </>
  );
}

function ImageModelOperations({ state }: ModelProps) {
  const editor = state.modelEditor;
  if (!editor.draft) return null;
  const model = editor.draft.value;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {IMAGE_OPERATIONS.map((operation) => (
        <AdminImageOperationFields
          key={operation}
          operation={operation}
          binding={model.operations[operation]}
          locked={
            !editor.draft?.isNew &&
            !isBuiltinTextToImageModel(model.id) &&
            !!model.operations[operation]
          }
        />
      ))}
    </div>
  );
}
