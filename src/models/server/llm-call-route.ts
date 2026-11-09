import type { TextModel } from '@/models/models';
import type { TextModelRoute } from '@/models/text-channels';
import {
  resolveNativeGeminiModel,
  resolveNativeGrokModel,
} from './create-adapter';
import type { LlmKeyInfo } from './create-adapter';

export type LlmCallRoute =
  | { kind: 'compatible'; route: TextModelRoute }
  | { kind: 'xai' | 'google' | 'llmtr' | 'openrouter' };

// The API shape follows the actual key; fal uses the OpenRouter API shape.
export function resolveLlmCallRoute(
  model: TextModel,
  keyInfo?: LlmKeyInfo
): LlmCallRoute {
  if (keyInfo?.via === 'compatible') {
    return { kind: 'compatible', route: keyInfo.route };
  }
  if (resolveNativeGrokModel(model, keyInfo)) return { kind: 'xai' };
  if (resolveNativeGeminiModel(model, keyInfo)) return { kind: 'google' };
  if (keyInfo?.via === 'llmtr') return { kind: 'llmtr' };
  return { kind: 'openrouter' };
}
