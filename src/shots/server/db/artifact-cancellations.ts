import { and, eq, exists, inArray } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  framePromptVersions,
  frameVariants,
  frames,
  sequences,
} from '@/platform/server/db/schema';
import { LIVE_PENDING_STATUSES } from './frame-prompt-versions';
import { UPSTREAM_VISUAL_CANCEL_REASON } from './pending-image-dependency';

const CANCELLED = 'cancelled';
const USER_CANCEL_REASON = 'Cancelled by user';

type CancellationTarget = { versionId: string; frameId: string };
type CancellationResult = {
  cancelled: boolean;
  workflowRunIds: Array<string | null>;
};

function organizationFrames(db: Database, organizationId: string) {
  return db
    .select({ id: frames.id })
    .from(frames)
    .innerJoin(sequences, eq(sequences.id, frames.sequenceId))
    .where(eq(sequences.organizationId, organizationId));
}

function cancelledPrompt(
  db: Database,
  organizationId: string,
  target: CancellationTarget
) {
  return db
    .select({ id: framePromptVersions.id })
    .from(framePromptVersions)
    .where(
      and(
        eq(framePromptVersions.id, target.versionId),
        eq(framePromptVersions.frameId, target.frameId),
        eq(framePromptVersions.status, CANCELLED),
        inArray(
          framePromptVersions.frameId,
          organizationFrames(db, organizationId)
        )
      )
    );
}

function cancelledDependentFrames(
  db: Database,
  organizationId: string,
  target: CancellationTarget
) {
  return db
    .select({ id: frameVariants.frameId })
    .from(frameVariants)
    .where(
      and(
        eq(frameVariants.dependsOnVersionId, target.versionId),
        eq(frameVariants.status, CANCELLED),
        inArray(frameVariants.frameId, organizationFrames(db, organizationId)),
        exists(cancelledPrompt(db, organizationId, target))
      )
    );
}

function cancelledFrameDependent(
  db: Database,
  organizationId: string,
  target: CancellationTarget
) {
  return db
    .select({ id: frameVariants.id })
    .from(frameVariants)
    .where(
      and(
        eq(frameVariants.id, frames.pendingPromoteVersionId),
        eq(frameVariants.frameId, frames.id),
        eq(frameVariants.dependsOnVersionId, target.versionId),
        eq(frameVariants.status, CANCELLED),
        inArray(frameVariants.frameId, organizationFrames(db, organizationId)),
        exists(cancelledPrompt(db, organizationId, target))
      )
    );
}

function cancelPrompt(
  db: Database,
  organizationId: string,
  target: CancellationTarget
) {
  return db
    .update(framePromptVersions)
    .set({ status: CANCELLED })
    .where(
      and(
        eq(framePromptVersions.id, target.versionId),
        eq(framePromptVersions.frameId, target.frameId),
        inArray(framePromptVersions.status, [...LIVE_PENDING_STATUSES]),
        inArray(
          framePromptVersions.frameId,
          organizationFrames(db, organizationId)
        )
      )
    )
    .returning({ workflowRunId: framePromptVersions.workflowRunId });
}

function cancelDependents(
  db: Database,
  organizationId: string,
  target: CancellationTarget
) {
  return db
    .update(frameVariants)
    .set({
      status: CANCELLED,
      error: UPSTREAM_VISUAL_CANCEL_REASON,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(frameVariants.dependsOnVersionId, target.versionId),
        inArray(frameVariants.status, [...LIVE_PENDING_STATUSES]),
        inArray(frameVariants.frameId, organizationFrames(db, organizationId)),
        exists(cancelledPrompt(db, organizationId, target))
      )
    )
    .returning({ workflowRunId: frameVariants.workflowRunId });
}

async function cancelVisualPrompt(
  db: Database,
  organizationId: string,
  target: CancellationTarget
): Promise<CancellationResult> {
  const [prompt, dependents] = await db.batch([
    cancelPrompt(db, organizationId, target),
    cancelDependents(db, organizationId, target),
    db
      .update(frames)
      .set({ pendingPromoteVersionId: null, updatedAt: new Date() })
      .where(
        and(
          inArray(
            frames.id,
            cancelledDependentFrames(db, organizationId, target)
          ),
          exists(cancelledFrameDependent(db, organizationId, target))
        )
      ),
  ]);
  return {
    cancelled: prompt.length > 0,
    workflowRunIds: [...dependents, ...prompt].map((row) => row.workflowRunId),
  };
}

function cancelledImage(
  db: Database,
  organizationId: string,
  target: CancellationTarget
) {
  return db
    .select({ id: frameVariants.id })
    .from(frameVariants)
    .where(
      and(
        eq(frameVariants.id, target.versionId),
        eq(frameVariants.frameId, target.frameId),
        eq(frameVariants.status, CANCELLED),
        inArray(frameVariants.frameId, organizationFrames(db, organizationId))
      )
    );
}

async function cancelImage(
  db: Database,
  organizationId: string,
  target: CancellationTarget
): Promise<CancellationResult> {
  const [images] = await db.batch([
    db
      .update(frameVariants)
      .set({
        status: CANCELLED,
        error: USER_CANCEL_REASON,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(frameVariants.id, target.versionId),
          eq(frameVariants.frameId, target.frameId),
          inArray(frameVariants.status, [...LIVE_PENDING_STATUSES]),
          inArray(frameVariants.frameId, organizationFrames(db, organizationId))
        )
      )
      .returning({ workflowRunId: frameVariants.workflowRunId }),
    db
      .update(frames)
      .set({ pendingPromoteVersionId: null, updatedAt: new Date() })
      .where(
        and(
          eq(frames.id, target.frameId),
          eq(frames.pendingPromoteVersionId, target.versionId),
          exists(cancelledImage(db, organizationId, target))
        )
      ),
  ]);
  return {
    cancelled: images.length > 0,
    workflowRunIds: images.map((row) => row.workflowRunId),
  };
}

export function createArtifactCancellationMethods(
  db: Database,
  organizationId: string
) {
  return {
    cancelVisualPrompt: (target: CancellationTarget) =>
      cancelVisualPrompt(db, organizationId, target),
    cancelImage: (target: CancellationTarget) =>
      cancelImage(db, organizationId, target),
  };
}
