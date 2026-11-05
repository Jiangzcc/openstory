import { useTranslation } from 'react-i18next';
import { BaseModelSelector } from './base-model-selector';
import { getRequestCountryFn } from '@/models/ai.fn';
import type { AnalysisModelId } from '@/models/models.config';
import {
  compareSelectorModels,
  QUALITY_DEFAULT_ANALYSIS,
  SELECTOR_GROUP_ORDER,
  selectorGroup,
  TURBO_ANALYSIS_MODELS,
} from '@/models/generation-mode';
import {
  isRegionBlockedModel,
  resolveModelForCountry,
} from '@/models/region-policy';
import {
  textModelSelectionError,
  textModelSupportsCapability,
  useTextModelCatalog,
  type TextModelCapability,
} from '../use-text-model-catalog';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

type ModelSelectorProps = {
  selectedModels: AnalysisModelId[];
  onModelsChange: (models: AnalysisModelId[]) => void;
  disabled?: boolean;
  singleSelect?: boolean;
  /** When set, only these ids appear. */
  allowedIds?: readonly AnalysisModelId[];
  capability?: TextModelCapability;
  size?: 'default' | 'sm';
  variant?: 'outline' | 'ghost';
};

function selectableModels(
  catalog: ReturnType<typeof useTextModelCatalog>,
  country: string | null | undefined,
  capability: TextModelCapability,
  allowedIds?: readonly AnalysisModelId[]
) {
  const ranks = new Map<string, number>(
    catalog.models.map((model) => [model.id, model.qualityRank])
  );
  return catalog.models
    .filter((model) => !model.hidden)
    .filter((model) => textModelSupportsCapability(model, capability))
    .filter(
      (model) =>
        catalog.configuredIds.has(model.id) ||
        !isRegionBlockedModel(model.id, country)
    )
    .filter((model) => !allowedIds || allowedIds.includes(model.id))
    .sort((a, b) =>
      compareSelectorModels(
        a.id,
        b.id,
        TURBO_ANALYSIS_MODELS,
        QUALITY_DEFAULT_ANALYSIS,
        (id) => ranks.get(id) ?? Number.MAX_SAFE_INTEGER
      )
    )
    .map((model) => ({
      id: model.id,
      name: model.name,
      group: selectorGroup(model.id, TURBO_ANALYSIS_MODELS),
      badge: model.license,
    }));
}

function useRegionSelection(
  country: string | null | undefined,
  selectedModels: AnalysisModelId[],
  onModelsChange: ModelSelectorProps['onModelsChange'],
  catalog: ReturnType<typeof useTextModelCatalog>
) {
  useEffect(() => {
    if (!country || !catalog.isReady) return;
    const remapped = [
      ...new Set(
        selectedModels.map((model) =>
          catalog.configuredIds.has(model)
            ? model
            : resolveModelForCountry(model, country)
        )
      ),
    ];
    const changed =
      remapped.length !== selectedModels.length ||
      remapped.some((model, index) => model !== selectedModels[index]);
    if (changed) onModelsChange(remapped);
  }, [
    country,
    selectedModels,
    onModelsChange,
    catalog.isReady,
    catalog.configuredIds,
  ]);
}

function useTextModelPicker({
  selectedModels,
  onModelsChange,
  allowedIds,
  capability = 'structuredOutput',
}: ModelSelectorProps) {
  const catalog = useTextModelCatalog();
  const { data: country } = useQuery({
    queryKey: ['request-country'],
    queryFn: () => getRequestCountryFn(),
    staleTime: Infinity,
  });
  useRegionSelection(country, selectedModels, onModelsChange, catalog);
  const available = useMemo(
    () => selectableModels(catalog, country, capability, allowedIds),
    [catalog, country, capability, allowedIds]
  );
  const unavailable = selectedModels
    .filter((id) => !available.some((model) => model.id === id))
    .map((id) => ({
      id,
      name: id,
      group: selectorGroup(id, TURBO_ANALYSIS_MODELS),
    }));
  const onSelectionChange = (ids: string[]) => {
    const valid = ids.filter(
      (id): id is AnalysisModelId =>
        selectedModels.some((selected) => selected === id) ||
        available.some((model) => model.id === id)
    );
    if (valid.length > 0 && valid.length === ids.length) onModelsChange(valid);
  };
  return {
    models: [...available, ...unavailable],
    error: textModelSelectionError(selectedModels, catalog, capability),
    onSelectionChange,
  };
}

export const ModelSelector: React.FC<ModelSelectorProps> = (props) => {
  const { t } = useTranslation('models');
  const { models, error, onSelectionChange } = useTextModelPicker(props);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <BaseModelSelector
        label={t('Analysis Model')}
        models={models}
        groupOrder={SELECTOR_GROUP_ORDER}
        selectedIds={props.selectedModels}
        onSelectionChange={onSelectionChange}
        disabled={props.disabled}
        multiSelect={!props.singleSelect}
        size={props.size}
        variant={props.variant}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
};
