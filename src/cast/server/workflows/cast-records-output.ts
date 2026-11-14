import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import { stopStaleContent } from '@/sequences/server/workflows/storyboard-content-errors';

export function bindCastRecordsOutput(
  db: WorkflowScopedDb,
  sequenceId: string,
  owner: GenerationWorkflowOwner
) {
  const output = db.storyboardCast({ id: sequenceId, ...owner });
  const bound: WorkflowScopedDb = {
    ...db,
    characters: {
      ...db.characters,
      create: stopStaleContent(output.characters.create),
    },
    characterLooks: {
      ...db.characterLooks,
      syncFromAnalysis: stopStaleContent(
        output.characterLooks.syncFromAnalysis
      ),
      linkFromAnalysis: stopStaleContent(
        output.characterLooks.linkFromAnalysis
      ),
    },
    locations: {
      ...db.locations,
      createBulk: stopStaleContent(output.locations.createBulk),
    },
    sequenceElements: {
      ...db.sequenceElements,
      create: stopStaleContent(output.sequenceElements.create),
    },
  };
  return {
    db: bound,
    run: <Result>(write: () => Promise<Result>) =>
      stopStaleContent(() => output.withOwnership(write))(),
  };
}
