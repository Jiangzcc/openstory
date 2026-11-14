import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { SceneSplitWorkflowInput } from '@/platform/server/workflow/types';
import { stopStaleContent } from './storyboard-content-errors';

type Content = ReturnType<WorkflowScopedDb['storyboardContent']>;

function guardStructure(content: Content) {
  return {
    sequences: {
      updateTitle: stopStaleContent(content.sequences.updateTitle),
      updateWorkflow: stopStaleContent(content.sequences.updateWorkflow),
    },
    scenes: {
      upsert: stopStaleContent(content.scenes.upsert),
      deleteFromOrderIndex: stopStaleContent(
        content.scenes.deleteFromOrderIndex
      ),
    },
    shots: {
      bulkUpsert: stopStaleContent(content.shots.bulkUpsert),
      update: stopStaleContent(content.shots.update),
      delete: stopStaleContent(content.shots.delete),
      deleteFromShotNumber: stopStaleContent(
        content.shots.deleteFromShotNumber
      ),
      deleteByScenesFromOrderIndex: stopStaleContent(
        content.shots.deleteByScenesFromOrderIndex
      ),
    },
  };
}

function guardDetails(content: Content) {
  return {
    sceneScriptVersions: {
      seedSplitVersions: stopStaleContent(
        content.sceneScriptVersions.seedSplitVersions
      ),
      updateSplitContent: stopStaleContent(
        content.sceneScriptVersions.updateSplitContent
      ),
    },
    shotDialogue: { write: stopStaleContent(content.shotDialogue.write) },
    sequenceElements: {
      updateFirstMention: stopStaleContent(
        content.sequenceElements.updateFirstMention
      ),
    },
    sequenceEvents: {
      recordOnce: stopStaleContent(content.sequenceEvents.recordOnce),
    },
  };
}

export function bindSceneSplitContent(
  db: WorkflowScopedDb,
  input: Pick<SceneSplitWorkflowInput, 'sequenceId' | 'storyboardOwner'>
): WorkflowScopedDb {
  if (!input.sequenceId || !input.storyboardOwner) return db;
  const owned = db.storyboardContent({
    id: input.sequenceId,
    ...input.storyboardOwner,
  });
  const content = { ...guardStructure(owned), ...guardDetails(owned) };
  return {
    ...db,
    sequences: { ...db.sequences, ...content.sequences },
    scenes: { ...db.scenes, ...content.scenes },
    shots: { ...db.shots, ...content.shots },
    sceneScriptVersions: {
      ...db.sceneScriptVersions,
      ...content.sceneScriptVersions,
    },
    shotDialogue: { ...db.shotDialogue, ...content.shotDialogue },
    sequenceElements: { ...db.sequenceElements, ...content.sequenceElements },
    sequenceEvents: { ...db.sequenceEvents, ...content.sequenceEvents },
  };
}
