import {
  SCRIPT_ANALYSIS_MODELS,
  isCustomAnalysisModelId,
} from './models.config';
import type { AnalysisModelDefinition } from './models.config';
import { toTextModelCatalog } from './text-channels';
import type {
  TextModelCatalogEntry,
  TextModelRoutingSnapshot,
} from './text-channels';

const CONFIGURED_MODEL_DEFAULTS = {
  vendor: 'Custom',
  description: '',
  license: 'proprietary',
  qualityRank: 1_000,
} as const;

function toAnalysisModel(
  entry: TextModelCatalogEntry
): AnalysisModelDefinition {
  const builtin = SCRIPT_ANALYSIS_MODELS.find((model) => model.id === entry.id);
  if (!builtin && !isCustomAnalysisModelId(entry.id)) {
    throw new Error('Unknown configured text model identifier.');
  }
  const fallback = builtin ?? CONFIGURED_MODEL_DEFAULTS;
  return {
    id: entry.id,
    name: entry.name,
    vendor: entry.vendor ?? fallback.vendor,
    description: entry.description ?? fallback.description,
    license: fallback.license,
    qualityRank: fallback.qualityRank,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    vision: entry.vision,
    structuredOutput: entry.structuredOutput,
    tools: entry.tools,
    ...(builtin && 'hidden' in builtin && { hidden: builtin.hidden }),
  };
}

export function mergeTextModelCatalog(
  entries: readonly TextModelCatalogEntry[] = []
): AnalysisModelDefinition[] {
  const catalog = new Map<string, AnalysisModelDefinition>(
    SCRIPT_ANALYSIS_MODELS.map((model) => [model.id, model])
  );
  for (const entry of entries) catalog.set(entry.id, toAnalysisModel(entry));
  return [...catalog.values()];
}

export function textModelCatalogFromRouting(
  snapshot: TextModelRoutingSnapshot = []
): AnalysisModelDefinition[] {
  return toTextModelCatalog(snapshot).map(toAnalysisModel);
}
