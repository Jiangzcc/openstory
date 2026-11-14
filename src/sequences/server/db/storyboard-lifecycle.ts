import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { sequenceEvents, sequences, shots } from '@/platform/server/db/schema';
import type { SequenceStatus } from '@/platform/server/db/schema/sequences';
import type { GenerationStage } from '@/sequences/pipeline';
import {
  buildEventInsertIfPresent,
  SETTINGS_CHANGED_EVENT,
} from './sequence-events';
import { generationStopChangedSummary } from '@/sequences/model-label';

const WORKFLOW_STATUS = {
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
} as const satisfies Record<string, SequenceStatus>;

interface StoryboardOwner {
  id: string;
  workflowRunId: string;
  workflowClaimId?: string;
}

function ownerWhere(organizationId: string, owner: StoryboardOwner) {
  const runIds = [owner.workflowRunId];
  if (owner.workflowClaimId) runIds.push(owner.workflowClaimId);
  return and(
    eq(sequences.id, owner.id),
    eq(sequences.organizationId, organizationId),
    inArray(sequences.workflowRunId, runIds)
  );
}

function processingWhere(organizationId: string, owner: StoryboardOwner) {
  return and(
    ownerWhere(organizationId, owner),
    eq(sequences.status, WORKFLOW_STATUS.processing)
  );
}

function completionWhere(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner & { eventId: string }
) {
  return and(
    ownerWhere(organizationId, owner),
    eq(sequences.status, WORKFLOW_STATUS.completed),
    exists(
      db
        .select({ id: sequenceEvents.id })
        .from(sequenceEvents)
        .where(
          and(
            eq(sequenceEvents.id, owner.eventId),
            eq(sequenceEvents.sequenceId, owner.id),
            eq(sequenceEvents.kind, 'storyboard.completed')
          )
        )
    )
  );
}

function startHistory(
  db: Database,
  userId: string,
  params: StoryboardOwner & { stopAt: GenerationStage },
  where: SQL | undefined
) {
  return buildEventInsertIfPresent(
    db,
    {
      id: generateId(),
      sequenceId: params.id,
      actorId: userId,
      kind: SETTINGS_CHANGED_EVENT,
      targetType: 'sequence',
      targetId: params.id,
      summary: generationStopChangedSummary(params.stopAt),
    },
    sequences,
    and(
      where,
      or(
        isNull(sequences.generationStopAt),
        ne(sequences.generationStopAt, params.stopAt)
      )
    ),
    sql`json_object(
    'fields', json_array('generationStopAt'),
    'changes', json_array(json_object(
      'field', 'generationStopAt',
      'from', ${sequences.generationStopAt},
      'to', ${params.stopAt}
    ))
  )`
  );
}

export function createStoryboardLifecycleMethods(
  db: Database,
  organizationId: string,
  userId: string
) {
  return {
    startWorkflowIfCurrent: async (
      params: StoryboardOwner & { stopAt: GenerationStage; resume: boolean }
    ): Promise<boolean> => {
      const where = processingWhere(organizationId, params);
      const start = db
        .update(sequences)
        .set({
          status: WORKFLOW_STATUS.processing,
          statusError: null,
          generationStopAt: params.stopAt,
          updatedAt: new Date(),
        })
        .where(where)
        .returning({ id: sequences.id });
      const history = startHistory(db, userId, params, where);
      if (params.resume) {
        const [, started] = await db.batch([history, start]);
        return started.length > 0;
      }
      const [, started] = await db.batch([
        history,
        start,
        db
          .delete(shots)
          .where(
            and(
              eq(shots.sequenceId, params.id),
              exists(
                db.select({ id: sequences.id }).from(sequences).where(where)
              )
            )
          ),
      ]);
      return started.length > 0;
    },

    failWorkflowIfCurrent: async (
      params: StoryboardOwner & { error: string }
    ): Promise<boolean> => {
      const [updated] = await db
        .update(sequences)
        .set({
          status: WORKFLOW_STATUS.failed,
          statusError: params.error,
          updatedAt: new Date(),
        })
        .where(
          and(
            ownerWhere(organizationId, params),
            not(
              inArray(sequences.status, [
                WORKFLOW_STATUS.failed,
                WORKFLOW_STATUS.completed,
              ])
            )
          )
        )
        .returning({ id: sequences.id });
      return Boolean(updated);
    },

    completeWorkflowIfCurrent: async (
      params: StoryboardOwner & { eventId: string }
    ): Promise<boolean> => {
      const where = processingWhere(organizationId, params);
      const [, , completed] = await db.batch([
        buildEventInsertIfPresent(
          db,
          {
            id: params.eventId,
            sequenceId: params.id,
            actorId: userId,
            kind: 'storyboard.completed',
            targetType: 'sequence',
            targetId: params.id,
            summary: 'Finished the storyboard',
          },
          sequences,
          where
        ),
        db
          .update(sequences)
          .set({
            status: WORKFLOW_STATUS.completed,
            statusError: null,
            updatedAt: new Date(),
          })
          .where(where),
        db
          .select({ id: sequences.id })
          .from(sequences)
          .where(completionWhere(db, organizationId, params)),
      ]);
      return completed.length > 0;
    },
  };
}
