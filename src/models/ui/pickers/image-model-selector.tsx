import { Trans, useTranslation } from 'react-i18next';
import {
  BaseModelSelector,
  type ModelGenerationStatus,
} from './base-model-selector';
import {
  IMAGE_MODELS,
  isValidTextToImageModel,
  type TextToImageModel,
} from '@/models/models';
import {
  compareSelectorModels,
  QUALITY_DEFAULT_IMAGE,
  SELECTOR_GROUP_ORDER,
  selectorGroup,
  TURBO_IMAGE_MODELS,
} from '@/models/generation-mode';
import { useMemo } from 'react';

type RecommendationProps = {
  /** Style-recommended model key — renders a "Recommended" badge on the match. */
  recommendedImageModel?: string | null;
  /** Style name, used in the recommendation tooltip. */
  styleName?: string;
};

type RecommendationStatus =
  | { kind: 'matched'; modelName: string }
  | { kind: 'hidden-by-filter'; modelName: string }
  | { kind: 'unknown' }
  | { kind: 'none' };

function resolveRecommendation(
  recommendedImageModel: string | null | undefined,
  filterModels: TextToImageModel[] | undefined
): RecommendationStatus {
  if (!recommendedImageModel) return { kind: 'none' };
  if (!isValidTextToImageModel(recommendedImageModel))
    return { kind: 'unknown' };
  const modelName = IMAGE_MODELS[recommendedImageModel].name;
  if (filterModels && !filterModels.includes(recommendedImageModel)) {
    return { kind: 'hidden-by-filter', modelName };
  }
  return { kind: 'matched', modelName };
}

function useImageModels({
  recommendedImageModel,
  styleName,
}: RecommendationProps = {}) {
  const { t } = useTranslation('models');
  return useMemo(
    () =>
      Object.entries(IMAGE_MODELS)
        .filter(([, m]) => !('hidden' in m))
        .sort(([a], [b]) =>
          compareSelectorModels(
            a,
            b,
            TURBO_IMAGE_MODELS,
            QUALITY_DEFAULT_IMAGE,
            (id) =>
              isValidTextToImageModel(id) ? IMAGE_MODELS[id].qualityRank : 99
          )
        )
        .map(([key, m]) => ({
          id: key,
          name: m.name,
          group: selectorGroup(key, TURBO_IMAGE_MODELS),
          badge: m.license,
          recommendedFor:
            recommendedImageModel && key === recommendedImageModel
              ? styleName
                ? t('Recommended for {{value1}}', { value1: styleName })
                : t('Recommended for this style')
              : undefined,
        })),
    [recommendedImageModel, styleName, t]
  );
}

function RecommendationHint({
  status,
  styleName,
}: {
  status: RecommendationStatus;
  styleName: string | undefined;
}) {
  const { t } = useTranslation('models');

  if (status.kind === 'matched' || status.kind === 'none') return null;
  const prefix = styleName
    ? t('{{value1}} recommends', { value1: styleName })
    : t('Recommended');
  if (status.kind === 'unknown') {
    return (
      <p className="text-[10px] text-muted-foreground">
        {t("{{value1}} a model that's no longer available.", {
          value1: prefix,
        })}
      </p>
    );
  }
  return (
    <p className="text-[10px] text-muted-foreground">
      <Trans
        ns="models"
        i18nKey="{{value1}} <0>{{value2}}</0>, but it's not available in this selector."
        components={[<span key="0" className="font-medium" />]}
        values={{ value1: prefix, value2: status.modelName }}
      />
    </p>
  );
}

type ImageModelSelectorProps = {
  selectedModel: TextToImageModel;
  onModelChange: (model: TextToImageModel) => void;
  disabled?: boolean;
  /** When set, only show these models instead of all available models */
  filterModels?: TextToImageModel[];
  /** Per-scene generation status by model (#545); renders ✓/⟳/! in the list. */
  generatedStatuses?: Map<string, ModelGenerationStatus>;
} & RecommendationProps;

export const ImageModelSelector: React.FC<ImageModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  filterModels,
  recommendedImageModel,
  styleName,
  generatedStatuses,
}) => {
  const { t } = useTranslation('models');

  const allModels = useImageModels({ recommendedImageModel, styleName });
  const models = useMemo(() => {
    const filtered = filterModels
      ? allModels.filter(
          (m) => isValidTextToImageModel(m.id) && filterModels.includes(m.id)
        )
      : allModels;
    return filtered.map((m) => ({
      ...m,
      generationStatus: generatedStatuses?.get(m.id),
    }));
  }, [allModels, filterModels, generatedStatuses]);
  const status = useMemo(
    () => resolveRecommendation(recommendedImageModel, filterModels),
    [recommendedImageModel, filterModels]
  );

  return (
    <div className="flex flex-col gap-1">
      <BaseModelSelector
        label={t('Image Model')}
        models={models}
        groupOrder={SELECTOR_GROUP_ORDER}
        selectedIds={[selectedModel]}
        onSelectionChange={(ids) => {
          const firstId = ids[0];
          if (firstId && isValidTextToImageModel(firstId)) {
            onModelChange(firstId);
          }
        }}
        disabled={disabled}
        multiSelect={false}
      />
      <RecommendationHint status={status} styleName={styleName} />
    </div>
  );
};

type ImageModelMultiSelectorProps = {
  selectedModels: TextToImageModel[];
  onModelsChange: (models: TextToImageModel[]) => void;
  disabled?: boolean;
  filterModels?: TextToImageModel[];
} & RecommendationProps;

export const ImageModelMultiSelector: React.FC<
  ImageModelMultiSelectorProps
> = ({
  selectedModels,
  onModelsChange,
  disabled = false,
  recommendedImageModel,
  styleName,
  filterModels,
}) => {
  const { t } = useTranslation('models');

  const allModels = useImageModels({ recommendedImageModel, styleName });
  const models = useMemo(
    () =>
      filterModels
        ? allModels.filter(
            (m) => isValidTextToImageModel(m.id) && filterModels.includes(m.id)
          )
        : allModels,
    [allModels, filterModels]
  );
  const status = useMemo(
    () => resolveRecommendation(recommendedImageModel, filterModels),
    [recommendedImageModel, filterModels]
  );

  return (
    <div className="flex flex-col gap-1">
      <BaseModelSelector
        label={t('Image Models')}
        models={models}
        groupOrder={SELECTOR_GROUP_ORDER}
        selectedIds={selectedModels}
        onSelectionChange={(ids) => {
          const validIds = ids.filter(isValidTextToImageModel);
          if (validIds.length > 0) {
            onModelsChange(validIds);
          }
        }}
        disabled={disabled}
        multiSelect={true}
      />
      <RecommendationHint status={status} styleName={styleName} />
    </div>
  );
};
