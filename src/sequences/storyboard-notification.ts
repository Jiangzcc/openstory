import type { z } from 'zod';
import type {
  GenerationWorkflowOwner,
  realtimeSchema,
} from '@/platform/realtime/schema';

type NotificationSchemas = {
  'generation.failed': typeof realtimeSchema.generation.failed;
  'generation.reservation:short': (typeof realtimeSchema.generation)['reservation:short'];
  'generation.complete': typeof realtimeSchema.generation.complete;
};

export type StoryboardNotification = {
  [Event in keyof NotificationSchemas]: {
    event: Event;
    data: z.infer<NotificationSchemas[Event]> & {
      workflowOwner: GenerationWorkflowOwner;
    };
  };
}[keyof NotificationSchemas];
