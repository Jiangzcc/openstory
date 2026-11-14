import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  or,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  organization,
  sequences,
  storyboardLaunches,
} from '@/platform/server/db/schema';

const PROCESSING_STATUS = 'processing';
type LaunchOwner = Pick<
  typeof storyboardLaunches.$inferSelect,
  'id' | 'organizationId' | 'sequenceId' | 'workflowRunId'
>;

function currentOwner(db: Database, requireProcessing = false) {
  return db
    .select({ id: sequences.id })
    .from(sequences)
    .innerJoin(organization, eq(organization.id, sequences.organizationId))
    .where(
      and(
        eq(sequences.id, storyboardLaunches.sequenceId),
        eq(sequences.organizationId, storyboardLaunches.organizationId),
        eq(sequences.workflowRunId, storyboardLaunches.workflowRunId),
        requireProcessing ? eq(sequences.status, PROCESSING_STATUS) : undefined
      )
    );
}

function matchesLaunch(launch: LaunchOwner) {
  return and(
    eq(storyboardLaunches.id, launch.id),
    eq(storyboardLaunches.organizationId, launch.organizationId),
    eq(storyboardLaunches.sequenceId, launch.sequenceId),
    eq(storyboardLaunches.workflowRunId, launch.workflowRunId)
  );
}

export async function hasPendingStoryboardLaunch(
  db: Database,
  owner: { id: string; organizationId: string; workflowRunId: string }
): Promise<boolean> {
  const [launch] = await db
    .select({ id: storyboardLaunches.id })
    .from(storyboardLaunches)
    .where(
      and(
        eq(storyboardLaunches.sequenceId, owner.id),
        eq(storyboardLaunches.organizationId, owner.organizationId),
        eq(storyboardLaunches.workflowRunId, owner.workflowRunId),
        isNull(storyboardLaunches.submittedAt),
        exists(currentOwner(db))
      )
    )
    .limit(1);
  return Boolean(launch);
}

export function deleteStoryboardLaunchesForSequences(db: Database, where: SQL) {
  const ids = db.select({ id: sequences.id }).from(sequences).where(where);
  return db
    .delete(storyboardLaunches)
    .where(inArray(storyboardLaunches.sequenceId, ids));
}

export async function listPendingStoryboardLaunches(
  db: Database,
  limit: number
) {
  return db
    .select({
      id: storyboardLaunches.id,
      organizationId: storyboardLaunches.organizationId,
      sequenceId: storyboardLaunches.sequenceId,
      workflowRunId: storyboardLaunches.workflowRunId,
      prepared: storyboardLaunches.prepared,
    })
    .from(storyboardLaunches)
    .where(
      and(
        isNull(storyboardLaunches.submittedAt),
        exists(currentOwner(db, true))
      )
    )
    .orderBy(
      asc(storyboardLaunches.lastAttemptAt),
      asc(storyboardLaunches.createdAt),
      asc(storyboardLaunches.id)
    )
    .limit(limit);
}

export async function markStoryboardLaunchAttempt(
  db: Database,
  launch: LaunchOwner
): Promise<boolean> {
  const [attempted] = await db
    .update(storyboardLaunches)
    .set({ lastAttemptAt: new Date() })
    .where(
      and(
        matchesLaunch(launch),
        isNull(storyboardLaunches.submittedAt),
        exists(currentOwner(db, true))
      )
    )
    .returning({ id: storyboardLaunches.id });
  return Boolean(attempted);
}

export async function confirmStoryboardLaunchSubmitted(
  db: Database,
  launch: LaunchOwner
): Promise<boolean> {
  const [confirmed] = await db
    .update(storyboardLaunches)
    .set({ submittedAt: new Date() })
    .where(
      and(
        matchesLaunch(launch),
        isNull(storyboardLaunches.submittedAt),
        exists(currentOwner(db))
      )
    )
    .returning({ id: storyboardLaunches.id });
  return Boolean(confirmed);
}

function orphanedLaunch(db: Database) {
  return or(
    notExists(
      db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, storyboardLaunches.organizationId))
    ),
    notExists(
      db
        .select({ id: sequences.id })
        .from(sequences)
        .where(
          and(
            eq(sequences.id, storyboardLaunches.sequenceId),
            eq(sequences.organizationId, storyboardLaunches.organizationId)
          )
        )
    )
  );
}

export async function deleteOrphanedStoryboardLaunches(
  db: Database,
  limit: number
): Promise<number> {
  const ids = db
    .select({ id: storyboardLaunches.id })
    .from(storyboardLaunches)
    .where(orphanedLaunch(db))
    .orderBy(asc(storyboardLaunches.createdAt), asc(storyboardLaunches.id))
    .limit(limit);
  const deleted = await db
    .delete(storyboardLaunches)
    .where(inArray(storyboardLaunches.id, ids))
    .returning({ id: storyboardLaunches.id });
  return deleted.length;
}
