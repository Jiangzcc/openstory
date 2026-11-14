import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ParentNotifyHint } from '@/platform/server/workflow/await-child';
import { WorkflowValidationError } from '@/platform/server/workflow/errors';
import { resolveStoryboardOwner } from '@/sequences/server/workflows/generation-workflow-owner';
import { stopStaleContent } from '@/sequences/server/workflows/storyboard-content-errors';

export function bindReferenceSheetOutput(
  scopedDb: WorkflowScopedDb,
  input: {
    sequenceId: string | null;
    storyboardOwner?: GenerationWorkflowOwner;
    _parent?: ParentNotifyHint;
  }
) {
  const owner = resolveStoryboardOwner(input);
  if (owner && input.sequenceId === null) {
    throw new WorkflowValidationError(
      'A Storyboard sheet requires its sequence'
    );
  }
  const bound =
    owner && input.sequenceId !== null
      ? scopedDb.storyboardReferenceSheets({ id: input.sequenceId, ...owner })
      : undefined;
  const target = bound ?? scopedDb;
  return { ...sheetClaims(target), ...sheetPublications(target) };
}

type SheetWriters = ReturnType<WorkflowScopedDb['storyboardReferenceSheets']>;

function sheetClaims(target: SheetWriters) {
  return {
    characterLooks: {
      claimSheet: stopStaleContent(
        (...args: Parameters<SheetWriters['characterLooks']['claimSheet']>) =>
          target.characterLooks.claimSheet(...args)
      ),
      failSheetClaim: (
        ...args: Parameters<SheetWriters['characterLooks']['failSheetClaim']>
      ) => target.characterLooks.failSheetClaim(...args),
    },
    locations: {
      claimReference: stopStaleContent(
        (...args: Parameters<SheetWriters['locations']['claimReference']>) =>
          target.locations.claimReference(...args)
      ),
      failReferenceClaim: (
        ...args: Parameters<SheetWriters['locations']['failReferenceClaim']>
      ) => target.locations.failReferenceClaim(...args),
    },
  };
}

function sheetPublications(target: SheetWriters) {
  return {
    characterSheetVariants: {
      promoteIfPending: stopStaleContent(
        (
          ...args: Parameters<
            SheetWriters['characterSheetVariants']['promoteIfPending']
          >
        ) => target.characterSheetVariants.promoteIfPending(...args)
      ),
    },
    locationSheetVariants: {
      promoteIfPending: stopStaleContent(
        (
          ...args: Parameters<
            SheetWriters['locationSheetVariants']['promoteIfPending']
          >
        ) => target.locationSheetVariants.promoteIfPending(...args)
      ),
    },
  };
}
