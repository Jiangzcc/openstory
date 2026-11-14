import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import { stopStaleContent } from './storyboard-content-errors';

export function bindAnalyzeScriptOutput(
  db: WorkflowScopedDb,
  sequenceId: string | undefined,
  owner: GenerationWorkflowOwner | undefined
): WorkflowScopedDb {
  if (!sequenceId || !owner) return db;
  const content = db.storyboardAnalysisOutput({ id: sequenceId, ...owner });
  return {
    ...db,
    scenes: {
      ...db.scenes,
      upsert: stopStaleContent(content.scenes.upsert),
      updateContinuity: stopStaleContent(content.scenes.updateContinuity),
    },
    shotSpecVersions: {
      ...db.shotSpecVersions,
      write: stopStaleContent(content.shotSpecVersions.write),
    },
    framePromptVersions: {
      ...db.framePromptVersions,
      write: stopStaleContent(content.framePromptVersions.write),
    },
    shotPromptVersions: {
      ...db.shotPromptVersions,
      write: stopStaleContent(content.shotPromptVersions.write),
    },
    sequences: {
      ...db.sequences,
      updateAnalysisDurationMs: stopStaleContent(
        content.sequences.updateAnalysisDurationMs
      ),
    },
    sequenceEvents: {
      ...db.sequenceEvents,
      recordOnce: stopStaleContent(content.sequenceEvents.recordOnce),
    },
  };
}
