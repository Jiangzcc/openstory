import { and, eq, exists, isNull, notExists, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database } from '@/platform/server/db/client';
import { sequenceElements, sequences } from '@/platform/server/db/schema';
import type {
  NewSequenceElement,
  SequenceElement,
} from '@/platform/server/db/schema';
import { insertWithStoryboardGuard } from '@/sequences/server/db/storyboard-content-scope';
import type { StoryboardContentScope } from '@/sequences/server/db/storyboard-content-scope';

export type GeneratedElementPublication = Pick<
  NewSequenceElement,
  | 'sequenceId'
  | 'uploadedFilename'
  | 'token'
  | 'description'
  | 'consistencyTag'
  | 'visionStatus'
  | 'visionGeneratedAt'
  | 'firstMentionSceneId'
  | 'firstMentionText'
  | 'firstMentionLine'
> & { id: string; imageUrl: string; imagePath: string };

const ELEMENT_UNAVAILABLE = 'Generated sequence element is unavailable';
const SINGLE_ELEMENT = 1;

function publicationIdentity(db: Database, data: GeneratedElementPublication) {
  const identity = alias(sequenceElements, 'publication_identity');
  const idExists = db
    .select({ id: identity.id })
    .from(identity)
    .where(eq(identity.id, data.id));
  const tokenExists = db
    .select({ id: identity.id })
    .from(identity)
    .where(
      and(
        eq(identity.sequenceId, data.sequenceId),
        eq(identity.token, data.token)
      )
    );
  return {
    absent: and(notExists(idExists), notExists(tokenExists)),
    candidate: or(
      eq(sequenceElements.id, data.id),
      and(notExists(idExists), eq(sequenceElements.token, data.token))
    ),
  };
}

function publicationTarget(
  db: Database,
  organizationId: string,
  data: GeneratedElementPublication,
  scope?: StoryboardContentScope
) {
  const parent = exists(
    db
      .select({ id: sequences.id })
      .from(sequences)
      .where(
        and(
          eq(sequences.id, data.sequenceId),
          eq(sequences.organizationId, organizationId)
        )
      )
  );
  const identity = publicationIdentity(db, data);
  const admission = and(parent, scope?.sequence(data.sequenceId));
  return {
    insert: and(admission, identity.absent),
    candidate: and(
      admission,
      eq(sequenceElements.sequenceId, data.sequenceId),
      isNull(sequenceElements.deletedAt),
      identity.candidate
    ),
  };
}

export function createElementSheetPublicationMethods(
  db: Database,
  organizationId: string,
  scope?: StoryboardContentScope
) {
  return {
    publishGenerated: async (
      data: GeneratedElementPublication
    ): Promise<SequenceElement> => {
      const target = publicationTarget(db, organizationId, data, scope);
      const update = db
        .update(sequenceElements)
        .set({
          imageUrl: data.imageUrl,
          imagePath: data.imagePath,
          updatedAt: new Date(),
        })
        .where(
          and(
            target.candidate,
            or(
              isNull(sequenceElements.imageUrl),
              eq(sequenceElements.imageUrl, '')
            )
          )
        );
      const insert = insertWithStoryboardGuard(
        db,
        sequenceElements,
        [data],
        target.insert
      );
      const read = publicationRead(db, target.candidate);
      const [, , [result]] = await db.batch([update, insert, read]);
      if (!result?.element) throw new Error(ELEMENT_UNAVAILABLE);
      return result.element;
    },
  };
}

function publicationRead(db: Database, candidate: SQL | undefined) {
  return db
    .select({
      element: sequenceElements,
      // Invalid JSON aborts the batch when no eligible target survived.
      available: sql<number>`case when ${sequenceElements.id} is null
        then json(${ELEMENT_UNAVAILABLE}) else 1 end`,
    })
    .from(sql`(select 1) as publication_result`)
    .leftJoin(sequenceElements, candidate)
    .limit(SINGLE_ELEMENT);
}
