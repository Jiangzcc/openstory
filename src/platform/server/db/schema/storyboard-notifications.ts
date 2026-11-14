import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { generateId } from '@/platform/id';
import type { StoryboardNotification } from '@/sequences/storyboard-notification';

export const storyboardNotifications = snakeCase.table(
  'storyboard_notifications',
  {
    id: text()
      .$defaultFn(() => generateId())
      .primaryKey()
      .notNull(),
    organizationId: text().notNull(),
    sequenceId: text().notNull(),
    workflowRunId: text({ length: 100 }).notNull(),
    workflowClaimId: text({ length: 100 }),
    notification: text({ mode: 'json' })
      .$type<StoryboardNotification>()
      .notNull(),
    sequenceStatus: text({ enum: ['failed', 'completed'] }).notNull(),
    deliveredAt: integer({ mode: 'timestamp_ms' }),
    lastAttemptAt: integer({ mode: 'timestamp_ms' }),
    createdAt: integer({ mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_storyboard_notifications_owner').on(
      table.organizationId,
      table.sequenceId,
      table.workflowRunId
    ),
    index('idx_storyboard_notifications_pending').on(
      table.deliveredAt,
      table.lastAttemptAt,
      table.createdAt,
      table.id
    ),
  ]
);
