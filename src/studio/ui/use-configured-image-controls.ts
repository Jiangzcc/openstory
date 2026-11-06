import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useImageModelCatalog } from '@/models/ui/use-image-model-catalog';
import { useAuthGate } from '@/platform/ui/auth/auth-gate-provider';
import { AuthCacheGeneration } from '@/platform/ui/auth/auth-cache-generation';
import { studioUploadKeys, useUploadStudioMedia } from './use-studio-assets';
import {
  evaluateStudioImageSettings,
  isPngMaskFile,
} from './configured-image-settings';
import type {
  StudioImageControlIssue,
  StudioImageSettingsInput,
  StoredStudioImageSettings,
} from './configured-image-settings';
type StudioImageControlsRestore = StoredStudioImageSettings & {
  modelId: string;
  referenceCount: number;
};

type StudioImageControlsInput = Omit<
  StudioImageSettingsInput,
  'catalog' | 'maskImageUrl'
>;

function useMaskDraft(modelId: string) {
  const [masks, setMasks] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<
    Record<string, StudioImageControlIssue | null>
  >({});
  const setIssue = useCallback(
    (issue: StudioImageControlIssue | null) => {
      setIssues((current) => ({ ...current, [modelId]: issue }));
    },
    [modelId]
  );
  const revision = useRef(0);
  const setMaskImageUrl = useCallback(
    (value: string) => {
      revision.current += 1;
      setIssue(null);
      setMasks((current) => ({ ...current, [modelId]: value }));
    },
    [modelId, setIssue]
  );
  const reset = useCallback(() => {
    revision.current += 1;
    setMasks({});
    setIssues({});
  }, []);
  const restore = useCallback((saved: StudioImageControlsRestore) => {
    revision.current += 1;
    setMasks({ [saved.modelId]: saved.maskImageUrl ?? '' });
    setIssues(
      saved.imageSettingsIssue
        ? { [saved.modelId]: saved.imageSettingsIssue }
        : {}
    );
  }, []);
  const beginUpload = () => ++revision.current;
  const isCurrentUpload = (value: number) => value === revision.current;
  return {
    maskImageUrl: masks[modelId] ?? '',
    masks: setMasks,
    issue: issues[modelId] ?? null,
    setIssue,
    beginUpload,
    isCurrentUpload,
    setMaskImageUrl,
    reset,
    restore,
  };
}

function useImageMaskUpload(
  modelId: string,
  mask: ReturnType<typeof useMaskDraft>
) {
  const upload = useUploadStudioMedia();
  const queryClient = useQueryClient();
  const { requireAuth } = useAuthGate();
  const uploadMask = async (file: File) => {
    const generation = new AuthCacheGeneration(queryClient);
    const revision = mask.beginUpload();
    mask.setIssue(null);
    try {
      const { url } = await upload.mutateAsync({ file });
      if (!generation.isCurrent()) return;
      if (mask.isCurrentUpload(revision))
        mask.masks((current) => ({ ...current, [modelId]: url }));
      void queryClient.invalidateQueries({ queryKey: studioUploadKeys.all });
    } catch {
      if (!generation.isCurrent()) return;
      if (mask.isCurrentUpload(revision))
        mask.setIssue({ key: 'Could not upload the mask. Try again.' });
    }
  };
  const chooseMaskFile = (file: File) => {
    if (!isPngMaskFile(file)) {
      mask.setIssue({ key: 'Choose a PNG file for the mask.' });
      return;
    }
    requireAuth(() => {
      void uploadMask(file);
    });
  };
  return { chooseMaskFile, uploading: upload.isPending };
}

export function useConfiguredImageControls(input: StudioImageControlsInput) {
  const { models } = useImageModelCatalog();
  const mask = useMaskDraft(input.modelId);
  const upload = useImageMaskUpload(input.modelId, mask);
  const settings = evaluateStudioImageSettings({
    ...input,
    catalog: models,
    maskImageUrl: mask.maskImageUrl,
  });
  return {
    ...settings,
    issue: mask.issue ?? settings.issue,
    maskInput: mask.maskImageUrl,
    setMaskImageUrl: mask.setMaskImageUrl,
    chooseMaskFile: upload.chooseMaskFile,
    uploadingMask: upload.uploading,
    clearMask: mask.reset,
    reset: mask.reset,
    restore: mask.restore,
  };
}

export type ConfiguredImageControls = ReturnType<
  typeof useConfiguredImageControls
>;
