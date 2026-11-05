import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getModelConfigurationOptions,
  MODEL_CONFIGURATION_FIELDS,
} from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import { useAdminModelConfiguration } from './use-admin-model-configuration';
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
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Skeleton } from '@/ui/shadcn/skeleton';

const CONFIGURATION_GROUPS = [
  {
    key: 'defaults',
    label: 'General defaults',
    description:
      'Fallback models and the initial video recommendation for new sequences.',
  },
  {
    key: 'turbo',
    label: 'Turbo recommendations',
    description: 'Recommended models when users choose Turbo mode.',
  },
  {
    key: 'quality',
    label: 'Quality recommendations',
    description: 'Recommended models when users choose Quality mode.',
  },
  {
    key: 'internal',
    label: 'Internal steps',
    description:
      'Models for helper operations that have no separate user model selector.',
  },
] as const;

type ConfigurationField = (typeof MODEL_CONFIGURATION_FIELDS)[number];
type ConfigurationGroup = (typeof CONFIGURATION_GROUPS)[number];
type ConfigurationState = ReturnType<typeof useAdminModelConfiguration>;
type ModelChangeHandler = ConfigurationState['onModelChange'];

export function AdminModelConfiguration() {
  const { t } = useTranslation('admin');
  return (
    <div className="relative flex flex-1 flex-col gap-6 overflow-auto">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          {t('Model configuration')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'Choose default recommendations and models used by internal steps.'
          )}
        </p>
      </div>
      <Alert>
        <AlertTitle>{t('Applies to new operations')}</AlertTitle>
        <AlertDescription>
          {t(
            'Changes apply to new operations only. Existing tasks and models explicitly chosen by users stay unchanged.'
          )}
        </AlertDescription>
      </Alert>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            {CONFIGURATION_GROUPS.map((group) => (
              <div key={group.key} className="flex flex-col gap-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-64 w-full" />
              </div>
            ))}
          </div>
        }
      >
        <ModelConfigurationForm />
      </Suspense>
    </div>
  );
}

function ModelConfigurationForm() {
  const { t } = useTranslation('admin');
  const state = useAdminModelConfiguration();
  return (
    <form
      onSubmit={state.onSubmit}
      className="flex flex-col gap-6"
      aria-busy={state.isSaving}
    >
      <fieldset
        disabled={state.isSaving}
        className="flex min-w-0 flex-col gap-6"
      >
        {CONFIGURATION_GROUPS.map((group) => (
          <ModelConfigurationSection
            key={group.key}
            group={group}
            catalog={state.catalog}
            values={state.values}
            onModelChange={state.onModelChange}
            disabled={state.isSaving}
          />
        ))}
      </fieldset>
      {state.hasValidationError && (
        <Alert variant="destructive">
          <AlertTitle>
            {t('Choose a supported model for every field.')}
          </AlertTitle>
        </Alert>
      )}
      {state.saveError && (
        <Alert variant="destructive">
          <AlertTitle>{t('Could not save model configuration.')}</AlertTitle>
          <AlertDescription>
            {t('Your changes are still in the form. Try saving again.')}
          </AlertDescription>
        </Alert>
      )}
      <ModelConfigurationActions state={state} />
    </form>
  );
}

function ModelConfigurationSection({
  group,
  catalog,
  values,
  onModelChange,
  disabled,
}: {
  group: ConfigurationGroup;
  catalog: ConfigurationState['catalog'];
  values: ModelConfiguration;
  onModelChange: ModelChangeHandler;
  disabled: boolean;
}) {
  const translateLabel = useLabelTranslation('admin');
  return (
    <section aria-labelledby={'model-configuration-group-' + group.key}>
      <Card>
        <CardHeader>
          <CardTitle id={'model-configuration-group-' + group.key}>
            {translateLabel(group.label)}
          </CardTitle>
          <CardDescription>{translateLabel(group.description)}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {MODEL_CONFIGURATION_FIELDS.filter(
            (field) => field.group === group.key
          ).map((field) => (
            <ModelConfigurationSelect
              key={field.key}
              field={field}
              catalog={catalog}
              value={values[field.key]}
              onModelChange={onModelChange}
              disabled={disabled}
            />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function ModelConfigurationSelect({
  field,
  catalog,
  value,
  onModelChange,
  disabled,
}: {
  field: ConfigurationField;
  catalog: ConfigurationState['catalog'];
  value: string;
  onModelChange: ModelChangeHandler;
  disabled: boolean;
}) {
  const translateLabel = useLabelTranslation('admin');
  const id = 'model-configuration-' + field.key;
  const options = getModelConfigurationOptions(field.key, catalog);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{translateLabel(field.label)}</Label>
      <Select
        name={field.key}
        value={value}
        items={options}
        required
        disabled={disabled}
        onValueChange={(next) => onModelChange(field.key, next)}
      >
        <SelectTrigger
          id={id}
          aria-describedby={id + '-description'}
          className="min-h-11 w-full text-base md:min-h-8 md:text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={id + '-description'} className="text-sm text-muted-foreground">
        {translateLabel(field.description)}
      </p>
    </div>
  );
}

function ModelConfigurationActions({ state }: { state: ConfigurationState }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {state.hasUnsavedChanges
            ? t('Unsaved changes')
            : t('No unsaved changes')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={state.restoreDefaults}
            disabled={state.isSaving || !state.canRestoreDefaults}
          >
            {t('Restore code defaults')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={state.discardChanges}
            disabled={state.isSaving || !state.hasUnsavedChanges}
          >
            {t('Discard unsaved changes')}
          </Button>
          <Button
            type="submit"
            disabled={
              state.isSaving ||
              !state.hasUnsavedChanges ||
              state.hasValidationError
            }
          >
            {state.isSaving ? t('Saving…') : t('Save changes')}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'Restore and discard only change this form. Save changes to apply the configuration.'
        )}
      </p>
    </div>
  );
}
