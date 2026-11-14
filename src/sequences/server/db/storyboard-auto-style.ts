import { createAutomaticStyleWriter } from '@/look/server/db/automatic-style-write';
import type { Database } from '@/platform/server/db/client';
import { createAutoStyleSnapshotWriter } from './sequence-style-writes';
import { createStoryboardContentScope } from './storyboard-content-scope';
import { checkedStoryboardContentWrite } from './storyboard-content-writes';
import type { StoryboardOwner } from './storyboard-owner';

export function createStoryboardAutoStyleMethods(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const scope = createStoryboardContentScope(db, organizationId, owner);
  return {
    styles: {
      setGeneratedForSequence: checkedStoryboardContentWrite(
        scope,
        createAutomaticStyleWriter(db, organizationId, scope)
      ),
    },
    sequences: {
      snapshotAutoStyle: checkedStoryboardContentWrite(
        scope,
        createAutoStyleSnapshotWriter(db, organizationId, scope)
      ),
    },
  };
}
