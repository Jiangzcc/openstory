import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AnalysisModelDefinition } from '@/models/models.config';
import { mergeTextModelCatalog } from '@/models/text-model-catalog';
import { textModelCatalogQueryOptions } from '@/models/text-channels.queries';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DEFAULT_MODEL_CONFIGURATION,
  MODEL_CONFIGURATION_FIELDS,
  createModelConfigurationSchema,
} from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import {
  getAdminModelConfigurationFn,
  saveModelConfigurationFn,
} from '@/models/model-configuration.fn';

import { MODEL_CONFIGURATION_QUERY_KEY } from '@/models/model-configuration.queries';
import { createModelConfigurationDraftUpdate } from './model-configuration-draft';
const ADMIN_CONFIGURATION_QUERY_KEY = [
  ...MODEL_CONFIGURATION_QUERY_KEY,
  'admin',
] as const;

function configurationsMatch(
  left: Readonly<ModelConfiguration>,
  right: Readonly<ModelConfiguration>
) {
  return MODEL_CONFIGURATION_FIELDS.every(
    ({ key }) => left[key] === right[key]
  );
}

function useConfigurationDraft(
  saved: ModelConfiguration,
  catalog: readonly AnalysisModelDefinition[]
) {
  const modelConfigurationSchema = createModelConfigurationSchema(catalog);
  const [draft, setDraft] = useState<ModelConfiguration | null>(null);
  const [hasValidationError, setHasValidationError] = useState(false);
  const values = draft ?? saved;
  const replaceDraft = (next: ModelConfiguration | null) => {
    setDraft(next);
    setHasValidationError(false);
  };
  const changeModel = (key: keyof ModelConfiguration, value: string | null) => {
    const update = createModelConfigurationDraftUpdate(
      key,
      value,
      modelConfigurationSchema
    );
    setHasValidationError(update === null);
    if (update) setDraft((current) => update(current ?? saved));
  };
  const readForm = (form: HTMLFormElement) => {
    const result = modelConfigurationSchema.safeParse(
      Object.fromEntries(new FormData(form))
    );
    setHasValidationError(!result.success);
    return result.success ? result.data : null;
  };
  return {
    values,
    hasValidationError,
    hasUnsavedChanges: !configurationsMatch(values, saved),
    canRestoreDefaults: !configurationsMatch(
      values,
      DEFAULT_MODEL_CONFIGURATION
    ),
    replaceDraft,
    changeModel,
    readForm,
  };
}

function useConfigurationSave(onSaved: () => void) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: MODEL_CONFIGURATION_QUERY_KEY,
    mutationFn: (configuration: ModelConfiguration) =>
      saveModelConfigurationFn({ data: configuration }),
    onSuccess: (configuration) => {
      queryClient.setQueryData(ADMIN_CONFIGURATION_QUERY_KEY, configuration);
      queryClient.setQueryData(MODEL_CONFIGURATION_QUERY_KEY, configuration);
      void queryClient.invalidateQueries({
        queryKey: MODEL_CONFIGURATION_QUERY_KEY,
      });
      onSaved();
      toast.success(t('Model configuration saved'));
    },
  });
}

export function useAdminModelConfiguration() {
  const { data: saved } = useSuspenseQuery({
    queryKey: ADMIN_CONFIGURATION_QUERY_KEY,
    queryFn: () => getAdminModelConfigurationFn(),
    refetchOnWindowFocus: false,
  });
  const { data: textModels } = useSuspenseQuery(textModelCatalogQueryOptions);
  const catalog = mergeTextModelCatalog(textModels);
  const editor = useConfigurationDraft(saved, catalog);
  const mutation = useConfigurationSave(() => editor.replaceDraft(null));
  const replaceDraft = (configuration: ModelConfiguration | null) => {
    mutation.reset();
    editor.replaceDraft(configuration);
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const configuration = editor.readForm(event.currentTarget);
    if (configuration) mutation.mutate(configuration);
  };
  return {
    values: editor.values,
    catalog,
    hasUnsavedChanges: editor.hasUnsavedChanges,
    hasValidationError: editor.hasValidationError,
    canRestoreDefaults: editor.canRestoreDefaults,
    isSaving: mutation.isPending,
    saveError: mutation.error,
    onSubmit,
    onModelChange: (key: keyof ModelConfiguration, value: string | null) => {
      mutation.reset();
      editor.changeModel(key, value);
    },
    restoreDefaults: () => replaceDraft({ ...DEFAULT_MODEL_CONFIGURATION }),
    discardChanges: () => replaceDraft(null),
  };
}
