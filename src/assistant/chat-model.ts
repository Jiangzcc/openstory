/**
 * Which model answers a chat turn (#2155). The user picks one in the
 * composer; the pick rides in `forwardedProps.model`. No pick means the
 * default; a pick that is not a selectable analysis model is refused, since
 * the composer only ever sends a selectable one. A vendor the request's
 * country cannot reach is swapped the way sequences swap it.
 */
import {
  DEFAULT_ANALYSIS_MODEL,
  isCustomAnalysisModelId,
  type AnalysisModelDefinition,
  type AnalysisModelId,
} from '@/models/models.config';
import {
  getTextModelDefinition,
  isSelectableTextModelId,
} from '@/models/text-model-catalog';
import { resolveModelForCountry } from '@/models/region-policy';
import { ValidationError } from '@/platform/errors';

export function chatModelFor(
  requested: unknown,
  country: string | null | undefined,
  extraModels: readonly AnalysisModelDefinition[] = [],
  defaultModel: AnalysisModelId = DEFAULT_ANALYSIS_MODEL
): AnalysisModelId {
  const candidate = requested === undefined ? defaultModel : requested;
  if (!isSelectableTextModelId(candidate, extraModels)) {
    throw new ValidationError('model is not one the assistant can run on.');
  }
  const model = extraModels.some((entry) => entry.id === candidate)
    ? candidate
    : resolveModelForCountry(candidate, country);
  const definition = getTextModelDefinition(model, extraModels);
  if (
    definition?.tools === false ||
    (isCustomAnalysisModelId(model) && !definition?.tools)
  ) {
    throw new ValidationError('The assistant model must support tools.');
  }
  return model;
}
