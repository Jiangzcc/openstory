import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { parseStyleConfig } from '@/look/style-config';
import { ValidationError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  sequences,
  sequenceStyleVersions,
  styles,
} from '@/platform/server/db/schema';
import type {
  SequenceStyleSource,
  StoredStyleConfig,
} from '@/platform/server/db/schema';
import { insertWithStoryboardGuard } from './storyboard-content-scope';
import type { StoryboardContentScope } from './storyboard-content-scope';

export function insertStyleVersion(
  db: Database,
  row: {
    id: string;
    sequenceId: string;
    styleId: string;
    config: StoredStyleConfig;
    source: SequenceStyleSource;
    createdBy: string | null;
  },
  guard?: SQL
) {
  return insertWithStoryboardGuard(db, sequenceStyleVersions, [row], guard);
}

export async function snapshotConfigForStyleId(db: Database, styleId: string) {
  const [style] = await db
    .select({ config: styles.config })
    .from(styles)
    .where(eq(styles.id, styleId))
    .limit(1);
  if (!style) throw new ValidationError(`Style ${styleId} not found`);
  return parseStyleConfig(style.config);
}

export function createAutoStyleSnapshotWriter(
  db: Database,
  organizationId: string,
  scope?: StoryboardContentScope
) {
  return async (params: { id: string; styleId: string }): Promise<boolean> => {
    const styleConfig = await snapshotConfigForStyleId(db, params.styleId);
    const still = and(
      eq(sequences.id, params.id),
      eq(sequences.organizationId, organizationId),
      eq(sequences.styleId, params.styleId),
      scope?.sequence(sequences.id)
    );
    const [current] = await db
      .select({ id: sequences.id })
      .from(sequences)
      .where(still);
    if (!current) return false;
    const styleVersionId = generateId();
    const [, rows] = await db.batch([
      insertStyleVersion(
        db,
        {
          id: styleVersionId,
          sequenceId: params.id,
          styleId: params.styleId,
          config: styleConfig,
          source: 'derived',
          createdBy: null,
        },
        scope?.sequence(params.id)
      ),
      db
        .update(sequences)
        .set({ selectedStyleVersionId: styleVersionId, updatedAt: new Date() })
        .where(still)
        .returning({ id: sequences.id }),
    ]);
    return rows.length > 0;
  };
}
