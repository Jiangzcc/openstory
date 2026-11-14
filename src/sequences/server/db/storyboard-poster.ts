import { and, eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { sequences } from '@/platform/server/db/schema';
import {
  STORYBOARD_WORKFLOW_STATUS,
  storyboardOwnerWhere,
} from './storyboard-owner';
import type { StoryboardOwner } from './storyboard-owner';

export function createStoryboardPosterMethods(
  db: Database,
  organizationId: string
) {
  return {
    setPosterIfCurrent: async (
      params: StoryboardOwner & { posterUrl: string }
    ): Promise<boolean> => {
      const updated = await db
        .update(sequences)
        .set({ posterUrl: params.posterUrl, updatedAt: new Date() })
        .where(
          and(
            storyboardOwnerWhere(organizationId, params),
            eq(sequences.status, STORYBOARD_WORKFLOW_STATUS.processing)
          )
        )
        .returning({ id: sequences.id });
      return updated.length > 0;
    },
  };
}
