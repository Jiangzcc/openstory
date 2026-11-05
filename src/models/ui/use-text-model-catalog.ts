import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAnalysisModelById,
  isCustomAnalysisModelId,
  isSelectableAnalysisModelId,
  type AnalysisModelDefinition,
} from '../models.config';
import { textModelCatalogQueryOptions } from '../text-channels.queries';
import { mergeTextModelCatalog } from '../text-model-catalog';

export type TextModelCapability = 'vision' | 'structuredOutput' | 'tools';

export type TextModelCatalogState = {
  models: readonly AnalysisModelDefinition[];
  isReady: boolean;
  error: Error | null;
};

const CAPABILITY_LABELS: Record<TextModelCapability, string> = {
  vision: 'image input',
  structuredOutput: 'structured output',
  tools: 'tools',
};

export function textModelSupportsCapability(
  model: AnalysisModelDefinition,
  capability: TextModelCapability
): boolean {
  return capability === 'vision' ? model.vision : model[capability] !== false;
}

export function textModelSelectionError(
  selectedIds: readonly string[],
  catalog: TextModelCatalogState,
  capability?: TextModelCapability
): Error | null {
  for (const id of selectedIds) {
    if (isCustomAnalysisModelId(id)) {
      if (catalog.error)
        return new Error('Could not load text models. Try again.');
      if (!catalog.isReady) return new Error('Text model catalog is loading.');
    }
    const model = getAnalysisModelById(id, catalog.models);
    if (!model || !isSelectableAnalysisModelId(id, catalog.models)) {
      return new Error(
        `Text model "${id}" is unavailable. Select an available model.`
      );
    }
    if (capability && !textModelSupportsCapability(model, capability)) {
      return new Error(
        `Text model "${id}" does not support ${CAPABILITY_LABELS[capability]}. Select a compatible model.`
      );
    }
  }
  return null;
}

export function useTextModelCatalog() {
  const query = useQuery({
    ...textModelCatalogQueryOptions,
    throwOnError: false,
  });
  const models = useMemo(
    () => mergeTextModelCatalog(query.data ?? []),
    [query.data]
  );
  const configuredIds = useMemo(
    () => new Set((query.data ?? []).map((model) => model.id)),
    [query.data]
  );
  return {
    models,
    configuredIds,
    isReady: query.data !== undefined,
    error: query.error,
  };
}
