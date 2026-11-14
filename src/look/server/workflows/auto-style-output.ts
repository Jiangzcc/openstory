import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import { stopStaleContent } from '@/sequences/server/workflows/storyboard-content-errors';

export function autoStyleOutput(
  db: WorkflowScopedDb,
  sequenceId: string,
  owner: GenerationWorkflowOwner | undefined
) {
  if (!owner) return { styles: db.styles, sequences: db.sequences };
  const output = db.storyboardAutoStyle({ id: sequenceId, ...owner });
  return {
    styles: {
      setGeneratedForSequence: stopStaleContent(
        output.styles.setGeneratedForSequence
      ),
    },
    sequences: {
      snapshotAutoStyle: stopStaleContent(output.sequences.snapshotAutoStyle),
    },
  };
}
