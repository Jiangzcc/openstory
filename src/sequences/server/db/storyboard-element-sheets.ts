import { createElementSheetPublicationMethods } from '@/cast/server/db/element-sheet-publication';
import type { GeneratedElementPublication } from '@/cast/server/db/element-sheet-publication';
import { ValidationError } from '@/platform/errors';
import type { Database } from '@/platform/server/db/client';
import { createStoryboardContentScope } from './storyboard-content-scope';
import { checkedStoryboardContentWrite } from './storyboard-content-writes';
import type { StoryboardOwner } from './storyboard-owner';

export function createStoryboardElementSheetsMethods(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const scope = createStoryboardContentScope(db, organizationId, owner);
  const publication = createElementSheetPublicationMethods(
    db,
    organizationId,
    scope
  );
  return {
    publishGenerated: checkedStoryboardContentWrite(
      scope,
      async (data: GeneratedElementPublication) => {
        if (data.sequenceId !== owner.id) {
          throw new ValidationError(
            'Element publication target is outside the Storyboard sequence'
          );
        }
        return publication.publishGenerated(data);
      }
    ),
    withOwnership: <Result>(write: () => Promise<Result>) =>
      checkedStoryboardContentWrite(scope, write)(),
  };
}
