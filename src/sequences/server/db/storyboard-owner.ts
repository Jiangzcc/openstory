import { and, eq, inArray } from 'drizzle-orm';
import { sequences } from '@/platform/server/db/schema';
import type { SequenceStatus } from '@/platform/server/db/schema/sequences';

export const STORYBOARD_WORKFLOW_STATUS = {
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
} as const satisfies Record<string, SequenceStatus>;

export interface StoryboardOwner {
  id: string;
  workflowRunId: string;
  workflowClaimId?: string;
}

export function storyboardOwnerWhere(
  organizationId: string,
  owner: StoryboardOwner
) {
  const runIds = [owner.workflowRunId];
  if (owner.workflowClaimId) runIds.push(owner.workflowClaimId);
  return and(
    eq(sequences.id, owner.id),
    eq(sequences.organizationId, organizationId),
    inArray(sequences.workflowRunId, runIds)
  );
}
