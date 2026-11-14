import { and, eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { sequences } from '@/platform/server/db/schema';
import { createScenesMethods } from '@/shots/server/db/scenes';
import { createShotSpecVersionsMethods } from '@/shots/server/db/shot-spec-versions';
import { createFramePromptVersionsMethods } from '@/shots/server/db/frame-prompt-versions';
import { createShotPromptVersionsMethods } from '@/shots/server/db/shot-prompt-versions';
import { createStoryboardContentMethods } from './storyboard-content';
import { createStoryboardContentScope } from './storyboard-content-scope';
import type { StoryboardContentScope } from './storyboard-content-scope';
import { checkedStoryboardContentWrite } from './storyboard-content-writes';
import type { StoryboardOwner } from './storyboard-owner';

export function createStoryboardAnalysisOutputMethods(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const scope = createStoryboardContentScope(db, organizationId, owner);
  const base = createStoryboardContentMethods(db, organizationId, owner);
  const scenes = createScenesMethods(db, scope);
  const specs = createShotSpecVersionsMethods(db, scope);
  const visual = createFramePromptVersionsMethods(db, scope);
  const motion = createShotPromptVersionsMethods(db, scope);
  return {
    scenes: {
      upsert: base.scenes.upsert,
      updateContinuity: checkedStoryboardContentWrite(
        scope,
        scenes.updateContinuity
      ),
    },
    shotSpecVersions: {
      write: checkedStoryboardContentWrite(scope, specs.write),
    },
    framePromptVersions: {
      write: checkedStoryboardContentWrite(scope, visual.write),
    },
    shotPromptVersions: {
      write: checkedStoryboardContentWrite(scope, motion.write),
    },
    sequenceEvents: base.sequenceEvents,
    sequences: {
      updateAnalysisDurationMs: durationWriter(db, scope),
    },
  };
}

function durationWriter(db: Database, scope: StoryboardContentScope) {
  return checkedStoryboardContentWrite(
    scope,
    async (sequenceId: string, durationMs: number): Promise<void> => {
      await db
        .update(sequences)
        .set({ analysisDurationMs: durationMs, updatedAt: new Date() })
        .where(and(eq(sequences.id, sequenceId), scope.sequence(sequences.id)));
    }
  );
}
