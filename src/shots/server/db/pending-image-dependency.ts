import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  framePromptVersions,
  frames,
  sequences,
} from '@/platform/server/db/schema';
import type { FrameVariant } from '@/platform/server/db/schema';

const PENDING = 'pending';
const CANCELLED = 'cancelled';
export const UPSTREAM_VISUAL_CANCEL_REASON =
  'Upstream visual prompt was cancelled';

type DependencyTarget = {
  frameId: string;
  dependsOnVersionId?: string | null;
  isPrimary: boolean;
};
type DependencyState = {
  status: FrameVariant['status'] | SQL;
  error: string | null | SQL;
  isPrimary: boolean | SQL;
};

function frameOrganization(db: Database, frameId: string) {
  return db
    .select({ organizationId: sequences.organizationId })
    .from(frames)
    .innerJoin(sequences, eq(sequences.id, frames.sequenceId))
    .where(eq(frames.id, frameId));
}

export function pendingImageDependencyState(
  db: Database,
  input: DependencyTarget
): DependencyState {
  const { dependsOnVersionId, frameId, isPrimary } = input;
  if (!dependsOnVersionId) return { status: PENDING, error: null, isPrimary };
  const cancelled = exists(
    db
      .select({ id: framePromptVersions.id })
      .from(framePromptVersions)
      .innerJoin(frames, eq(frames.id, framePromptVersions.frameId))
      .innerJoin(sequences, eq(sequences.id, frames.sequenceId))
      .where(
        and(
          eq(framePromptVersions.id, dependsOnVersionId),
          eq(framePromptVersions.status, CANCELLED),
          inArray(sequences.organizationId, frameOrganization(db, frameId))
        )
      )
  );
  return {
    isPrimary: sql`case when ${cancelled} then false else ${Number(isPrimary)} end`,
    status: sql`case when ${cancelled} then ${CANCELLED} else ${PENDING} end`,
    error: sql`case when ${cancelled} then ${UPSTREAM_VISUAL_CANCEL_REASON} else null end`,
  };
}
