import type { ChatMiddleware, ModelMessage, UIMessage } from '@tanstack/ai';
import { ValidationError } from '@/platform/errors';
import type { PageContextItem } from '../page-context';

type AssistantMessage = UIMessage | ModelMessage;

export function requireAssistantVision(
  messages: ReadonlyArray<AssistantMessage>,
  items: ReadonlyArray<PageContextItem>,
  supportsVision: boolean
): void {
  if (supportsVision) return;
  const hasImage =
    items.some((item) => item.image) ||
    messages.some((message) => {
      const parts = 'parts' in message ? message.parts : message.content;
      return (
        Array.isArray(parts) && parts.some((part) => part.type === 'image')
      );
    });
  if (hasImage) {
    throw new ValidationError(
      'The assistant model must support vision for image context.'
    );
  }
}

export function assistantVisionMiddleware(
  supportsVision: boolean
): ChatMiddleware {
  return {
    name: 'assistant-vision-validation',
    onConfig: (_ctx, config) => {
      requireAssistantVision(config.messages, [], supportsVision);
    },
  };
}
