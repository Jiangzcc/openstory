import type { ScopedDb } from '@/platform/server/db/scoped';
import { readInstanceIfExists } from '@/platform/server/workflow/run-outcome';
import { resolveRunState } from '@/platform/server/workflow/reconcile';
import { triggerPreparedWorkflow } from '@/platform/server/workflow/prepared-trigger';

export async function resolveStoryboardRunState(
  scopedDb: Pick<ScopedDb, 'sequences'>,
  sequence: { id: string; workflowRunId: string }
): Promise<'failed' | 'completed' | 'unknown' | null> {
  const launch = await scopedDb.sequences.getWorkflowLaunch({
    id: sequence.id,
    workflowRunId: sequence.workflowRunId,
  });
  if (!launch) return resolveRunState(sequence.workflowRunId);
  const read = await readInstanceIfExists(launch.workflowRunId);
  if (read.kind === 'unreadable' || read.kind === 'no_binding')
    return 'unknown';
  if (read.kind === 'missing') {
    if (launch.submittedAt !== null) return 'failed';
    await triggerPreparedWorkflow(launch.prepared);
    await scopedDb.sequences.publishWorkflowInstance({
      id: sequence.id,
      claimId: launch.workflowRunId,
      workflowRunId: launch.workflowRunId,
    });
    return null;
  }
  if (launch.submittedAt === null) {
    await scopedDb.sequences.publishWorkflowInstance({
      id: sequence.id,
      claimId: launch.workflowRunId,
      workflowRunId: launch.workflowRunId,
    });
  }
  if (read.status === 'complete') return 'completed';
  if (read.status === 'errored' || read.status === 'terminated')
    return 'failed';
  if (read.status === 'unknown') return 'unknown';
  return null;
}
