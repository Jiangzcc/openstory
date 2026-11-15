import { getMaxOutputTokens } from '@/models/models.config';
import { configuredTextOutputBudget } from './configured-text';
import type { LlmKeyInfo } from './create-adapter';

export function getLlmMaxOutputTokens(
  model: string,
  key: LlmKeyInfo,
  fraction: number
): number {
  if (key.via === 'compatible' && key.route.modelId === model) {
    return configuredTextOutputBudget(key.route, { fraction });
  }
  return getMaxOutputTokens(model, fraction);
}
