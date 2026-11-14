import { and, eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import {
  sequences,
  sequenceElements,
  sequenceEvents,
} from '@/platform/server/db/schema';
import { createScenesMethods } from '@/shots/server/db/scenes';
import { createShotsMethods } from '@/shots/server/db/shots';
import { createSceneScriptVersionsMethods } from '@/shots/server/db/scene-script-versions';
import { createShotDialogueMethods } from '@/shots/server/db/shot-dialogue';
import type { RecordEventInput } from './sequence-events';
import type { StoryboardOwner } from './storyboard-owner';
import {
  createStoryboardContentScope,
  insertWithStoryboardGuard,
} from './storyboard-content-scope';
import type { StoryboardContentScope } from './storyboard-content-scope';
import { checkedStoryboardContentWrite } from './storyboard-content-writes';

export function createStoryboardContentMethods(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const scope = createStoryboardContentScope(db, organizationId, owner);
  const scenes = createScenesMethods(db, scope);
  const shots = createShotsMethods(db, scope);
  const scripts = createSceneScriptVersionsMethods(db, scope);
  const dialogue = createShotDialogueMethods(db, scope);
  const check = <Args extends unknown[], Result>(
    write: (...args: Args) => Promise<Result>
  ) => checkedStoryboardContentWrite(scope, write);
  return {
    scenes: {
      upsert: check(scenes.upsert),
      deleteFromOrderIndex: check(scenes.deleteFromOrderIndex),
    },
    shots: {
      bulkUpsert: check(shots.bulkUpsert),
      update: check(shots.update),
      delete: check(shots.delete),
      deleteFromShotNumber: check(shots.deleteFromShotNumber),
      deleteByScenesFromOrderIndex: check(shots.deleteByScenesFromOrderIndex),
    },
    sceneScriptVersions: {
      seedSplitVersions: check(scripts.seedSplitVersions),
      updateSplitContent: check(scripts.updateSplitContent),
    },
    shotDialogue: { write: check(dialogue.write) },
    ...createSequenceContentMethods(db, scope),
  };
}

function createSequenceContentMethods(
  db: Database,
  scope: StoryboardContentScope
) {
  const sequenceUpdate = (field: 'title' | 'workflow') =>
    checkedStoryboardContentWrite(
      scope,
      async (sequenceId: string, value: string): Promise<void> => {
        await db
          .update(sequences)
          .set({ [field]: value, updatedAt: new Date() })
          .where(
            and(eq(sequences.id, sequenceId), scope.sequence(sequences.id))
          );
      }
    );
  return {
    sequences: {
      updateTitle: sequenceUpdate('title'),
      updateWorkflow: sequenceUpdate('workflow'),
    },
    sequenceElements: {
      updateFirstMention: createFirstMentionWriter(db, scope),
    },
    sequenceEvents: { recordOnce: createCompletionWriter(db, scope) },
  };
}

function createFirstMentionWriter(db: Database, scope: StoryboardContentScope) {
  return checkedStoryboardContentWrite(
    scope,
    async (
      id: string,
      firstMention: { sceneId: string; text: string; lineNumber: number }
    ) => {
      const [element] = await db
        .update(sequenceElements)
        .set({
          firstMentionSceneId: firstMention.sceneId,
          firstMentionText: firstMention.text,
          firstMentionLine: firstMention.lineNumber,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sequenceElements.id, id),
            scope.sequence(sequenceElements.sequenceId)
          )
        )
        .returning();
      if (!element) throw new Error(`SequenceElement ${id} not found`);
      return element;
    }
  );
}

function createCompletionWriter(db: Database, scope: StoryboardContentScope) {
  return checkedStoryboardContentWrite(
    scope,
    async (input: RecordEventInput & { id: string }): Promise<void> => {
      await insertWithStoryboardGuard(
        db,
        sequenceEvents,
        [
          {
            ...input,
            summary: input.summary ?? null,
            data: input.data ?? null,
          },
        ],
        scope.sequence(input.sequenceId)
      ).onConflictDoNothing();
    }
  );
}
