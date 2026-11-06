import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { generateId } from '@/platform/id';
import { AuthCacheGeneration } from '@/platform/ui/auth/auth-cache-generation';
import {
  saveImageChannelFn,
  saveChannelImageModelFn,
  syncImageChannelModelsFn,
} from '@/models/image-channels.fn';
import {
  adminImageChannelsQueryOptions,
  imageModelCatalogQueryOptions,
} from '@/models/image-channels.queries';
import type {
  ChannelImageModel,
  ImageChannelsConfiguration,
  ImageChannel,
  SaveImageChannelInput,
  SaveChannelImageModelInput,
} from '@/models/image-channels';
import {
  createImageChannelDraft,
  createImageModelDraft,
  imageFormIssues,
  readImageChannelForm,
  readImageModelForm,
} from './admin-image-channels-state';
import type { ImageFormIssue } from './admin-image-channels-state';

type Saved = (configuration: ImageChannelsConfiguration) => void;
type EditorDraft<T> = {
  value: T;
  revision: number;
  formKey: string;
  isNew: boolean;
};

function useImageEditorFocus(formKey?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (formKey) ref.current?.focus();
  }, [formKey]);
  return ref;
}

function useImageEditor<T, I>(
  saved: ImageChannelsConfiguration,
  parse: (data: FormData, revision: number) => z.ZodSafeParseResult<I>,
  save: (input: I) => Promise<ImageChannelsConfiguration>,
  onSaved: Saved,
  message: string
) {
  const [draft, setDraft] = useState<EditorDraft<T> | null>(null);
  const [issues, setIssues] = useState<ImageFormIssue[]>([]);
  const focusRef = useImageEditorFocus(draft?.formKey);
  const mutation = useImageSave(
    save,
    (configuration) => {
      onSaved(configuration);
      setDraft(null);
      setIssues([]);
    },
    message
  );
  const open = (value: T, isNew: boolean) => {
    mutation.reset();
    setIssues([]);
    setDraft({ value, revision: saved.revision, formKey: generateId(), isNew });
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || mutation.isPending || draft.revision !== saved.revision)
      return;
    const result = parse(new FormData(event.currentTarget), draft.revision);
    if (result.success) {
      setIssues([]);
      mutation.mutate(result.data);
    } else setIssues(imageFormIssues(result.error));
  };
  return {
    draft,
    issues,
    focusRef,
    open,
    onSubmit,
    error: mutation.error,
    saving: mutation.isPending,
    stale: !!draft && draft.revision !== saved.revision,
    ...imageEditorActions(setDraft, setIssues, mutation.reset),
  };
}

function imageEditorActions<T>(
  setDraft: Dispatch<SetStateAction<EditorDraft<T> | null>>,
  setIssues: (issues: ImageFormIssue[]) => void,
  reset: () => void
) {
  return {
    close: () => {
      reset();
      setDraft(null);
      setIssues([]);
    },
    adoptRevision: (revision: number) => {
      reset();
      setIssues([]);
      setDraft((current) => current && { ...current, revision });
    },
  };
}

function useImageSave<I>(
  save: (input: I) => Promise<ImageChannelsConfiguration>,
  onSaved: Saved,
  message: string
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: save,
    onMutate: () => new AuthCacheGeneration(client),
    onSuccess: (configuration, _input, generation) => {
      if (!generation.isCurrent()) return;
      onSaved(configuration);
      toast.success(message);
    },
  });
}

function useImageCandidateSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      syncImageChannelModelsFn({ data: { channelId } }),
    onMutate: () => new AuthCacheGeneration(client),
  });
}

function useImageConfiguration() {
  const client = useQueryClient();
  const query = useSuspenseQuery({
    ...adminImageChannelsQueryOptions,
    refetchOnWindowFocus: false,
  });
  const update = (configuration: ImageChannelsConfiguration) => {
    client.setQueryData(adminImageChannelsQueryOptions.queryKey, configuration);
    void client.invalidateQueries({
      queryKey: imageModelCatalogQueryOptions.queryKey,
    });
  };
  return { query, update };
}

function useImageChannelEditor(
  saved: ImageChannelsConfiguration,
  onSaved: Saved
) {
  const { t } = useTranslation('imageChannels');
  const editor = useImageEditor<
    ReturnType<typeof createImageChannelDraft>,
    SaveImageChannelInput
  >(
    saved,
    readImageChannelForm,
    (input) => saveImageChannelFn({ data: input }),
    onSaved,
    t('Image channel saved')
  );
  return {
    ...editor,
    openChannel: (channel?: ImageChannel) =>
      editor.open(createImageChannelDraft(channel), !channel),
  };
}

function useImageModelEditor(
  saved: ImageChannelsConfiguration,
  onSaved: Saved
) {
  const { t } = useTranslation('imageChannels');
  const editor = useImageEditor<ChannelImageModel, SaveChannelImageModelInput>(
    saved,
    readImageModelForm,
    (input) => saveChannelImageModelFn({ data: input }),
    onSaved,
    t('Image model saved')
  );
  return {
    ...editor,
    openModel: (model?: ChannelImageModel) =>
      editor.open(
        model ?? createImageModelDraft(saved.channels[0]?.id),
        !model
      ),
  };
}

export function useAdminImageChannels() {
  const { t } = useTranslation('imageChannels');
  const { query, update } = useImageConfiguration();
  const sync = useImageCandidateSync();
  const onSaved: Saved = (configuration) => {
    update(configuration);
    sync.reset();
  };
  const channelEditor = useImageChannelEditor(query.data, onSaved);
  const modelEditor = useImageModelEditor(query.data, onSaved);
  const busy =
    channelEditor.saving ||
    modelEditor.saving ||
    sync.isPending ||
    query.isFetching;
  const reload = async () => {
    if (busy) return;
    const result = await query.refetch();
    if (!result.isSuccess) return;
    channelEditor.adoptRevision(result.data.revision);
    modelEditor.adoptRevision(result.data.revision);
    sync.reset();
    toast.success(
      t('Configuration reloaded. Review your draft before saving.')
    );
  };
  const useCandidate = (upstreamModel: string) => {
    const candidate = sync.data?.candidates.find(
      (item) => item.upstreamModel === upstreamModel
    );
    if (sync.data && candidate)
      modelEditor.open(
        createImageModelDraft(sync.data.channelId, candidate),
        true
      );
  };
  return {
    data: query.data,
    busy,
    channelEditor,
    modelEditor,
    sync,
    useCandidate,
    reload: () => {
      void reload();
    },
    refreshing: query.isFetching,
    loadError: query.error,
  };
}

export type AdminImageChannelsState = ReturnType<typeof useAdminImageChannels>;
export type AdminImageChannelEditor = AdminImageChannelsState['channelEditor'];
