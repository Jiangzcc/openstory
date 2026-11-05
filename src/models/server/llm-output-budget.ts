import { getMaxOutputTokens } from '@/models/models.config';
import { textModelCatalogFromRouting } from '@/models/text-model-catalog';
import type { LlmKeyInfo } from './create-adapter';

export function getLlmMaxOutputTokens(
  model: string,
  key: LlmKeyInfo,
  fraction: number
): number {
  const models =
    key.via === 'compatible' ? textModelCatalogFromRouting([key.route]) : [];
  return getMaxOutputTokens(model, fraction, models);
}
