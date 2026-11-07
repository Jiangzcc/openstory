import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
/**
 * Studio prompt bar (#1274). One card: reference tiles on the left, the
 * @-mention editor in the middle, a settings strip along the bottom.
 *
 * Video modes:
 *   - Text      — prompt only
 *   - Reference — stills attached as `@Image1`…`@ImageN`; typing `@` lists
 *                 what's attached plus the organization library (picking a library
 *                 still attaches it)
 *   - Frames    — a start frame, plus an end frame where the model takes one
 */

import { elementKindFromFile, readMediaDuration } from '@/cast/element-kind';
import { normalizeElementFile } from '@/cast/ui/element/normalize-element-file';
import { isSeedanceEdit } from '@/motion/seedance-edit';
import { unusableShotReferenceLines } from '@/motion/reference-support';
import { localizeReferenceProblem } from '@/motion/ui/localize-reference-problem';
import { useAuthGate } from '@/platform/ui/auth/auth-gate-provider';
import { ActionCost } from '@/billing/ui/action-cost';
import { AspectRatioIcon } from '@/ui/icons/aspect-ratio-icon';
import { ImageModelSelector } from '@/models/ui/pickers/image-model-selector';
import { MotionModelSelector } from '@/models/ui/pickers/motion-model-selector';
import type { MentionItem } from '@/shots/ui/prompt-mention/mention-items';
import { AspectRatioPills } from '@/ui/settings/aspect-ratio-pills';
import { ResolutionPills } from '@/ui/settings/resolution-pills';
import { videoPromptHardLimit } from '@/models/models';
import { getImagePromptRecommendation } from '@/models/image-model-catalog';
import { measurePrompt } from '@/models/prompt-length';
import type { PromptRecommendation } from '@/models/prompt-length';
import { useConfiguredImageControls } from './use-configured-image-controls';
import { isStudioImageCount } from './configured-image-draft';
import {
  ConfiguredImageControls,
  ConfiguredImageEstimate,
  ConfiguredImageStatus,
} from './configured-image-controls';
import { imageResolutionTiers } from '@/stills/build-image-request';
import { motionResolutionTiers } from '@/motion/model-capabilities';
import {
  clampResolution,
  DEFAULT_RESOLUTION,
  RESOLUTION_OPTIONS,
  type Resolution,
} from '@/models/resolutions';
import {
  StudioReferencePicker,
  useStudioLibrary,
  type StudioReference,
} from './studio-reference-picker';
import { MarkdownEditor } from '@/ui/text-editor/markdown-editor';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/shadcn/alert-dialog';
import { AppImage } from '@/ui/shadcn/app-image';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Switch } from '@/ui/shadcn/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { useFalPricing } from '@/billing/ui/use-fal-pricing';
import {
  useCreateStudioAssets,
  useDraftStudioPrompt,
  useStudioPendingCreates,
  studioUploadKeys,
  useUploadStudioMedia,
} from './use-studio-assets';
import { useQueryClient } from '@tanstack/react-query';
import { PortraitAttestationFields } from '@/cast/ui/portrait-attestation-fields';
import { PORTRAIT_RIGHTS_V1 } from '@/platform/compliance/attestations';
import type { PortraitAttestation } from '@/cast/upload-rights';
import {
  useAttestUploads,
  useRetryUploadCheck,
  useUploadRights,
} from '@/cast/ui/use-upload-rights';
import { openAddCreditsDialog } from '@/billing/ui/use-add-credits-dialog';
import { isInsufficientCreditsError } from '@/platform/errors';
import { studioGatedMedia } from '@/studio/reference-rights';
import {
  getCompatibleModel,
  IMAGE_TO_VIDEO_MODELS,
  supportsDraftMode,
  type ImageToVideoModel,
  type TextToImageModel,
} from '@/models/models';
import { DRAFT_RESOLUTION } from '@/motion/draft-mode';
import { useModelDefaults } from '@/models/ui/use-model-defaults';
import { useViaAvailability } from '@/models/ui/use-via-availability';
import {
  estimateImageCost,
  estimateStudioVideoCost,
} from '@/billing/cost-estimation';
import { multiplyMicros } from '@/billing/money';
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from '@/models/aspect-ratios';
import { VoiceInputButton } from '@/ui/voice/voice-input-button';
import { AskAssistantButton } from '@/assistant/ui/ask-assistant-button';
import { AssistantContextItem } from '@/assistant/ui/assistant-context-item';
import { useEditorDictation } from '@/ui/use-dictation';
import { pickShufflePrompt, studioShufflePrompts } from './prompt-shuffle';
import { parseStudioPaste } from './paste-import';
import type { StudioReuse } from './prompt-display';
import {
  loadStudioComposerPrefs,
  resolveStudioComposerModels,
  saveStudioComposerPrefs,
} from './composer-prefs';
import type { StudioCreateInput, StudioReferenceKind } from '@/studio/schema';
import {
  dropStudioAlias,
  renumberStudioReferences,
  unresolvedStudioReferences,
  resolveStudioAliases,
  snapStudioVideoDuration,
  studioBillableSeconds,
  studioSupportsAutoDuration,
  type StudioDuration,
  studioAudioLimit,
  studioCombinedRefCap,
  studioReferenceEndpoint,
  studioReferenceLimit,
  studioSupportsEndFrame,
  studioVideoRefLimit,
  studioSupportsMode,
  studioVideoDurations,
  studioVideoSupportsAudio,
  type StudioReferenceToken,
  type StudioVideoMode,
} from '@/studio/text-to-video';
import {
  dataTransferHasImages,
  extractImagesFromSnapshot,
  snapshotDataTransfer,
  toastDragImportCorsError,
} from '@/ui/drag-images';
import { cn } from '@/ui/utils';
import { usePostHog } from '@posthog/react';
import {
  ArrowUp,
  AudioLines,
  Film,
  ImagePlus,
  Loader2,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

const COUNTS = [1, 2, 4] as const;

const MODE_LABELS: Record<StudioVideoMode, string> = {
  text: 'Text to video',
  reference: 'Reference to video',
  frames: 'Image to video',
  edit: 'Edit video',
};

type PickerTarget = 'reference' | 'start' | 'end';

const REFERENCE_TOKENS = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
} as const satisfies Record<StudioReferenceKind, StudioReferenceToken>;

export type StudioComposerHandle = {
  /** Load a generation's prompt, references, and settings into the bar. */
  load: (reuse: StudioReuse) => void;
};

type StudioComposerProps = {
  activity: 'image' | 'video';
  /** Prompts of generations still in flight — the editor pulses while it shows one. */
  generatingPrompts: string[];
  ref?: React.Ref<StudioComposerHandle>;
};

function referenceMentionItem(
  reference: StudioReference,
  index: number,
  kind: StudioReferenceToken = 'Image'
): MentionItem {
  const slot = `${kind}${index + 1}`;
  // A named reference (character, location, element) keeps its name in the
  // prompt (#1748); everything else is spelled by its slot.
  const tag = reference.alias ?? slot;
  return {
    id: `ref:${kind}:${index}`,
    section: 'references',
    label: reference.label,
    sublabel: `@${slot}`,
    tag,
    haystack: `${slot} ${reference.label}`.toLowerCase(),
    thumbnailUrl:
      kind === 'Image'
        ? reference.url
        : kind === 'Video'
          ? reference.posterUrl
          : undefined,
  };
}

function Tile({
  reference,
  badge,
  onRemove,
  removeLabel,
  checking = false,
  realPerson,
}: {
  reference: StudioReference;
  badge: string;
  onRemove: () => void;
  removeLabel?: string;
  /** Rights check in flight (#1581): the still is being looked at. */
  checking?: boolean;
  /** A cleared still the user can mark as a real person (#1847). */
  realPerson?: { marked: boolean; onToggle: () => void };
}) {
  const { t } = useTranslation('studio');

  return (
    <div
      className={cn(
        'group relative size-20 shrink-0 overflow-hidden rounded-lg border bg-muted',
        reference.kind === 'audio' &&
          'flex flex-col items-center justify-center gap-1 px-1'
      )}
    >
      {reference.kind === 'audio' ? (
        <>
          <AudioLines
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            className="w-full truncate text-center text-[10px]"
            title={reference.label}
          >
            {reference.label}
          </span>
        </>
      ) : reference.kind === 'video' ? (
        <video
          src={reference.url}
          poster={reference.posterUrl}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        >
          <track kind="captions" />
        </video>
      ) : (
        <AppImage
          src={reference.url}
          alt={reference.label}
          width={160}
          height={160}
          className="h-full w-full object-cover"
        />
      )}
      {checking && (
        <span
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/75 text-[10px] font-medium"
          aria-live="polite"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          {t('Checking…')}
        </span>
      )}
      <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-background/85 px-1 font-mono text-[10px] leading-4">
        {reference.kind === 'video' && (
          <Film className="size-3" aria-hidden="true" />
        )}
        {badge}
      </span>
      {realPerson && (
        <Button
          type="button"
          size="icon-xs"
          variant={realPerson.marked ? 'default' : 'secondary'}
          className={cn(
            'absolute top-1 left-1 transition-opacity',
            !realPerson.marked &&
              'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          )}
          aria-label={t('{{value1}} shows a real person', { value1: badge })}
          title={t('This shows a real person')}
          aria-pressed={realPerson.marked}
          onClick={realPerson.onToggle}
        >
          <UserRound aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        size="icon-xs"
        variant="secondary"
        className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={
          removeLabel ?? t('Remove {{label}}', { label: reference.label })
        }
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

function AddTile({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hint ? `${label} (${hint})` : label}
      className="flex size-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ImagePlus className="size-4" aria-hidden="true" />
      {label}
      {hint && <span className="text-[10px] opacity-70">{hint}</span>}
    </button>
  );
}

export function StudioComposer({
  activity,
  generatingPrompts,
  ref,
}: StudioComposerProps) {
  const translateEvent = useLiveTranslation('studio');

  const { i18n, t } = useTranslation('studio');
  const { t: tImageChannels } = useTranslation('imageChannels');
  const composerFormId = useId();
  const translateLabel = useLabelTranslation('studio');

  const { requireAuth, isAuthenticated } = useAuthGate();
  const posthog = usePostHog();
  const { pricing, isPending: pricingPending } = useFalPricing();
  const create = useCreateStudioAssets();
  const draft = useDraftStudioPrompt();
  const pendingCreates = useStudioPendingCreates(activity);
  const upload = useUploadStudioMedia();
  const attest = useAttestUploads();
  const retryCheck = useRetryUploadCheck();
  const queryClient = useQueryClient();
  const library = useStudioLibrary();
  const vias = useViaAvailability();
  const { configuration, isReady: modelDefaultsReady } = useModelDefaults();

  const [prompt, setPrompt] = useState('');
  const [imageModelOverride, setImageModel] = useState<TextToImageModel>();
  const [videoModelOverride, setVideoModel] = useState<ImageToVideoModel>();
  const [aspectRatio, setAspectRatio] =
    useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [pickedResolution, setResolution] =
    useState<Resolution>(DEFAULT_RESOLUTION);
  const [count, setCount] = useState(1);
  const [duration, setDuration] = useState<StudioDuration>(5);
  const [generateAudio, setGenerateAudio] = useState(true);
  // On by default (#1756): a 480p look before the 1080p spend. The user's
  // last choice wins once their saved settings load.
  const [draftMode, setDraftMode] = useState(true);
  // Saved settings load after mount (the server has no localStorage), and
  // nothing is saved until they have, so the defaults never overwrite them.
  const [loadedActivity, setLoadedActivity] = useState<typeof activity | null>(
    null
  );
  const prefsLoaded = loadedActivity === activity;
  const { imageModel, videoModel } = resolveStudioComposerModels(
    { imageModel: imageModelOverride, videoModel: videoModelOverride },
    configuration,
    aspectRatio,
    vias
  );
  const [lastShuffled, setLastShuffled] = useState<string | null>(null);
  // The mic sits in the toolbar next to Shuffle; dictation streams into the
  // prompt editor through this handle.
  const { ref: promptEditorRef, voice: promptVoice } = useEditorDictation();
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const [emptyPrompt, setEmptyPrompt] = useState(false);
  const [promptTooLongOpen, setPromptTooLongOpen] = useState(false);

  // Reference is the default: it is what the tiles, @ list and picker are for.
  const [mode, setMode] = useState<StudioVideoMode>('reference');
  const [references, setReferences] = useState<StudioReference[]>([]);
  const [videoRefs, setVideoRefs] = useState<StudioReference[]>([]);
  const [audioRefs, setAudioRefs] = useState<StudioReference[]>([]);
  const [startFrame, setStartFrame] = useState<StudioReference | null>(null);
  const [endFrame, setEndFrame] = useState<StudioReference | null>(null);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  // Rights sign-off (#1581). Each tick remembers the set of tiles it was
  // given for, so attaching another unattested still un-ticks it.
  const [portraitTickedFor, setPortraitTickedFor] = useState('');
  const [authorizationBasis, setAuthorizationBasis] = useState('');
  // Cleared stills the user says show a real person (#1847). Only ever adds
  // a sign-off; the server still decides what counts as cleared.
  const [markedReal, setMarkedReal] = useState<string[]>([]);
  const [pendingSeed, setPendingSeed] = useState<StudioReuse | null>(null);
  const imageControls = useConfiguredImageControls({
    modelId: imageModel,
    aspectRatio,
    resolution: pickedResolution,
    referenceCount: references.length,
    totalImageCount: count,
  });
  const resetImageControls = imageControls.reset;
  const restoreImageControls = imageControls.restore;

  const applySeed = useCallback(
    (next: StudioReuse) => {
      const tile = (
        url: string,
        label: string,
        kind: StudioReference['kind'],
        assetId?: string
      ): StudioReference => ({
        url,
        label,
        kind,
        ...(assetId ? { assetId } : {}),
      });
      if (activity === 'image' && next.imageModel) {
        restoreImageControls({
          ...next,
          modelId: next.imageModel,
          referenceCount: next.referenceImages.length,
        });
      } else resetImageControls();
      setPrompt(next.prompt);
      setLastShuffled(next.prompt);
      setAspectRatio(next.aspectRatio);
      if (next.resolution) setResolution(next.resolution);
      if (activity === 'image') setCount(next.totalImageCount ?? 1);
      if (activity === 'image' && next.imageModel)
        setImageModel(next.imageModel);
      if (activity === 'video') {
        if (next.videoModel) setVideoModel(next.videoModel);
        if (next.duration != null) setDuration(next.duration);
        if (next.generateAudio != null) setGenerateAudio(next.generateAudio);
        if (next.draft != null) setDraftMode(next.draft);
        if (next.mode) setMode(next.mode);
        setVideoRefs(
          next.referenceVideos.map((clip, index) =>
            tile(clip.url, `Video ${index + 1}`, 'video', clip.assetId)
          )
        );
        setAudioRefs(
          next.referenceAudio.map((url, index) =>
            tile(url, `Audio ${index + 1}`, 'audio')
          )
        );
        setStartFrame(
          next.startImageUrl
            ? tile(next.startImageUrl, 'Start frame', 'image')
            : null
        );
        setEndFrame(
          next.endImageUrl ? tile(next.endImageUrl, 'End frame', 'image') : null
        );
      } else {
        setVideoRefs([]);
        setAudioRefs([]);
        setStartFrame(null);
        setEndFrame(null);
      }
      setReferences(
        next.referenceImages.map((url, index) =>
          tile(url, `Image ${index + 1}`, 'image')
        )
      );
      toast.success(translateEvent('Loaded into the prompt bar'));
    },
    [translateEvent, activity, resetImageControls, restoreImageControls]
  );

  useEffect(() => {
    const saved = loadStudioComposerPrefs(activity);
    if (saved.aspectRatio) setAspectRatio(saved.aspectRatio);
    if (saved.resolution) setResolution(saved.resolution);
    if (saved.count) setCount(saved.count);
    setImageModel(activity === 'image' ? saved.imageModel : undefined);
    setVideoModel(activity === 'video' ? saved.videoModel : undefined);
    if (activity === 'video') {
      if (saved.duration != null) setDuration(saved.duration);
      if (saved.generateAudio != null) setGenerateAudio(saved.generateAudio);
      if (saved.draft != null) setDraftMode(saved.draft);
    }
    setLoadedActivity(activity);
    // Once per composer: later via changes must not undo the user's pick.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  useEffect(() => {
    if (!prefsLoaded) return;
    saveStudioComposerPrefs(
      activity,
      activity === 'image'
        ? {
            imageModel: imageModelOverride,
            aspectRatio,
            resolution: pickedResolution,
            count: isStudioImageCount(count) ? count : undefined,
          }
        : {
            videoModel: videoModelOverride,
            aspectRatio,
            resolution: pickedResolution,
            count: isStudioImageCount(count) ? count : undefined,
            duration,
            generateAudio,
            draft: draftMode,
          }
    );
  }, [
    prefsLoaded,
    activity,
    imageModelOverride,
    videoModelOverride,
    aspectRatio,
    pickedResolution,
    count,
    duration,
    generateAudio,
    draftMode,
  ]);

  const composerDirty =
    prompt.trim().length > 0 ||
    (activity === 'image' && imageControls.maskInput.length > 0) ||
    references.length > 0 ||
    videoRefs.length > 0 ||
    audioRefs.length > 0 ||
    startFrame !== null ||
    endFrame !== null;

  useImperativeHandle(
    ref,
    () => ({
      load(next) {
        if (composerDirty) {
          setPendingSeed(next);
          return;
        }
        applySeed(next);
      },
    }),
    [applySeed, composerDirty]
  );

  const isVideo = activity === 'video';
  const compatibleVideoModel = getCompatibleModel(videoModel, aspectRatio);
  useEffect(() => {
    if (!modelDefaultsReady || !prefsLoaded) return;
    if (activity === 'image') return;
    if (!studioSupportsMode(compatibleVideoModel, mode)) setMode('text');
    if (!studioSupportsEndFrame(compatibleVideoModel)) setEndFrame(null);
    if (studioAudioLimit(compatibleVideoModel) === 0) setAudioRefs([]);
    if (studioVideoRefLimit(compatibleVideoModel) === 0) setVideoRefs([]);
  }, [activity, compatibleVideoModel, mode, modelDefaultsReady, prefsLoaded]);
  // Only the tiers this model serves get a pill, so the stored pick is clamped
  // to them rather than left pointing at a pill that is no longer there.
  const activeModelName = isVideo
    ? IMAGE_TO_VIDEO_MODELS[compatibleVideoModel].name
    : (imageControls.model?.name ?? imageModel);
  // The prompt is never cut (#1754), so the composer says how long it is and
  // turns the count amber past what the model recommends. Every model,
  // Seedance included, counts characters (#1763).
  const promptRecommendation: PromptRecommendation = isVideo
    ? IMAGE_TO_VIDEO_MODELS[compatibleVideoModel]
    : getImagePromptRecommendation(imageControls.model);
  const promptMeasured = measurePrompt(prompt, promptRecommendation);
  // No number (native Grok images) means nothing to be over.
  const promptOverRecommended =
    promptRecommendation.maxPromptLength !== undefined &&
    promptMeasured > promptRecommendation.maxPromptLength;
  // Where the via enforces a ceiling, studio REFUSES rather than shortens.
  // Sequences can shorten because the rewrite lands as a prompt version the
  // user can read and revert; studio has no version history, so the same
  // rewrite would be an invisible edit — exactly what #1754 removed. The red
  // counter stands, and `submit` toasts the numbers on the click.
  const promptHardLimit = isVideo
    ? videoPromptHardLimit(compatibleVideoModel)
    : undefined;
  const promptTooLong =
    promptHardLimit !== undefined && prompt.length > promptHardLimit;
  const resolutionTiers = isVideo
    ? motionResolutionTiers(compatibleVideoModel)
    : imageControls.model?.source === 'builtin'
      ? imageResolutionTiers(imageControls.model.id, aspectRatio)
      : imageControls.outputOptions.resolutions;
  const resolution =
    !isVideo && imageControls.isConfigured
      ? imageControls.resolution
      : clampResolution(pickedResolution, resolutionTiers);
  const fixedImageOutput =
    !isVideo && imageControls.isConfigured && resolutionTiers.length < 2;
  const resolutionNote =
    !isVideo &&
    imageControls.isConfigured &&
    imageControls.outputOptions.automatic
      ? tImageChannels('Automatic size')
      : resolutionTiers.length === 0 || fixedImageOutput
        ? [
            t('{{value1}} renders at a fixed size', {
              value1: activeModelName,
            }),
            fixedImageOutput ? imageControls.outputOptions.fixedSize : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null;
  const snappedDuration = snapStudioVideoDuration(
    duration,
    compatibleVideoModel
  );
  const audioCapable = studioVideoSupportsAudio(compatibleVideoModel);
  const durationCapable = studioVideoDurations(compatibleVideoModel).length > 0;
  // Ark draft mode (#1756): a 480p preview, rendered at 1080p from the
  // gallery once approved. Only Seedance 2.5 on the BytePlus via has it.
  const draftCapable = isVideo && supportsDraftMode(compatibleVideoModel);
  const draftOn = draftCapable && draftMode;
  const imageRefLimit = imageControls.referenceLimit;
  const referenceLimit = isVideo
    ? studioReferenceLimit(compatibleVideoModel)
    : imageRefLimit;
  const videoRefLimit = isVideo ? studioVideoRefLimit(compatibleVideoModel) : 0;
  const audioLimit = isVideo ? studioAudioLimit(compatibleVideoModel) : 0;
  const combinedRefCap = isVideo
    ? studioCombinedRefCap(compatibleVideoModel)
    : null;
  /** Whether this composer can attach anything at all. */
  const refsCapable = isVideo || imageRefLimit > 0;
  const endFrameCapable = studioSupportsEndFrame(compatibleVideoModel);
  // Reference mode with nothing attached submits as text, so the default
  // mode never dead-ends a plain prompt.
  const effectiveMode: StudioVideoMode = !isVideo
    ? 'text'
    : mode === 'reference' && references.length + videoRefs.length === 0
      ? 'text'
      : mode;
  // Length follows the clip, so the picker shows Auto and the estimate
  // prices the model's longest clip (#2036).
  const followsReferenceVideo = isSeedanceEdit({
    model: compatibleVideoModel,
    onArk: vias.byteplus === true,
    prompt,
    hasInputVideo:
      effectiveMode === 'edit' ||
      (effectiveMode === 'reference' && videoRefs.length > 0),
    explicitEdit: effectiveMode === 'edit',
  });
  const pricedDuration: StudioDuration = followsReferenceVideo
    ? 'auto'
    : snappedDuration;

  const estimate = useMemo(() => {
    if (activity === 'image' && imageControls.isConfigured)
      return imageControls.estimate;
    if (!pricing) return pricingPending ? undefined : null;
    if (activity === 'image') {
      const still = estimateImageCost(imageModel, aspectRatio, 1, {
        pricing,
        resolution,
        edit: references.length > 0,
      });
      return still === null ? null : multiplyMicros(still, count);
    }
    const motion = estimateStudioVideoCost(
      compatibleVideoModel,
      studioBillableSeconds(pricedDuration, compatibleVideoModel),
      {
        pricing,
        mode: effectiveMode,
        resolution: draftOn ? DRAFT_RESOLUTION : resolution,
      }
    );
    return motion === null ? null : multiplyMicros(motion, count);
  }, [
    activity,
    aspectRatio,
    compatibleVideoModel,
    count,
    draftOn,
    effectiveMode,
    imageModel,
    imageControls.isConfigured,
    imageControls.estimate,
    pricing,
    pricingPending,
    references.length,
    resolution,
    pricedDuration,
  ]);

  const trimmed = prompt.trim();
  const modeReady =
    effectiveMode === 'text' ||
    (effectiveMode === 'reference' &&
      references.length + videoRefs.length > 0) ||
    (effectiveMode === 'frames' && startFrame !== null);

  const buildInput = (): StudioCreateInput => {
    // Names are a composer affordance; the model only knows slots (#1748).
    const modelPrompt = resolveStudioAliases(trimmed, [
      ...references.map((r, i) => ({
        alias: r.alias ?? '',
        token: `Image${i + 1}`,
      })),
      ...videoRefs.map((r, i) => ({
        alias: r.alias ?? '',
        token: `Video${i + 1}`,
      })),
      ...audioRefs.map((r, i) => ({
        alias: r.alias ?? '',
        token: `Audio${i + 1}`,
      })),
    ]);
    if (activity === 'video') {
      return {
        activity: 'video',
        prompt: modelPrompt,
        videoModel: compatibleVideoModel,
        aspectRatio,
        resolution,
        duration: pricedDuration,
        count,
        generateAudio: audioCapable ? generateAudio : undefined,
        draft: draftCapable ? draftMode : undefined,
        mode: effectiveMode,
        referenceImages:
          effectiveMode === 'reference' ? references.map((r) => r.url) : [],
        referenceVideos:
          effectiveMode === 'reference'
            ? videoRefs.map((r) =>
                r.assetId ? { assetId: r.assetId } : { url: r.url }
              )
            : [],
        referenceAudio:
          effectiveMode === 'reference' ? audioRefs.map((r) => r.url) : [],
        startImageUrl: effectiveMode === 'frames' ? startFrame?.url : undefined,
        endImageUrl: effectiveMode === 'frames' ? endFrame?.url : undefined,
      };
    }
    return {
      activity: 'image',
      prompt: modelPrompt,
      imageModel,
      aspectRatio: imageControls.isConfigured
        ? imageControls.aspectRatio
        : aspectRatio,
      resolution,
      count: imageControls.isConfigured ? imageControls.requestCount : count,
      referenceImages: references.map((r) => r.url),
      ...(imageControls.isConfigured
        ? {
            channelParameters: imageControls.requestParameters,
            ...(imageControls.maskImageUrl
              ? { maskImageUrl: imageControls.maskImageUrl }
              : {}),
          }
        : {}),
    };
  };

  // --- rights (#1581) ---------------------------------------------------------
  // Same list the server checks (`studioGatedMedia`). A reference clip sent
  // as an address is an upload; a Studio clip is an id and is not signed
  // here. Logged out, nothing is asked until sign-in.
  const tiles = [...references, ...videoRefs, startFrame, endFrame].filter(
    (r): r is StudioReference => r !== null
  );
  const gatedUrls = [...new Set(studioGatedMedia(buildInput()))];
  const rights = useUploadRights(
    gatedUrls.map((url) => ({
      url,
      filename: tiles.find((r) => r.url === url)?.label,
    }))
  );
  const checks = rights.flatMap((query, i) => {
    const url = gatedUrls[i];
    return url ? [{ url, query }] : [];
  });
  const cleared = new Set(
    checks.filter((c) => c.query.data?.status === 'cleared').map((c) => c.url)
  );
  const owed = checks.filter(
    (c) =>
      c.query.data?.status === 'needs_portrait' ||
      (cleared.has(c.url) && markedReal.includes(c.url))
  );
  const realPersonToggle = (url: string) =>
    cleared.has(url)
      ? {
          marked: markedReal.includes(url),
          onToggle: () =>
            setMarkedReal((prev) =>
              prev.includes(url)
                ? prev.filter((u) => u !== url)
                : [...prev, url]
            ),
        }
      : undefined;
  const portraitUrls = owed.map((c) => c.url);
  const portraitKey = portraitUrls.join('\n');
  const portraitTicked =
    portraitUrls.length > 0 && portraitTickedFor === portraitKey;
  // `isLoading`, not `isPending`: a disabled (logged-out) check is pending
  // forever and must not wear a spinner.
  const checking = new Set(
    checks.filter((c) => c.query.isLoading).map((c) => c.url)
  );
  // Generate waits for every check to land and every sign-off to be saved.
  const rightsReady =
    !isAuthenticated ||
    (checks.every((c) => c.query.data !== undefined) && owed.length === 0);
  const rightsTicked = portraitTicked && authorizationBasis.trim().length > 0;
  const referenceAttestations: PortraitAttestation[] = portraitUrls.map(
    (url) => ({
      url,
      statementVersion: PORTRAIT_RIGHTS_V1.version,
      authorizationBasis: authorizationBasis.trim(),
    })
  );
  const badgeFor = (url: string): string => {
    if (!isVideo && url === imageControls.maskImageUrl)
      return tImageChannels('Mask image URL');
    if (effectiveMode === 'frames') {
      return url === startFrame?.url ? 'Start frame' : 'End frame';
    }
    const index = references.findIndex((r) => r.url === url);
    if (index >= 0) return `@Image${index + 1}`;
    const clip = videoRefs.findIndex((r) => r.url === url);
    return clip >= 0 ? `@Video${clip + 1}` : url;
  };
  const badges = (urls: string[]) => urls.map(badgeFor).join(', ');
  const confirmRights = () => {
    attest.mutate(referenceAttestations, {
      onSuccess: () => {
        setPortraitTickedFor('');
        setAuthorizationBasis('');
      },
    });
  };

  // Generate stays live on an empty prompt (#1393) — an empty click is the
  // cheapest place to open the login dialog or offer a random prompt. Only
  // an unready mode, an in-flight upload, or a missing sign-off disables it.
  const canSubmit =
    modelDefaultsReady &&
    prefsLoaded &&
    modeReady &&
    uploading === 0 &&
    (isVideo ||
      (imageControls.issue === null && !imageControls.uploadingMask)) &&
    rightsReady;
  // The prompt, not the button, is what pulses while its generation runs
  // (#1455) — and typing anything else stops it, even mid-generation.
  const generating =
    trimmed.length > 0 &&
    (generatingPrompts.includes(trimmed) ||
      pendingCreates.some((input) => input.prompt === trimmed));

  // --- references -----------------------------------------------------------

  const limits: Record<StudioReferenceKind, number> = {
    image: referenceLimit,
    video: videoRefLimit,
    audio: audioLimit,
  };
  const counts: Record<StudioReferenceKind, number> = {
    image: references.length,
    video: videoRefs.length,
    audio: audioRefs.length,
  };
  const listFor: Record<StudioReferenceKind, StudioReference[]> = {
    image: references,
    video: videoRefs,
    audio: audioRefs,
  };
  const setListFor = {
    image: setReferences,
    video: setVideoRefs,
    audio: setAudioRefs,
  };
  const slots = useMemo<Record<StudioReferenceKind, number>>(() => {
    const used = references.length + videoRefs.length + audioRefs.length;
    const combinedRemaining =
      combinedRefCap == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, combinedRefCap - used);
    return {
      image: Math.min(
        Math.max(0, referenceLimit - references.length),
        combinedRemaining
      ),
      video: Math.min(
        Math.max(0, videoRefLimit - videoRefs.length),
        combinedRemaining
      ),
      audio: Math.min(
        Math.max(0, audioLimit - audioRefs.length),
        combinedRemaining
      ),
    };
  }, [
    audioLimit,
    audioRefs.length,
    combinedRefCap,
    referenceLimit,
    references.length,
    videoRefLimit,
    videoRefs.length,
  ]);

  /** Append to the list for its kind; returns the new index, or -1 at cap. */
  const addReference = (reference: StudioReference): number => {
    const { kind } = reference;
    const index = counts[kind];
    if (index >= limits[kind]) {
      toast.error(
        translateEvent('Up to {{value1}} reference {{value2}}s', {
          value1: limits[kind],
          value2: kind,
        })
      );
      return -1;
    }
    const used = counts.image + counts.video + counts.audio;
    if (combinedRefCap != null && used >= combinedRefCap) {
      toast.error(
        translateEvent('Up to {{value1}} reference files total', {
          value1: combinedRefCap,
        })
      );
      return -1;
    }
    setListFor[kind]((prev) => [...prev, reference]);
    if (isVideo && mode !== 'reference') setMode('reference');
    return index;
  };

  const removeReference = (kind: StudioReferenceKind, index: number) => {
    const alias = listFor[kind][index]?.alias;
    setListFor[kind]((prev) => prev.filter((_, i) => i !== index));
    setPrompt((prev) => {
      const dropped = alias ? dropStudioAlias(prev, alias) : prev;
      return renumberStudioReferences(dropped, index, REFERENCE_TOKENS[kind]);
    });
  };

  const placeReference = (reference: StudioReference, target: PickerTarget) => {
    if (target === 'start') setStartFrame(reference);
    else if (target === 'end') setEndFrame(reference);
    else addReference(reference);
  };

  const dropTarget = (): PickerTarget => {
    if (mode !== 'frames') return 'reference';
    if (!startFrame) return 'start';
    return endFrameCapable ? 'end' : 'start';
  };

  const fileKind = (file: File): StudioReferenceKind | null =>
    elementKindFromFile(file);

  // The rule a sequence shot answers to (`unusableShotReferenceLines`): the
  // model's clip window, format, the Seedance edit window and the combined
  // cap, so the composer cannot refuse less than the server does (#2210).
  const clipProblemLines = (clips: StudioReference[]): string[] =>
    unusableShotReferenceLines(
      compatibleVideoModel,
      clips.map((ref, index) => ({
        kind: 'video' as const,
        token: `@Video${index + 1}`,
        referenceImageUrl: ref.url,
        durationSeconds: ref.durationSeconds,
      })),
      { hasStartFrame: false, prompt, onArk: vias.byteplus === true }
    ).map((line) => localizeReferenceProblem(i18n, line));

  const uploadFiles = async (files: File[], target: PickerTarget) => {
    const taken: Record<StudioReferenceKind, number> = {
      image: 0,
      video: 0,
      audio: 0,
    };
    for (const file of files) {
      const kind = fileKind(file);
      if (!kind) continue;
      if (target !== 'reference' && kind !== 'image') continue;
      const room = target === 'reference' ? slots[kind] : 1;
      if (taken[kind] >= room) {
        toast.error(
          target === 'reference'
            ? translateEvent('Up to {{value1}} reference {{value2}}s', {
                value1: limits[kind],
                value2: kind,
              })
            : translateEvent('One image per frame')
        );
        continue;
      }
      taken[kind] += 1;
      const durationSeconds =
        kind === 'video' ? await readMediaDuration(file, 'video') : undefined;
      if (kind === 'video') {
        // Checked with the clips already attached, so the combined cap
        // (#2210) and the format refuse before the upload, not at Generate.
        const lines = clipProblemLines([
          ...videoRefs,
          { url: file.name, label: file.name, kind, durationSeconds },
        ]);
        if (lines.length > 0) {
          toast.error(lines.join(' '));
          continue;
        }
      }
      setUploading((n) => n + 1);
      try {
        const stored =
          kind === 'audio' ? await normalizeElementFile(file) : file;
        const { url } = await upload.mutateAsync({ file: stored });
        placeReference(
          { url, label: file.name, kind, durationSeconds },
          target
        );
        void queryClient.invalidateQueries({ queryKey: studioUploadKeys.all });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translateEvent('Upload failed')
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onDrop = (event: React.DragEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!refsCapable || !dataTransferHasImages(event.dataTransfer)) return;
    const snapshot = snapshotDataTransfer(event.dataTransfer);
    const target = dropTarget();
    void extractImagesFromSnapshot(snapshot).then(({ files, failedUrls }) => {
      if (failedUrls.length > 0) toastDragImportCorsError(i18n);
      if (files.length > 0) void uploadFiles(files, target);
    });
  };

  // --- @ mentions -----------------------------------------------------------

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!refsCapable || effectiveMode === 'frames') return [];
    const items = [
      ...references.map((r, i) => referenceMentionItem(r, i)),
      ...videoRefs.map((r, i) => referenceMentionItem(r, i, 'Video')),
      ...audioRefs.map((r, i) => referenceMentionItem(r, i, 'Audio')),
    ];
    const libraryItem = (
      section: 'images' | 'cast' | 'locations',
      reference: StudioReference
    ): MentionItem => ({
      id: `${section}:${reference.kind}:${reference.url}`,
      section,
      label: reference.label,
      sublabel:
        reference.kind === 'video'
          ? t('Attach as @Video{{value1}}', { value1: videoRefs.length + 1 })
          : t('Attach as @Image{{value1}}', { value1: references.length + 1 }),
      // Never in the prompt — a library row only ever reaches it via
      // `onMentionSelect`, which swaps it for the attached `ImageN`. An
      // empty tag is skipped by the matcher.
      tag: '',
      haystack: reference.label.toLowerCase(),
      thumbnailUrl:
        reference.kind === 'video' ? reference.posterUrl : reference.url,
    });
    return [
      ...items,
      ...library.cast.map((r) => libraryItem('cast', r)),
      ...library.locations.map((r) => libraryItem('locations', r)),
      ...[...library.uploads, ...library.generations]
        .filter((r) => slots[r.kind] > 0)
        .map((r) => libraryItem('images', r)),
    ];
  }, [
    audioRefs,
    effectiveMode,
    library,
    references,
    refsCapable,
    slots,
    videoRefs,
    t,
  ]);

  /**
   * `@Image5` with two stills attached: nothing pills it and nothing stops it,
   * so the model would be handed a slot the request never carries (#1748).
   * Warn rather than block — the prompt is the user's to write.
   */
  const unresolvedRefs = unresolvedStudioReferences(
    trimmed,
    counts,
    [...references, ...videoRefs, ...audioRefs].flatMap((r) =>
      r.alias ? [r.alias] : []
    )
  );
  // A slot can be attached; a name we don't hold cannot, so the two want
  // different words (#1748).
  const unresolvedSlots = unresolvedRefs.filter((token) =>
    /^@(Image|Video|Audio)\d+$/.test(token)
  );
  const unresolvedNames = unresolvedRefs.filter(
    (token) => !unresolvedSlots.includes(token)
  );

  const onMentionSelect = (item: MentionItem): MentionItem => {
    if (item.section === 'references') return item;
    const [, kind = 'image', ...rest] = item.id.split(':');
    const url = rest.join(':');
    const referenceKind = kind === 'video' ? 'video' : 'image';
    const source = [
      ...library.generations,
      ...library.uploads,
      ...library.cast,
      ...library.locations,
    ].find((r) => r.kind === referenceKind && r.url === url);
    const reference: StudioReference = {
      url,
      label: item.label,
      kind: referenceKind,
      posterUrl:
        kind === 'video' ? (item.thumbnailUrl ?? undefined) : undefined,
      ...(source?.alias ? { alias: source.alias } : {}),
      ...(source?.assetId ? { assetId: source.assetId } : {}),
    };
    const index = addReference(reference);
    if (index < 0) return item;
    return referenceMentionItem(
      reference,
      index,
      reference.kind === 'video' ? 'Video' : 'Image'
    );
  };

  // --- settings -------------------------------------------------------------

  const changeVideoModel = (next: ImageToVideoModel) => {
    setVideoModel(next);
    if (!studioSupportsMode(next, mode)) setMode('text');
    if (!studioSupportsEndFrame(next)) setEndFrame(null);
    if (studioAudioLimit(next) === 0) setAudioRefs([]);
    if (studioVideoRefLimit(next) === 0) setVideoRefs([]);
  };

  const applyShuffle = () => {
    const next = pickShufflePrompt(
      studioShufflePrompts(activity).map((sample) => t(sample)),
      prompt,
      Math.random
    );
    if (!next) return;
    setPrompt(next);
    setLastShuffled(next);
  };

  const requestShuffle = () => {
    if (trimmed.length > 0 && trimmed !== lastShuffled) {
      setReplaceConfirm(true);
      return;
    }
    applyShuffle();
  };

  const draftSources = [...references, ...videoRefs, ...audioRefs];
  const canDraft =
    (effectiveMode === 'reference' && draftSources.length > 0) ||
    (effectiveMode === 'frames' && startFrame !== null);

  const applyDraft = (options?: {
    /** Intent to write from when the composer is empty. */
    seed?: string;
    onDrafted?: (next: string) => void;
  }) => {
    if (!modelDefaultsReady || !prefsLoaded) return;
    draft.mutate(
      {
        activity,
        references:
          effectiveMode === 'reference'
            ? draftSources.map(({ url, label, kind }) => ({ url, label, kind }))
            : [],
        startImageUrl: mode === 'frames' ? startFrame?.url : undefined,
        endImageUrl: mode === 'frames' ? endFrame?.url : undefined,
        currentPrompt: trimmed || options?.seed,
      },
      {
        onSuccess: ({ prompt: next }) => {
          setPrompt(next);
          setLastShuffled(next);
          options?.onDrafted?.(next);
        },
      }
    );
  };

  /**
   * "Try something random": the draft flow invents the prompt — from whatever
   * is attached, or from nothing at all. Deliberately NOT seeded from the
   * Shuffle pool: those are the canned tour prompts, and reusing one here
   * would hand every "random" user the same dozen shots.
   *
   * It stops there. The prompt lands in the composer for the user to read and
   * edit before they spend anything on generating it.
   */
  const generateRandom = () => {
    posthog.capture('empty_prompt_choice', {
      surface: 'studio',
      activity,
      choice: 'random',
    });
    applyDraft({ onDrafted: () => setEmptyPrompt(false) });
  };

  /**
   * Pasting a file attaches it; pasting a scene's request JSON (from the
   * optimised prompt panel) rebuilds the references + prompt instead of
   * dumping JSON into the editor. Capture phase + stopPropagation so
   * ProseMirror never sees either.
   */
  const onPasteCapture = (event: React.ClipboardEvent) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-studio-image-controls]')
    )
      return;
    // Pasted files (a screenshot, a clip) attach straight away. The picker is
    // a portal, so its pastes bubble through here too — route them to the
    // tile whose picker is open.
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      if (!refsCapable) return;
      event.preventDefault();
      event.stopPropagation();
      const target = picker && picker !== 'reference' ? picker : dropTarget();
      void uploadFiles(files, target);
      setPicker(null);
      return;
    }
    if (!isVideo) return;
    const imported = parseStudioPaste(
      event.clipboardData.getData('text/plain')
    );
    if (!imported) return;
    event.preventDefault();
    event.stopPropagation();
    const label = (kind: string, i: number) => `Pasted ${kind} ${i + 1}`;
    if (imported.startImageUrl) {
      setMode('frames');
      setStartFrame({
        url: imported.startImageUrl,
        label: 'Pasted start frame',
        kind: 'image',
      });
      setEndFrame(
        imported.endImageUrl && endFrameCapable
          ? {
              url: imported.endImageUrl,
              label: 'Pasted end frame',
              kind: 'image',
            }
          : null
      );
    } else {
      setMode('reference');
      setReferences(
        imported.images
          .slice(0, referenceLimit)
          .map((url, i) => ({ url, label: label('image', i), kind: 'image' }))
      );
      setVideoRefs(
        imported.videos
          .slice(0, videoRefLimit)
          .map((url, i) => ({ url, label: label('clip', i), kind: 'video' }))
      );
      setAudioRefs(
        imported.audio
          .slice(0, audioLimit)
          .map((url, i) => ({ url, label: label('audio', i), kind: 'audio' }))
      );
    }
    setPrompt(imported.prompt);
    setLastShuffled(imported.prompt);
    const requested =
      imported.images.length +
      imported.videos.length +
      imported.audio.length +
      (imported.startImageUrl ? 1 : 0) +
      (imported.endImageUrl ? 1 : 0);
    const total = imported.startImageUrl
      ? 1 + (imported.endImageUrl && endFrameCapable ? 1 : 0)
      : Math.min(imported.images.length, referenceLimit) +
        Math.min(imported.videos.length, videoRefLimit) +
        Math.min(imported.audio.length, audioLimit);
    const dropped = requested - total;
    toast.success(
      total > 0
        ? translateEvent(
            'Imported the prompt and {{value1}} reference{{value2}}',
            { value1: total, value2: total === 1 ? '' : 's' }
          ) +
            (dropped > 0
              ? translateEvent(" ({{value1}} over the model's limit dropped)", {
                  value1: dropped,
                })
              : '')
        : translateEvent('Imported the prompt')
    );
  };

  const clearAll = () => {
    imageControls.reset();
    setPrompt('');
    setReferences([]);
    setVideoRefs([]);
    setAudioRefs([]);
    setStartFrame(null);
    setEndFrame(null);
  };

  const submit = () => {
    if (!canSubmit || create.isPending) return;
    if (promptTooLong) {
      // The red counter is the standing signal; the click is where we say why
      // nothing happened. A dialog, not a toast: the toast covered the button
      // it was explaining. Studio refuses rather than shortening — it has no
      // prompt versions, so a rewrite would be invisible (#1754).
      setPromptTooLongOpen(true);
      return;
    }
    const clipLines = clipProblemLines(videoRefs);
    if (clipLines.length > 0) {
      toast.error(clipLines.join(' '));
      return;
    }
    if (trimmed.length === 0) {
      posthog.capture('empty_prompt_generate_clicked', {
        surface: 'studio',
        activity,
        authenticated: isAuthenticated,
      });
      // Logged out: the login dialog is the ask. Logged in: pick a prompt.
      if (requireAuth()) setEmptyPrompt(true);
      return;
    }
    requireAuth(() => {
      // Logged out with uploads attached: sign-in starts the rights checks,
      // and the panel (not a server rejection) asks for the sign-off.
      if (!isAuthenticated && gatedUrls.length > 0) return;
      create.mutate(buildInput());
    });
  };

  const imageTotalCount = imageControls.isConfigured
    ? imageControls.totalImageCount
    : count;
  const submitLabel =
    activity === 'video'
      ? count > 1
        ? t('Generate {{value1}} videos', { value1: count })
        : t('Generate video')
      : imageTotalCount > 1
        ? t('Generate {{value1}} images', { value1: imageTotalCount })
        : t('Generate image');

  const placeholder =
    effectiveMode === 'reference'
      ? t('Describe the shot. Type @ to reference an attached image…')
      : effectiveMode === 'frames'
        ? t('Describe how the start frame moves…')
        : activity === 'video'
          ? t('A red fox turns toward camera in morning fog…')
          : imageRefLimit > 0
            ? t('Describe the still. Type @ to reference an attached image…')
            : t('A red fox in fog at dawn, cinematic lighting…');

  const selectedAspectRatio =
    !isVideo && imageControls.isConfigured
      ? imageControls.aspectRatio
      : aspectRatio;
  const aspect = ASPECT_RATIOS.find((r) => r.value === selectedAspectRatio);
  const summary = [
    !isVideo &&
    imageControls.isConfigured &&
    imageControls.outputOptions.automatic
      ? tImageChannels('Automatic size')
      : selectedAspectRatio,
    resolutionTiers.length > 0
      ? RESOLUTION_OPTIONS.find((r) => r.value === resolution)?.label
      : null,
    isVideo && durationCapable
      ? pricedDuration === 'auto'
        ? t('Auto length')
        : `${pricedDuration}s`
      : null,
    isVideo && audioCapable ? (generateAudio ? t('Audio') : t('Silent')) : null,
    `×${!isVideo ? imageTotalCount : count}`,
  ].filter(Boolean);

  const showTiles = isVideo
    ? mode !== 'text'
    : imageRefLimit > 0 || references.length > 0;
  const hasContent =
    trimmed.length > 0 ||
    (!isVideo && imageControls.maskInput.length > 0) ||
    references.length > 0 ||
    videoRefs.length > 0 ||
    audioRefs.length > 0 ||
    startFrame !== null ||
    endFrame !== null;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drop zone; the Add tile is the keyboard path
    <form
      id={composerFormId}
      className={cn(
        'relative flex min-h-0 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-3 shadow-sm',
        dragging && 'border-ring ring-3 ring-ring/30'
      )}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragEnter={(event) => {
        if (!refsCapable || !dataTransferHasImages(event.dataTransfer)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(event) => {
        if (refsCapable && dataTransferHasImages(event.dataTransfer)) {
          event.preventDefault();
        }
      }}
      onDrop={onDrop}
      onPasteCapture={onPasteCapture}
    >
      {!isVideo && <ConfiguredImageStatus controls={imageControls} />}
      {/* The prompt being typed reaches the assistant, and it writes back (#2155). */}
      <AssistantContextItem
        item={{
          kind: 'draft_prompt',
          id: 'draft',
          label: 'Unsaved prompt',
          text: prompt.slice(0, 50_000),
        }}
        onReplace={(text) => {
          // The model wrote over what the user typed; keep the way back.
          const previous = prompt;
          setPrompt(text);
          toast('The assistant rewrote the prompt', {
            action: { label: 'Undo', onClick: () => setPrompt(previous) },
          });
        }}
      />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto md:flex-row">
        {showTiles && (
          <div
            className="flex shrink-0 gap-2 overflow-x-auto md:max-w-[19rem] md:flex-wrap"
            aria-label={
              mode === 'frames'
                ? t('Start and end frames')
                : t('Reference images')
            }
          >
            {(isVideo ? mode === 'reference' : true) && (
              <>
                {references.map((reference, index) => (
                  <Tile
                    key={`${reference.url}-${index}`}
                    reference={reference}
                    badge={`@Image${index + 1}`}
                    checking={checking.has(reference.url)}
                    realPerson={realPersonToggle(reference.url)}
                    onRemove={() => removeReference('image', index)}
                  />
                ))}
                {videoRefs.map((reference, index) => (
                  <Tile
                    key={`${reference.url}-${index}`}
                    reference={reference}
                    badge={`@Video${index + 1}`}
                    checking={checking.has(reference.url)}
                    realPerson={realPersonToggle(reference.url)}
                    onRemove={() => removeReference('video', index)}
                  />
                ))}
                {audioRefs.map((reference, index) => (
                  <Tile
                    key={`${reference.url}-${index}`}
                    reference={reference}
                    badge={`@Audio${index + 1}`}
                    onRemove={() => removeReference('audio', index)}
                  />
                ))}
                {slots.image + slots.video + slots.audio > uploading && (
                  <AddTile
                    label={t('Reference')}
                    onClick={() => setPicker('reference')}
                  />
                )}
              </>
            )}
            {mode === 'frames' && (
              <>
                {startFrame ? (
                  <Tile
                    reference={startFrame}
                    badge="Start"
                    checking={checking.has(startFrame.url)}
                    realPerson={realPersonToggle(startFrame.url)}
                    removeLabel={t('Remove start frame')}
                    onRemove={() => setStartFrame(null)}
                  />
                ) : (
                  <AddTile
                    label={t('Start frame')}
                    onClick={() => setPicker('start')}
                  />
                )}
                {endFrameCapable &&
                  (endFrame ? (
                    <Tile
                      reference={endFrame}
                      badge="End"
                      checking={checking.has(endFrame.url)}
                      realPerson={realPersonToggle(endFrame.url)}
                      removeLabel={t('Remove end frame')}
                      onRemove={() => setEndFrame(null)}
                    />
                  ) : (
                    <AddTile
                      label={t('End frame')}
                      hint={t('optional')}
                      onClick={() => setPicker('end')}
                    />
                  ))}
              </>
            )}
            {Array.from({ length: uploading }, (_, i) => (
              <Skeleton key={i} className="size-20 shrink-0 rounded-lg" />
            ))}
          </div>
        )}

        <MarkdownEditor
          value={prompt}
          onValueChange={setPrompt}
          ref={promptEditorRef}
          placeholder={placeholder}
          aria-label={t('Prompt')}
          data-testid="studio-prompt"
          className={cn(
            'min-h-24 flex-1 border-0 bg-transparent px-1 py-1 shadow-none focus-within:ring-0 dark:bg-transparent',
            generating && 'motion-safe:animate-pulse'
          )}
          mentionItems={refsCapable ? mentionItems : undefined}
          onMentionSelect={onMentionSelect}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              submit();
              return true;
            }
            return false;
          }}
        />
      </div>

      {(unresolvedSlots.length > 0 || unresolvedNames.length > 0) && (
        <div
          className="flex shrink-0 flex-col gap-1 text-xs text-destructive"
          aria-live="polite"
        >
          {unresolvedSlots.length > 0 && (
            <p>
              {t('{{value1}} {{value2}} attached.', {
                value1: unresolvedSlots.join(', '),
                value2: unresolvedSlots.length === 1 ? t("isn't") : t("aren't"),
              })}
            </p>
          )}
          {unresolvedNames.length > 0 && (
            <p>
              {t(
                '{{value1}} {{value2}} in your library. {{value3}} will be sent as words.',
                {
                  value1: unresolvedNames.join(', '),
                  value2:
                    unresolvedNames.length === 1 ? t("isn't") : t("aren't"),
                  value3: unresolvedNames.length === 1 ? t('It') : t('They'),
                }
              )}
            </p>
          )}
        </div>
      )}

      {isAuthenticated && checks.length > 0 && (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Ctrl/Cmd+Enter in the basis field confirms rights, not Generate (the outer form)
        <div
          className="flex shrink-0 flex-col gap-2"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
              return;
            }
            if (!(event.target instanceof HTMLTextAreaElement)) return;
            event.preventDefault();
            if (rightsTicked && !attest.isPending) confirmRights();
          }}
        >
          {checks
            .filter((c) => c.query.isError)
            .map((c) => (
              <p
                key={c.url}
                className="flex flex-wrap items-baseline gap-1 text-xs text-destructive"
              >
                <span>
                  {t("Couldn't check {{value1}}: {{value2}}", {
                    value1: badgeFor(c.url),
                    value2: c.query.error?.message,
                  })}
                </span>
                {isInsufficientCreditsError(c.query.error) ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => openAddCreditsDialog('studio-rights-check')}
                  >
                    {t('Add credits')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  disabled={retryCheck.isPending}
                  onClick={() =>
                    retryCheck.mutate({
                      url: c.url,
                      filename: tiles.find((r) => r.url === c.url)?.label,
                    })
                  }
                >
                  {retryCheck.isPending ? t('Retrying…') : t('Retry')}
                </Button>
              </p>
            ))}
          {portraitUrls.length > 0 && (
            <PortraitAttestationFields
              id="studio-portrait-attestation"
              attested={portraitTicked}
              onAttestedChange={(checked) =>
                setPortraitTickedFor(checked ? portraitKey : '')
              }
              authorizationBasis={authorizationBasis}
              onAuthorizationBasisChange={setAuthorizationBasis}
            >
              <p className="text-xs font-medium">
                {t('Real person in {{value1}}', {
                  value1: badges(portraitUrls),
                })}
              </p>
            </PortraitAttestationFields>
          )}
          {owed.length > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!rightsTicked || attest.isPending}
                onClick={confirmRights}
              >
                {attest.isPending ? t('Saving…') : t('Confirm rights')}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {isVideo && (
          <Select
            value={mode}
            onValueChange={(value) => {
              if (
                value === 'text' ||
                value === 'reference' ||
                value === 'frames'
              ) {
                setMode(value);
              }
            }}
          >
            <SelectTrigger
              aria-label={t('Video mode')}
              className="w-auto gap-1.5"
            >
              <SelectValue>{translateLabel(MODE_LABELS[mode])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(['text', 'reference', 'frames'] as const).map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  disabled={!studioSupportsMode(compatibleVideoModel, value)}
                >
                  {translateLabel(MODE_LABELS[value])}
                  {value === 'reference' &&
                    !studioSupportsMode(compatibleVideoModel, value) && (
                      <span className="text-muted-foreground">
                        {t('· not on this model')}
                      </span>
                    )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={t('Generation settings')}
              className="gap-2"
            >
              {aspect && (
                <AspectRatioIcon
                  width={aspect.width}
                  height={aspect.height}
                  size="sm"
                />
              )}
              <span className="font-mono text-xs">
                <span className="hidden md:inline">{activeModelName} · </span>
                {summary.join(' · ')}
              </span>
              <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={12}
            className="max-h-[calc(100dvh-2rem)] w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto p-4"
          >
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t('Model')}</h3>
                {activity === 'image' ? (
                  <ImageModelSelector
                    selectedModel={imageModel}
                    disabled={!modelDefaultsReady || !prefsLoaded}
                    onModelChange={setImageModel}
                  />
                ) : (
                  <MotionModelSelector
                    selectedModel={compatibleVideoModel}
                    disabled={!modelDefaultsReady || !prefsLoaded}
                    onModelChange={changeVideoModel}
                    aspectRatio={aspectRatio}
                  />
                )}
                {isVideo && referenceLimit === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('{{value1}} takes frames, not reference images.', {
                      value1: IMAGE_TO_VIDEO_MODELS[compatibleVideoModel].name,
                    })}
                  </p>
                )}
                {isVideo &&
                  studioReferenceEndpoint(compatibleVideoModel)?.note && (
                    <p className="text-xs text-muted-foreground">
                      {studioReferenceEndpoint(compatibleVideoModel)?.note}
                    </p>
                  )}
                {!isVideo && imageRefLimit === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'This model has no edit endpoint, so it cannot take reference images.'
                    )}
                  </p>
                )}
              </section>
              <Separator />
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t('Aspect ratio')}</h3>
                {!isVideo &&
                imageControls.isConfigured &&
                imageControls.outputOptions.automatic ? (
                  <p className="text-[10px] text-muted-foreground">
                    {tImageChannels('Use model default')}
                  </p>
                ) : (
                  <AspectRatioPills
                    value={selectedAspectRatio}
                    onChange={setAspectRatio}
                    available={
                      !isVideo && imageControls.isConfigured
                        ? imageControls.outputOptions.aspectRatios
                        : undefined
                    }
                  />
                )}
              </section>
              <Separator />
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t('Resolution')}</h3>
                <ResolutionPills
                  value={resolution}
                  onChange={setResolution}
                  available={resolutionTiers}
                  note={
                    draftOn
                      ? t('Drafts render at 480p, the final at 1080p')
                      : resolutionNote
                  }
                />
              </section>
              {!isVideo && imageControls.isConfigured && (
                <ConfiguredImageControls
                  controls={imageControls}
                  formId={composerFormId}
                />
              )}
              {isVideo && durationCapable && (
                <>
                  <Separator />
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{t('Duration')}</h3>
                    <Select
                      value={String(pricedDuration)}
                      disabled={followsReferenceVideo}
                      onValueChange={(value) => {
                        if (value === 'auto') {
                          setDuration('auto');
                          return;
                        }
                        const next = Number(value);
                        if (Number.isFinite(next) && next > 0)
                          setDuration(next);
                      }}
                    >
                      <SelectTrigger
                        aria-label={t('Clip duration')}
                        className="w-28 font-mono text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {studioSupportsAutoDuration(compatibleVideoModel) && (
                          <SelectItem
                            value="auto"
                            className="font-mono text-xs"
                          >
                            {t('Auto')}
                          </SelectItem>
                        )}
                        {studioVideoDurations(compatibleVideoModel).map(
                          (value) => (
                            <SelectItem
                              key={value}
                              value={String(value)}
                              className="font-mono text-xs"
                            >
                              {value}s
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {followsReferenceVideo && (
                      <p className="text-xs text-muted-foreground">
                        {t("An edit keeps the clip's length.")}
                      </p>
                    )}
                  </section>
                </>
              )}
              {isVideo && audioCapable && (
                <>
                  <Separator />
                  <section className="flex items-center justify-between gap-4">
                    <label
                      htmlFor="studio-generate-audio"
                      className="text-sm font-medium"
                    >
                      {t('Native audio')}
                    </label>
                    <Switch
                      id="studio-generate-audio"
                      checked={generateAudio}
                      onCheckedChange={setGenerateAudio}
                    />
                  </section>
                </>
              )}
              <Separator />
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t('Count')}</h3>
                <ToggleGroup
                  type="single"
                  value={String(count)}
                  onValueChange={(value) => {
                    const next = Number(value);
                    if (next === 1 || next === 2 || next === 4) setCount(next);
                  }}
                  variant="outline"
                  spacing={0}
                  aria-label={t('How many to generate')}
                >
                  {COUNTS.map((value) => (
                    <ToggleGroupItem
                      key={value}
                      value={String(value)}
                      disabled={
                        !isVideo &&
                        !imageControls.availableCounts.includes(value)
                      }
                      className="px-3 font-mono text-xs"
                    >
                      {value}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </section>
            </div>
          </PopoverContent>
        </Popover>

        {/* Out of the popover so it is never missed (a user retried full
            renders for days without seeing drafts were on). */}
        {draftCapable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                htmlFor="studio-draft"
                className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium"
              >
                {t('Draft 480p')}
                <Switch
                  id="studio-draft"
                  checked={draftMode}
                  onCheckedChange={setDraftMode}
                />
              </label>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {draftMode
                ? t(
                    'On: renders a 480p draft first. Render the 1080p final from its card within seven days.'
                  )
                : t('Off: renders straight at {{value1}}.', {
                    value1:
                      RESOLUTION_OPTIONS.find((r) => r.value === resolution)
                        ?.label ?? resolution,
                  })}
            </TooltipContent>
          </Tooltip>
        )}

        {prompt.length > 0 && (
          <output
            className={cn(
              'text-xs tabular-nums',
              promptTooLong
                ? 'font-medium text-destructive'
                : promptOverRecommended
                  ? 'text-warning'
                  : 'text-muted-foreground'
            )}
          >
            {promptMeasured}
            {(promptHardLimit ?? promptRecommendation.maxPromptLength) !==
              undefined && (
              <>
                &nbsp;/&nbsp;
                {promptHardLimit ?? promptRecommendation.maxPromptLength}
              </>
            )}
          </output>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={requestShuffle}
        >
          <Shuffle className="size-3.5" aria-hidden="true" />
          {t('Shuffle')}
        </Button>
        {canDraft && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => applyDraft()}
            disabled={draft.isPending}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {draft.isPending ? t('Drafting…') : t('Draft prompt')}
          </Button>
        )}
        <AskAssistantButton variant="ghost" context={[]} />

        <div className="ml-auto flex items-center gap-2">
          {hasContent && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={clearAll}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t('Clear all')}
            </Button>
          )}
          {!isVideo && imageControls.isConfigured ? (
            <ConfiguredImageEstimate controls={imageControls} />
          ) : (
            <ActionCost
              estimate={estimate}
              align="end"
              amountWidth={activity === 'video' ? 'double' : 'single'}
            />
          )}
          <VoiceInputButton label={t('prompt')} {...promptVoice} />
          <Button
            type="submit"
            size="icon-lg"
            className="rounded-full"
            aria-label={submitLabel}
            disabled={!canSubmit}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 text-sm font-medium">
          {t('Drop to add {{value1}}', {
            value1:
              dropTarget() === 'reference'
                ? t('reference')
                : t('{{value1}} frame', { value1: dropTarget() }),
          })}
        </div>
      )}

      <StudioReferencePicker
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
        title={
          picker === 'start'
            ? t('Start frame')
            : picker === 'end'
              ? t('End frame')
              : t('Add reference')
        }
        library={library}
        attached={
          picker === 'reference'
            ? [...references, ...videoRefs, ...audioRefs].map((r) => r.url)
            : [startFrame?.url, endFrame?.url].filter((url): url is string =>
                Boolean(url)
              )
        }
        multiple={picker === 'reference'}
        slots={
          picker === 'reference' ? slots : { image: 1, video: 0, audio: 0 }
        }
        onPick={(picked) => {
          if (!picker) return;
          if (picker === 'reference') {
            for (const reference of picked) addReference(reference);
          } else {
            const first = picked[0];
            if (first) placeReference(first, picker);
          }
        }}
        onUpload={(files) => {
          if (picker) void uploadFiles(files, picker);
        }}
      />

      <AlertDialog open={promptTooLongOpen} onOpenChange={setPromptTooLongOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Prompt too long')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                '{{value1}} maxes out at {{value2}} characters. Yours is {{value3}}.',
                {
                  value1: activeModelName,
                  value2: promptHardLimit,
                  value3: prompt.length,
                }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>{t('Got it')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyPrompt} onOpenChange={setEmptyPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('What should we make?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "The prompt is empty. Describe the {{value1}} you want, or we'll write one for you to look over.",
                { value1: isVideo ? t('shot') : t('still') }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() =>
                posthog.capture('empty_prompt_choice', {
                  surface: 'studio',
                  activity,
                  choice: 'own_prompt',
                })
              }
            >
              {t("I'll write it")}
            </AlertDialogCancel>
            <AlertDialogAction
              // Keep the dialog up while the draft streams — closing on click
              // would leave the click with no visible effect for a second or two.
              onClick={(event) => {
                event.preventDefault();
                generateRandom();
              }}
              disabled={draft.isPending}
            >
              <Sparkles className="size-3.5" />
              {draft.isPending
                ? t('Writing a prompt…')
                : t('Try something random')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingSeed != null}
        onOpenChange={(open) => {
          if (!open) setPendingSeed(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Replace the prompt bar?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Use again loads that generation's prompt, references, and settings. What you've written here will be replaced."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep what's here")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingSeed) return;
                applySeed(pendingSeed);
              }}
            >
              <RotateCcw className="size-3.5" />
              {t('Use again')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={replaceConfirm} onOpenChange={setReplaceConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Replace your prompt?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Shuffle swaps in a sample prompt. What you've written here will be replaced."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Keep my prompt')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setReplaceConfirm(false);
                applyShuffle();
              }}
            >
              <Shuffle className="size-3.5" />
              {t('Replace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
