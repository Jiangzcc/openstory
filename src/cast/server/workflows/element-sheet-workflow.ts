// Generate and publish references for recurring script elements.

import type { ElementBibleEntry } from '@/shots/scene-analysis.schema';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { SequenceElementMinimal } from '@/platform/server/db/schema';
import { rejectionReasonMessage } from './replace-element-workflow';
import { contentRejectionSummary } from '@/models/content-rejection';
import { OpenStoryWorkflowEntrypoint } from '@/platform/server/workflow/base-workflow';
import { MAX_AUTO_ELEMENTS } from './cast-records';
import type {
  ElementSheetWorkflowInput,
  ElementSheetWorkflowResult,
} from '@/platform/server/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { getLogger } from '@/platform/logger';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import { isStoryboardContentOwnershipFailure } from '@/sequences/server/db/storyboard-content-scope';
import { bindElementSheetOutput } from './element-sheet-output';
import { runElementSheetEntry } from './element-sheet-entry';

const logger = getLogger(['openstory', 'workflow', 'element-sheet']);

export function collectElementResults(
  settled: Array<PromiseSettledResult<SequenceElementMinimal>>,
  entries: Array<Pick<ElementBibleEntry, 'token'>>
): SequenceElementMinimal[] {
  const interrupted = settled.find(
    (outcome) =>
      outcome.status === 'rejected' && isEngineAbortError(outcome.reason)
  );
  if (interrupted?.status === 'rejected') throw interrupted.reason;
  const failures: { name: string; reason: string }[] = [];
  const elements: SequenceElementMinimal[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === 'rejected') {
      if (isStoryboardContentOwnershipFailure(outcome.reason)) {
        throw outcome.reason;
      }
      failures.push({
        name: entries[index]?.token ?? `index ${index}`,
        reason: rejectionReasonMessage(outcome.reason),
      });
      continue;
    }
    elements.push(outcome.value);
  }
  if (failures.length > 0) {
    throw new Error(
      contentRejectionSummary(failures) ??
        `Element reference generation failed for ${failures.length}/${settled.length} element(s) — ${failures.map((f) => `${f.name}: ${f.reason}`).join('; ')}`
    );
  }
  return elements;
}

function logElementFailures(
  settled: Array<PromiseSettledResult<SequenceElementMinimal>>,
  entries: Array<Pick<ElementBibleEntry, 'token'>>
) {
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === 'rejected') {
      logger.error(
        `[ElementSheetWorkflow:cf] Reference generation failed for ${entries[index]?.token ?? `index ${index}`}:`,
        { err: outcome.reason }
      );
    }
  }
}

export class ElementSheetWorkflow extends OpenStoryWorkflowEntrypoint<ElementSheetWorkflowInput> {
  protected override readonly failureLabel = 'Element sheet';

  protected override async runImpl(
    event: Readonly<WorkflowEvent<ElementSheetWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ): Promise<ElementSheetWorkflowResult> {
    const { sequenceId } = event.payload;
    const entries = event.payload.entries.slice(0, MAX_AUTO_ELEMENTS);
    const output = bindElementSheetOutput(scopedDb, event.payload);
    if (event.payload.entries.length > entries.length) {
      logger.warn(
        `[ElementSheetWorkflow:cf] Capping auto-generated elements at ${MAX_AUTO_ELEMENTS} (got ${event.payload.entries.length}) for sequence ${sequenceId}`
      );
    }
    if (entries.length === 0) {
      await output.verifyCompletion(step);
      return { elements: [] };
    }
    logger.info(
      `[ElementSheetWorkflow:cf] Generating ${entries.length} element reference(s) for sequence ${sequenceId}: ${entries.map((e) => e.token).join(', ')}`
    );
    const settled = await Promise.allSettled(
      entries.map((entry, index) =>
        runElementSheetEntry({ event, step, scopedDb, output }, entry, index)
      )
    );
    logElementFailures(settled, entries);
    const elements = collectElementResults(settled, entries);
    await output.verifyCompletion(step);
    logger.info(
      `[ElementSheetWorkflow:cf] Completed: ${elements.length}/${entries.length} element reference(s) for sequence ${sequenceId}`
    );
    return { elements };
  }

  protected override onFailure({
    event,
    error,
  }: {
    event: Readonly<WorkflowEvent<ElementSheetWorkflowInput>>;
    error: string;
    scopedDb: WorkflowScopedDb;
  }): void {
    // The Script-stage placeholder row (no image) simply stays image-less.
    // The parent analysis surfaces this failure to the user.
    logger.error(
      `[ElementSheetWorkflow:cf] Element reference generation failed for sequence ${event.payload.sequenceId}: ${error}`
    );
  }
}
