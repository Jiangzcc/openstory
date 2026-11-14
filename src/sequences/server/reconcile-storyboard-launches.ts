import type { SequenceReconcileRow } from '@/platform/server/cron/reconcile-all';
import type { Database } from '@/platform/server/db/client';
import { getLogger } from '@/platform/logger';
import { triggerPreparedWorkflow } from '@/platform/server/workflow/prepared-trigger';
import { resolveRunState } from '@/platform/server/workflow/reconcile';
import { readInstanceIfExists } from '@/platform/server/workflow/run-outcome';
import {
  confirmStoryboardLaunchSubmitted,
  deleteOrphanedStoryboardLaunches,
  hasPendingStoryboardLaunch,
  listPendingStoryboardLaunches,
  markStoryboardLaunchAttempt,
} from './db/storyboard-launch-reconcile';

const logger = getLogger(['openstory', 'sequences', 'reconcile-launches']);
const MAX_LAUNCHES_PER_PASS = 100;

export async function reconcileStoryboardLaunches(
  db: Database,
  limit = MAX_LAUNCHES_PER_PASS
): Promise<number> {
  const deleted = await deleteOrphanedStoryboardLaunches(
    db,
    MAX_LAUNCHES_PER_PASS
  );
  if (deleted > 0)
    logger.info('Removed orphaned storyboard launches', { deleted });
  const launches = await listPendingStoryboardLaunches(db, limit);
  const failures: unknown[] = [];
  let confirmed = 0;
  for (const launch of launches) {
    try {
      if (!(await markStoryboardLaunchAttempt(db, launch))) continue;
      await triggerPreparedWorkflow(launch.prepared);
      if (await confirmStoryboardLaunchSubmitted(db, launch)) confirmed++;
    } catch (error) {
      logger.error('Pending storyboard launch was not confirmed', {
        workflowRunId: launch.workflowRunId,
        err: error,
      });
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Pending storyboard dispatch failed');
  }
  return confirmed;
}

export async function resolveStoryboardSequenceState(
  db: Database,
  row: SequenceReconcileRow
): ReturnType<typeof resolveRunState> {
  if (
    !row.runId ||
    !(await hasPendingStoryboardLaunch(db, {
      id: row.id,
      organizationId: row.organizationId,
      workflowRunId: row.runId,
    }))
  )
    return resolveRunState(row.runId ?? '');
  // Missing is inconclusive while this exact instance can still be submitted.
  const read = await readInstanceIfExists(row.runId);
  if (read.kind !== 'read') return 'unknown';
  if (read.status === 'complete') return 'completed';
  if (read.status === 'errored' || read.status === 'terminated')
    return 'failed';
  return null;
}
