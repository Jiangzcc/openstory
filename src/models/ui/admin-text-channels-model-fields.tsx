import { useTranslation } from 'react-i18next';
import { TEXT_CHANNEL_LIMITS } from '@/models/text-channels';
import {
  CUSTOM_TEXT_MODEL_PREFIX,
  MIN_TEXT_MODEL_PRICE,
  MIN_TEXT_MODEL_TOKENS,
  TEXT_MODEL_TOKEN_STEP,
} from './admin-text-channels-state';
import {
  AdminTextDescription,
  AdminTextInput,
  AdminTextSelect,
  AdminTextToggle,
} from './admin-text-channels-fields';
import type { AdminTextModelEditor } from './use-admin-text-channels';

type ModelFieldsProps = { editor: Omit<AdminTextModelEditor, 'focusRef'> };
const CAPABILITY_FIELDS = [
  { key: 'vision', label: 'Vision', hint: 'Accepts image input.' },
  {
    key: 'structuredOutput',
    label: 'Structured output',
    hint: 'Required for sequence analysis; confirm schema-constrained JSON support.',
  },
  {
    key: 'tools',
    label: 'Tools',
    hint: 'Required for the assistant; confirm tool and function calling support.',
  },
] as const;
const TOKEN_FIELDS = [
  { key: 'contextWindow', label: 'Context window (tokens)' },
  { key: 'maxOutputTokens', label: 'Maximum output tokens' },
] as const;
const PRICE_FIELDS = [
  { key: 'inputPricePerMillion', label: 'Input cost (USD / 1M tokens)' },
  { key: 'outputPricePerMillion', label: 'Output cost (USD / 1M tokens)' },
] as const;

export function AdminTextModelIdFields({ editor }: ModelFieldsProps) {
  if (!editor.draft) return null;
  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <AdminTextSelect
        id="text-model-choice"
        label="Local model"
        value={editor.choice}
        options={editor.options}
        onChange={editor.changeChoice}
        disabled={!editor.draft.isNew}
        error={editor.isCustom ? undefined : editor.draft.errors.id}
        hint="Bind a built-in model or create a custom local model ID. Saved model IDs cannot be changed."
      />
      {editor.isCustom && (
        <div className="flex min-w-0 flex-col gap-2">
          <AdminTextInput
            id="text-model-custom-id"
            label="Custom model ID"
            value={editor.customId}
            onChange={editor.changeCustomId}
            readOnly={!editor.draft.isNew}
            error={editor.draft.errors.id}
            maxLength={TEXT_CHANNEL_LIMITS.id - CUSTOM_TEXT_MODEL_PREFIX.length}
            placeholder="Letters, numbers, . _ / -; e.g. vendor/model"
          />
          <code className="break-all text-xs text-muted-foreground">
            {editor.draft.values.id}
          </code>
        </div>
      )}
    </div>
  );
}

export function AdminTextModelRoutingFields(
  props: ModelFieldsProps & {
    channelOptions: { value: string; label: string }[];
  }
) {
  const { editor } = props;
  if (!editor.draft) return null;
  const { values, errors } = editor.draft;
  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
      <AdminTextInput
        id="text-model-name"
        label="Model name"
        value={values.name}
        onChange={(value) => editor.change('name', value)}
        error={errors.name}
        maxLength={TEXT_CHANNEL_LIMITS.name}
      />
      <AdminTextSelect
        id="text-model-channel"
        label="Channel"
        value={values.channelId}
        options={props.channelOptions}
        onChange={(value) => editor.change('channelId', value ?? '')}
        error={errors.channelId}
      />
      <div className="sm:col-span-2">
        <AdminTextInput
          id="text-model-upstream"
          label="Upstream model ID"
          value={values.upstreamModel}
          onChange={(value) => editor.change('upstreamModel', value)}
          error={errors.upstreamModel}
          maxLength={TEXT_CHANNEL_LIMITS.upstreamModel}
          placeholder="Exact upstream model ID, e.g. vendor/model-name"
        />
      </div>
    </div>
  );
}

export function AdminTextModelCapabilities({ editor }: ModelFieldsProps) {
  const { t } = useTranslation('admin');
  if (!editor.draft) return null;
  const { values } = editor.draft;
  return (
    <div className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-medium">{t('Capabilities')}</h3>
      {!editor.isCustom && (
        <p className="text-sm text-muted-foreground">
          {t(
            'Built-in bindings keep the capabilities required by the original model.'
          )}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {CAPABILITY_FIELDS.map(({ key, label, hint }) => (
          <AdminTextToggle
            key={key}
            id={'text-model-' + key}
            label={label}
            hint={hint}
            checked={values[key]}
            disabled={editor.requiredCapabilities[key]}
            onChange={(value) => editor.change(key, value)}
          />
        ))}
      </div>
    </div>
  );
}

export function AdminTextModelLimits({ editor }: ModelFieldsProps) {
  if (!editor.draft) return null;
  const { values, errors } = editor.draft;
  return (
    <div className="grid min-w-0 gap-5 border-t pt-5 sm:grid-cols-2">
      {TOKEN_FIELDS.map(({ key, label }) => (
        <AdminTextInput
          key={key}
          id={'text-model-' + key}
          label={label}
          value={values[key]}
          type="number"
          min={MIN_TEXT_MODEL_TOKENS}
          step={TEXT_MODEL_TOKEN_STEP}
          error={errors[key]}
          onChange={(value) => editor.change(key, value)}
        />
      ))}
    </div>
  );
}

export function AdminTextModelCosts({ editor }: ModelFieldsProps) {
  const { t } = useTranslation('admin');
  if (!editor.draft) return null;
  const { values, errors } = editor.draft;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'Provider costs in USD per 1 million tokens. Enter both rates explicitly, including zero. Public catalog prices are not imported.'
        )}
      </p>
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        {PRICE_FIELDS.map(({ key, label }) => (
          <AdminTextInput
            key={key}
            id={'text-model-' + key}
            label={label}
            value={values[key]}
            type="number"
            min={MIN_TEXT_MODEL_PRICE}
            step="any"
            error={errors[key]}
            onChange={(value) => editor.change(key, value)}
          />
        ))}
      </div>
    </div>
  );
}

export function AdminTextModelDetails({ editor }: ModelFieldsProps) {
  if (!editor.draft) return null;
  const { values, errors } = editor.draft;
  return (
    <div className="flex min-w-0 flex-col gap-5 border-t pt-5">
      <AdminTextInput
        id="text-model-vendor"
        label="Vendor (optional)"
        value={values.vendor ?? ''}
        required={false}
        error={errors.vendor}
        maxLength={TEXT_CHANNEL_LIMITS.name}
        onChange={(value) => editor.change('vendor', value)}
      />
      <AdminTextDescription
        value={values.description ?? ''}
        error={errors.description}
        maxLength={TEXT_CHANNEL_LIMITS.description}
        onChange={(value) => editor.change('description', value)}
      />
      <AdminTextToggle
        id="text-model-enabled"
        label="Model binding enabled"
        hint="A binding is available to users only when its channel is enabled and has a saved key."
        checked={values.enabled}
        onChange={(value) => editor.change('enabled', value)}
        switchControl
      />
    </div>
  );
}
