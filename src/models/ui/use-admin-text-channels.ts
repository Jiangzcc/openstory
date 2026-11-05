import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MODEL_CONFIGURATION_QUERY_KEY } from '@/models/model-configuration.queries';
import {
  saveChannelTextModelFn,
  saveTextChannelFn,
  syncTextChannelModelsFn,
} from '@/models/text-channels.fn';
import {
  adminTextChannelsQueryOptions,
  textModelCatalogQueryOptions,
} from '@/models/text-channels.queries';
import type {
  ChannelTextModel,
  SaveChannelTextModelInput,
  SaveTextChannelInput,
  TextChannel,
  TextChannelModelCandidate,
  TextChannelsConfiguration,
} from '@/models/text-channels';
import {
  builtinTextModelOptions,
  changeTextModelChoice,
  createTextChannelDraft,
  createTextModelDraft,
  CUSTOM_TEXT_MODEL_OPTION,
  CUSTOM_TEXT_MODEL_PREFIX,
  requiredBuiltinTextCapabilities,
  textCandidateToDraft,
  textChannelToDraft,
  textModelChoice,
  textModelToDraft,
  validateTextChannelDraft,
  validateTextModelDraft,
} from './admin-text-channels-state';
import type {
  TextChannelDraft,
  TextChannelFieldErrors,
  TextModelDraft,
} from './admin-text-channels-state';

type EditorDraft<T> = {
  values: T;
  revision: number;
  isNew: boolean;
  errors: TextChannelFieldErrors;
};
type ConfigurationSaved = (configuration: TextChannelsConfiguration) => void;
type DraftController<T> = ReturnType<typeof useTextChannelDraft<T>>;
type EditorMutation<T> = ReturnType<typeof useTextChannelSave<T>>;

function useTextEditorFocus(isOpen: boolean) {
  const focusRef = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (isOpen) focusRef.current?.focus();
  }, [isOpen, request]);
  return { focusRef, requestFocus: () => setRequest((current) => current + 1) };
}

function useTextChannelDraft<T>() {
  const [draft, setDraft] = useState<EditorDraft<T> | null>(null);
  const focus = useTextEditorFocus(!!draft);
  const open = (values: T, revision: number, isNew: boolean) => {
    setDraft({ values, revision, isNew, errors: {} });
    focus.requestFocus();
  };
  const change = <K extends keyof T>(key: K, value: T[K]) =>
    setDraft(
      (current) =>
        current && {
          ...current,
          values: { ...current.values, [key]: value },
          errors: {},
        }
    );
  const replace = (values: T) =>
    setDraft((current) => current && { ...current, values, errors: {} });
  const setErrors = (errors: TextChannelFieldErrors) =>
    setDraft((current) => current && { ...current, errors });
  const adoptRevision = (revision: number) =>
    setDraft((current) => current && { ...current, revision, errors: {} });
  return {
    draft,
    focusRef: focus.focusRef,
    open,
    change,
    replace,
    setErrors,
    adoptRevision,
    close: () => setDraft(null),
  };
}

function useTextChannelSave<T>(
  save: (input: T) => Promise<TextChannelsConfiguration>,
  onSaved: ConfigurationSaved,
  close: () => void,
  message: string
) {
  return useMutation({
    mutationFn: save,
    onSuccess: (configuration) => {
      onSaved(configuration);
      close();
      toast.success(message);
    },
  });
}

function draftMutationActions<T, I>(
  editor: DraftController<T>,
  mutation: EditorMutation<I>
) {
  return {
    change: <K extends keyof T>(key: K, value: T[K]) => {
      mutation.reset();
      editor.change(key, value);
    },
    adoptRevision: (revision: number) => {
      mutation.reset();
      editor.adoptRevision(revision);
    },
    close: () => {
      mutation.reset();
      editor.close();
    },
  };
}

function submitChannel(
  event: FormEvent<HTMLFormElement>,
  editor: DraftController<TextChannelDraft>,
  saved: TextChannelsConfiguration | undefined,
  mutation: EditorMutation<SaveTextChannelInput>
) {
  event.preventDefault();
  const draft = editor.draft;
  if (!draft || mutation.isPending || !saved) return;
  if (draft.revision !== saved.revision) return;
  const original = saved.channels.find(
    (channel) => channel.id === draft.values.id
  );
  const result = validateTextChannelDraft(
    draft.values,
    draft.revision,
    original
  );
  if (result.success) mutation.mutate(result.data);
  else editor.setErrors(result.errors);
}

function useChannelEditor(
  saved: TextChannelsConfiguration | undefined,
  onSaved: ConfigurationSaved
) {
  const { t } = useTranslation('admin');
  const editor = useTextChannelDraft<TextChannelDraft>();
  const mutation = useTextChannelSave(
    (input: SaveTextChannelInput) => saveTextChannelFn({ data: input }),
    onSaved,
    editor.close,
    t('Text channel saved')
  );
  const open = (channel?: TextChannel) => {
    if (!saved) return;
    mutation.reset();
    editor.open(
      channel ? textChannelToDraft(channel) : createTextChannelDraft(),
      saved.revision,
      !channel
    );
  };
  return {
    ...editor,
    ...draftMutationActions(editor, mutation),
    open,
    onSubmit: (event: FormEvent<HTMLFormElement>) =>
      submitChannel(event, editor, saved, mutation),
    isSaving: mutation.isPending,
    saveError: mutation.error,
    isStale: !!editor.draft && editor.draft.revision !== saved?.revision,
    original: saved?.channels.find(
      (channel) => channel.id === editor.draft?.values.id
    ),
  };
}

function submitModel(
  event: FormEvent<HTMLFormElement>,
  editor: DraftController<TextModelDraft>,
  saved: TextChannelsConfiguration | undefined,
  mutation: EditorMutation<SaveChannelTextModelInput>
) {
  event.preventDefault();
  const draft = editor.draft;
  if (!draft || mutation.isPending || !saved) return;
  if (draft.revision !== saved.revision) return;
  const result = validateTextModelDraft(
    draft.values,
    draft.revision,
    saved.channels,
    saved.models,
    draft.isNew
  );
  if (result.success) mutation.mutate(result.data);
  else editor.setErrors(result.errors);
}

function modelDraftActions(
  saved: TextChannelsConfiguration | undefined,
  editor: DraftController<TextModelDraft>,
  mutation: EditorMutation<SaveChannelTextModelInput>
) {
  const openDraft = (values: TextModelDraft, isNew: boolean) => {
    if (!saved) return;
    mutation.reset();
    editor.open(values, saved.revision, isNew);
  };
  return {
    open: (model?: ChannelTextModel) =>
      openDraft(
        model ? textModelToDraft(model) : createTextModelDraft(),
        !model
      ),
    openCandidate: (channelId: string, candidate: TextChannelModelCandidate) =>
      openDraft(textCandidateToDraft(channelId, candidate), true),
    changeCustomId: (value: string) => {
      mutation.reset();
      editor.change('id', CUSTOM_TEXT_MODEL_PREFIX + value);
    },
    changeChoice: (choice: string | null) => {
      if (!editor.draft || !choice) return;
      mutation.reset();
      editor.replace(changeTextModelChoice(editor.draft.values, choice));
    },
  };
}

function textModelEditorView(
  saved: TextChannelsConfiguration | undefined,
  editor: DraftController<TextModelDraft>,
  customLabel: string
) {
  const values = editor.draft?.values ?? createTextModelDraft();
  return {
    options: [
      { value: CUSTOM_TEXT_MODEL_OPTION, label: customLabel },
      ...builtinTextModelOptions(saved?.models ?? [], values.id),
    ],
    choice: textModelChoice(values),
    isCustom: values.id.startsWith(CUSTOM_TEXT_MODEL_PREFIX),
    requiredCapabilities: requiredBuiltinTextCapabilities(values.id),
    customId: values.id.slice(CUSTOM_TEXT_MODEL_PREFIX.length),
  };
}

function useModelEditor(
  saved: TextChannelsConfiguration | undefined,
  onSaved: ConfigurationSaved
) {
  const { t } = useTranslation('admin');
  const editor = useTextChannelDraft<TextModelDraft>();
  const mutation = useTextChannelSave(
    (input: SaveChannelTextModelInput) =>
      saveChannelTextModelFn({ data: input }),
    onSaved,
    editor.close,
    t('Model binding saved')
  );
  return {
    ...editor,
    ...draftMutationActions(editor, mutation),
    ...modelDraftActions(saved, editor, mutation),
    ...textModelEditorView(saved, editor, t('Create a custom model')),
    onSubmit: (event: FormEvent<HTMLFormElement>) =>
      submitModel(event, editor, saved, mutation),
    isSaving: mutation.isPending,
    saveError: mutation.error,
    isStale: !!editor.draft && editor.draft.revision !== saved?.revision,
  };
}

function useTextModelSync() {
  const [selected, setSelected] = useState('');
  const mutation = useMutation({
    mutationFn: (channelId: string) =>
      syncTextChannelModelsFn({ data: { channelId } }),
  });
  const start = (channelId: string) => {
    if (mutation.isPending) return;
    setSelected('');
    mutation.mutate(channelId);
  };
  return {
    result: mutation.data,
    error: mutation.error,
    isPending: mutation.isPending,
    channelId: mutation.variables,
    selected,
    select: (value: string | null) => setSelected(value ?? ''),
    options:
      mutation.data?.candidates.map((candidate) => ({
        value: candidate.upstreamModel,
        label: candidate.name + ' · ' + candidate.upstreamModel,
      })) ?? [],
    candidate: mutation.data?.candidates.find(
      (candidate) => candidate.upstreamModel === selected
    ),
    start,
    reset: mutation.reset,
  };
}

function useTextChannelConfiguration() {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...adminTextChannelsQueryOptions,
    throwOnError: false,
    refetchOnWindowFocus: false,
  });
  const update = (configuration: TextChannelsConfiguration) => {
    queryClient.setQueryData(
      adminTextChannelsQueryOptions.queryKey,
      configuration
    );
    void queryClient.invalidateQueries({
      queryKey: textModelCatalogQueryOptions.queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: MODEL_CONFIGURATION_QUERY_KEY,
    });
  };
  return { query, update };
}

function configurationView(data: TextChannelsConfiguration | undefined) {
  return {
    channelOptions:
      data?.channels.map((channel) => ({
        value: channel.id,
        label: channel.name,
      })) ?? [],
    bindings:
      data?.models.map((model) => ({
        model,
        channelName:
          data.channels.find((channel) => channel.id === model.channelId)
            ?.name ?? model.channelId,
      })) ?? [],
  };
}

export function useAdminTextChannels() {
  const { t } = useTranslation('admin');
  const { query, update } = useTextChannelConfiguration();
  const sync = useTextModelSync();
  const onSaved = (configuration: TextChannelsConfiguration) => {
    update(configuration);
    sync.reset();
  };
  const channelEditor = useChannelEditor(query.data, onSaved);
  const modelEditor = useModelEditor(query.data, onSaved);
  const isSaving = channelEditor.isSaving || modelEditor.isSaving;
  const refresh = async () => {
    if (isSaving || sync.isPending) return;
    const result = await query.refetch();
    if (!result.isSuccess) return;
    channelEditor.adoptRevision(result.data.revision);
    modelEditor.adoptRevision(result.data.revision);
    sync.reset();
    toast.success(
      t('Configuration reloaded. Review your draft before saving.')
    );
  };
  return {
    ...configurationView(query.data),
    data: query.data,
    loadError: query.error,
    isLoading: query.isPending,
    isRefreshing: query.isFetching,
    isSaving,
    isBusy: isSaving || sync.isPending || query.isFetching,
    channelEditor,
    modelEditor,
    sync,
    refresh: () => {
      void refresh();
    },
    useCandidate: () => {
      if (sync.result && sync.candidate)
        modelEditor.openCandidate(sync.result.channelId, sync.candidate);
    },
  };
}

export type AdminTextChannelsState = ReturnType<typeof useAdminTextChannels>;
export type AdminTextChannelEditor = AdminTextChannelsState['channelEditor'];
export type AdminTextModelEditor = AdminTextChannelsState['modelEditor'];
