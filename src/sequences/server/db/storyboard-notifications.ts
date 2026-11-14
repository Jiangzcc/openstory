import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  organization,
  sequences,
  storyboardNotifications,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { ValidationError } from '@/platform/errors';
import type { StoryboardNotification } from '@/sequences/storyboard-notification';
import type { StoryboardOwner } from './storyboard-owner';

export type StoryboardNotificationReceipt =
  typeof storyboardNotifications.$inferSelect;
type TerminalStatus = StoryboardNotificationReceipt['sequenceStatus'];

function currentOwner(db: Database) {
  return db
    .select({ id: sequences.id })
    .from(sequences)
    .innerJoin(organization, eq(organization.id, sequences.organizationId))
    .where(
      and(
        eq(sequences.id, storyboardNotifications.sequenceId),
        eq(sequences.organizationId, storyboardNotifications.organizationId),
        eq(sequences.status, storyboardNotifications.sequenceStatus),
        or(
          eq(sequences.workflowRunId, storyboardNotifications.workflowRunId),
          eq(sequences.workflowRunId, storyboardNotifications.workflowClaimId)
        )
      )
    );
}

function notificationOwner(organizationId: string, owner: StoryboardOwner) {
  return and(
    eq(storyboardNotifications.organizationId, organizationId),
    eq(storyboardNotifications.sequenceId, owner.id),
    eq(storyboardNotifications.workflowRunId, owner.workflowRunId)
  );
}

function assertNotificationOwner(
  owner: StoryboardOwner,
  notification: StoryboardNotification
) {
  const recorded = notification.data.workflowOwner;
  if (
    recorded.workflowRunId !== owner.workflowRunId ||
    recorded.workflowClaimId !== owner.workflowClaimId ||
    (notification.event === 'generation.complete' &&
      notification.data.sequenceId !== owner.id)
  ) {
    throw new ValidationError(
      'Storyboard notification does not match its workflow owner'
    );
  }
}

const bound = <T>(value: unknown, name: string) => sql<T>`${value}`.as(name);

export function buildStoryboardNotificationInsert(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner,
  notification: StoryboardNotification,
  status: TerminalStatus,
  where: SQL | undefined
) {
  assertNotificationOwner(owner, notification);
  return db
    .insert(storyboardNotifications)
    .select(
      db
        .select({
          id: bound<string>(generateId(), 'id'),
          organizationId: bound<string>(organizationId, 'organization_id'),
          sequenceId: bound<string>(owner.id, 'sequence_id'),
          workflowRunId: bound<string>(owner.workflowRunId, 'workflow_run_id'),
          workflowClaimId: bound<string | null>(
            owner.workflowClaimId ?? null,
            'workflow_claim_id'
          ),
          notification: bound<StoryboardNotification>(
            JSON.stringify(notification),
            'notification'
          ),
          sequenceStatus: bound<TerminalStatus>(status, 'sequence_status'),
          deliveredAt: bound<Date | null>(null, 'delivered_at'),
          lastAttemptAt: bound<Date | null>(null, 'last_attempt_at'),
          createdAt: bound<Date>(Date.now(), 'created_at'),
        })
        .from(sequences)
        .where(where)
        .limit(1)
    )
    .onConflictDoNothing();
}

async function beginAttempt(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const [receipt] = await db
    .update(storyboardNotifications)
    .set({ lastAttemptAt: new Date() })
    .where(
      and(
        notificationOwner(organizationId, owner),
        isNull(storyboardNotifications.deliveredAt),
        exists(currentOwner(db))
      )
    )
    .returning();
  return receipt;
}

async function confirmDelivery(
  db: Database,
  organizationId: string,
  receipt: StoryboardNotificationReceipt
) {
  const confirmed = await db
    .update(storyboardNotifications)
    .set({ deliveredAt: new Date() })
    .where(
      and(
        eq(storyboardNotifications.id, receipt.id),
        notificationOwner(organizationId, {
          id: receipt.sequenceId,
          workflowRunId: receipt.workflowRunId,
        }),
        isNull(storyboardNotifications.deliveredAt)
      )
    )
    .returning({ id: storyboardNotifications.id });
  return confirmed.length > 0;
}

export function createStoryboardNotificationMethods(
  db: Database,
  organizationId: string
) {
  return {
    beginWorkflowNotificationAttempt: (owner: StoryboardOwner) =>
      beginAttempt(db, organizationId, owner),
    confirmWorkflowNotificationDelivery: (
      receipt: StoryboardNotificationReceipt
    ) => confirmDelivery(db, organizationId, receipt),
  };
}

export async function listPendingStoryboardNotifications(
  db: Database,
  limit: number
) {
  return db
    .select()
    .from(storyboardNotifications)
    .where(
      and(isNull(storyboardNotifications.deliveredAt), exists(currentOwner(db)))
    )
    .orderBy(
      asc(storyboardNotifications.lastAttemptAt),
      asc(storyboardNotifications.createdAt),
      asc(storyboardNotifications.id)
    )
    .limit(limit);
}

export async function deleteObsoleteStoryboardNotifications(
  db: Database,
  limit: number
) {
  const ids = db
    .select({ id: storyboardNotifications.id })
    .from(storyboardNotifications)
    .where(notExists(currentOwner(db)))
    .orderBy(asc(storyboardNotifications.id))
    .limit(limit);
  const deleted = await db
    .delete(storyboardNotifications)
    .where(inArray(storyboardNotifications.id, ids))
    .returning({ id: storyboardNotifications.id });
  return deleted.length;
}
