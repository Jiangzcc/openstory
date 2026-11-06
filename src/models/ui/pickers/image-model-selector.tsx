import { Trans, useTranslation } from 'react-i18next';
import {
  BaseModelSelector,
  type ModelGenerationStatus,
} from './base-model-selector';
import {
  isValidTextToImageModel,
  type TextToImageModel,
} from '@/models/models';
import { SELECTOR_GROUP_ORDER } from '@/models/generation-mode';
import { useMemo } from 'react';
import { useImageModelCatalog } from '../use-image-model-catalog';
import {
  imageModelDisplayName,
  isSelectableImageModelId,
} from '@/models/image-model-catalog';
import type { ImageModelDefinition } from '@/models/image-model-catalog';
import { imageModelSelectorOptions } from '../image-model-options';
import type { ImageModelCapabilityFilter } from '../image-model-options';

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
  filterModels: TextToImageModel[] | undefined,
  catalog: readonly ImageModelDefinition[]
): RecommendationStatus {
  if (!recommendedImageModel) return { kind: 'none' };
  if (!isSelectableImageModelId(recommendedImageModel, catalog))
    return { kind: 'unknown' };
  const modelName = imageModelDisplayName(recommendedImageModel, catalog);
  if (filterModels && !filterModels.includes(recommendedImageModel)) {
    return { kind: 'hidden-by-filter', modelName };
  }
  return { kind: 'matched', modelName };
}

type ImageCapabilityFilter = ImageModelCapabilityFilter;

function useImageModels({
  recommendedImageModel,
  styleName,
  selectedIds,
  operation,
  referenceCount,
}: RecommendationProps &
  ImageCapabilityFilter & { selectedIds: readonly TextToImageModel[] }) {
  const { t } = useTranslation('models');
  const { models: catalog } = useImageModelCatalog();
  const models = useMemo(() => {
    return imageModelSelectorOptions(catalog, {
      selectedIds,
      operation,
      referenceCount,
    }).map((model) => ({
      ...model,
      recommendedFor:
        recommendedImageModel === model.id
          ? styleName
            ? t('Recommended for {{value1}}', { value1: styleName })
            : t('Recommended for this style')
          : undefined,
    }));
  }, [
    catalog,
    selectedIds,
    operation,
    referenceCount,
    recommendedImageModel,
    styleName,
    t,
  ]);
  return { models, catalog };
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
} & RecommendationProps &
  ImageCapabilityFilter;

export const ImageModelSelector: React.FC<ImageModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  filterModels,
  recommendedImageModel,
  styleName,
  generatedStatuses,
  operation,
  referenceCount,
}) => {
  const { t } = useTranslation('models');

  const { models: allModels, catalog } = useImageModels({
    recommendedImageModel,
    styleName,
    selectedIds: [selectedModel],
    operation,
    referenceCount,
  });
  const models = useMemo(() => {
    const filtered = filterModels
      ? allModels.filter(
          (m) =>
            isValidTextToImageModel(m.id) &&
            (filterModels.includes(m.id) || m.id === selectedModel)
        )
      : allModels;
    return filtered.map((m) => ({
      ...m,
      generationStatus: generatedStatuses?.get(m.id),
    }));
  }, [allModels, filterModels, generatedStatuses, selectedModel]);
  const status = useMemo(
    () => resolveRecommendation(recommendedImageModel, filterModels, catalog),
    [recommendedImageModel, filterModels, catalog]
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
          if (
            firstId &&
            isSelectableImageModelId(
              firstId,
              catalog,
              operation,
              referenceCount
            )
          ) {
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
} & RecommendationProps &
  ImageCapabilityFilter;

export const ImageModelMultiSelector: React.FC<
  ImageModelMultiSelectorProps
> = ({
  selectedModels,
  onModelsChange,
  disabled = false,
  recommendedImageModel,
  styleName,
  filterModels,
  operation,
  referenceCount,
}) => {
  const { t } = useTranslation('models');

  const { models: allModels, catalog } = useImageModels({
    recommendedImageModel,
    styleName,
    selectedIds: selectedModels,
    operation,
    referenceCount,
  });
  const models = useMemo(
    () =>
      filterModels
        ? allModels.filter(
            (m) =>
              isValidTextToImageModel(m.id) &&
              (filterModels.includes(m.id) || selectedModels.includes(m.id))
          )
        : allModels,
    [allModels, filterModels, selectedModels]
  );
  const status = useMemo(
    () => resolveRecommendation(recommendedImageModel, filterModels, catalog),
    [recommendedImageModel, filterModels, catalog]
  );

  return (
    <div className="flex flex-col gap-1">
      <BaseModelSelector
        label={t('Image Models')}
        models={models}
        groupOrder={SELECTOR_GROUP_ORDER}
        selectedIds={selectedModels}
        onSelectionChange={(ids) => {
          const validIds = ids.filter(
            (id): id is TextToImageModel =>
              isSelectableImageModelId(
                id,
                catalog,
                operation,
                referenceCount
              ) ||
              (isValidTextToImageModel(id) && selectedModels.includes(id))
          );
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
