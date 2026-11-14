import { and, eq } from 'drizzle-orm';
import type { AutoStyleDraft } from '@/look/auto-style';
import type { Database } from '@/platform/server/db/client';
import { styles } from '@/platform/server/db/schema';
import type { StoryboardContentScope } from '@/sequences/server/db/storyboard-content-scope';

export function createAutomaticStyleWriter(
  db: Database,
  organizationId: string,
  scope?: StoryboardContentScope
) {
  return async (params: {
    styleId: string;
    sequenceId: string;
    draft: AutoStyleDraft;
  }): Promise<boolean> => {
    const rows = await db
      .update(styles)
      .set({ ...params.draft, updatedAt: new Date() })
      .where(
        and(
          eq(styles.id, params.styleId),
          eq(styles.sequenceId, params.sequenceId),
          eq(styles.organizationId, organizationId),
          scope?.sequence(styles.sequenceId)
        )
      )
      .returning({ id: styles.id });
    return rows.length > 0;
  };
}
