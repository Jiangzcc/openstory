import type { WorkflowStep } from 'cloudflare:workers';
import { ValidationError } from '@/platform/errors';
import type { SequenceElementMinimal } from '@/platform/server/db/schema';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  ElementSheetEntry,
  ElementSheetWorkflowInput,
} from '@/platform/server/workflow/types';
import { resolveStoryboardOwner } from '@/sequences/server/workflows/generation-workflow-owner';
import { stopStaleContent } from '@/sequences/server/workflows/storyboard-content-errors';
import type { GenerateImageSofteningResult } from '@/stills/server/workflows/content-soften';

function toMinimalElement(row: SequenceElementMinimal): SequenceElementMinimal {
  return {
    id: row.id,
    token: row.token,
    description: row.description,
    imageUrl: row.imageUrl,
    consistencyTag: row.consistencyTag,
    kind: row.kind,
    durationSeconds: row.durationSeconds,
    personInMedia: row.personInMedia,
  };
}

async function readExistingElement(
  scopedDb: WorkflowScopedDb,
  sequenceId: string,
  entry: ElementSheetEntry
): Promise<SequenceElementMinimal | null> {
  await scopedDb.liveRead.sequences.getForUser({ sequenceId });
  const row =
    (await scopedDb.liveRead.sequenceElements.getById(entry.elementId)) ??
    (await scopedDb.liveRead.sequenceElements.getByToken(
      sequenceId,
      entry.token
    ));
  if (!row) return null;
  if (row.sequenceId !== sequenceId || row.deletedAt) {
    throw new ValidationError('Generated sequence element is unavailable');
  }
  return toMinimalElement(row);
}

function publicationInput(
  sequenceId: string,
  entry: ElementSheetEntry,
  stored: GenerateImageSofteningResult['stored']
) {
  return {
    id: entry.elementId,
    sequenceId,
    uploadedFilename: `generated-${entry.token.toLowerCase()}.png`,
    token: entry.token,
    imageUrl: stored.url,
    imagePath: stored.path,
    description: entry.description,
    consistencyTag: entry.consistencyTag,
    visionStatus: 'completed' as const,
    visionGeneratedAt: new Date(),
    firstMentionSceneId: entry.firstMention.sceneId,
    firstMentionText: entry.firstMention.text,
    firstMentionLine: entry.firstMention.lineNumber,
  };
}

export function bindElementSheetOutput(
  scopedDb: WorkflowScopedDb,
  input: ElementSheetWorkflowInput
) {
  const owner = resolveStoryboardOwner(input);
  const bound = owner
    ? scopedDb.storyboardElementSheets({ id: input.sequenceId, ...owner })
    : undefined;
  const publisher = bound ?? scopedDb.sequenceElements;
  const withOwnership = <Result>(read: () => Promise<Result>) =>
    bound ? bound.withOwnership(read) : read();
  return {
    readExisting: stopStaleContent((entry: ElementSheetEntry) =>
      withOwnership(() =>
        readExistingElement(scopedDb, input.sequenceId, entry)
      )
    ),
    publish: stopStaleContent(
      async (
        entry: ElementSheetEntry,
        stored: GenerateImageSofteningResult['stored']
      ) =>
        toMinimalElement(
          await publisher.publishGenerated(
            publicationInput(input.sequenceId, entry, stored)
          )
        )
    ),
    verifyCompletion: async (step: WorkflowStep) => {
      if (!bound) return;
      await step.do(
        'check-element-sheet-completion',
        stopStaleContent(() => bound.withOwnership(async () => {}))
      );
    },
  };
}
