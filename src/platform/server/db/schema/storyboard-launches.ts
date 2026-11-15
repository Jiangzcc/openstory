import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { generateId } from '@/platform/id';
import type { WorkflowModelConfiguration } from '@/models/model-runtime-configuration';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';

type HistoricalStoryboardLaunch = {
  readonly workflowRunId: string;
  readonly triggerPath: string;
  readonly body: StoryboardWorkflowInput & {
    readonly modelConfiguration: WorkflowModelConfiguration;
  };
};

export const storyboardLaunches = snakeCase.table(
  'storyboard_launches',
  {
    id: text()
      .$defaultFn(() => generateId())
      .primaryKey()
      .notNull(),
    organizationId: text().notNull(),
    sequenceId: text().notNull(),
    workflowRunId: text({ length: 100 }).notNull(),
    prepared: text({ mode: 'json' })
      .$type<HistoricalStoryboardLaunch>()
      .notNull(),
    submittedAt: integer({ mode: 'timestamp' }),
    lastAttemptAt: integer({ mode: 'timestamp' }),
    createdAt: integer({ mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_storyboard_launches_run').on(table.workflowRunId),
    index('idx_storyboard_launches_pending').on(
      table.submittedAt,
      table.lastAttemptAt,
      table.createdAt,
      table.id
    ),
    index('idx_storyboard_launches_sequence').on(
      table.organizationId,
      table.sequenceId
    ),
  ]
);
