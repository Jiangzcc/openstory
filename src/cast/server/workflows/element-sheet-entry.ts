import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import {
  deductWorkflowCredits,
  extractImageCost,
  recordFalUsageStep,
} from '@/billing/server/workflow-deduction';
import { buildElementSheetPrompt } from '@/cast/element-prompt';
import { DEFAULT_IMAGE_MODEL } from '@/models/models';
import { generateId } from '@/platform/id';
import { getLogger } from '@/platform/logger';
import { recordProvenance } from '@/platform/server/compliance/provenance';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { STORAGE_BUCKETS } from '@/platform/server/storage/buckets';
import type {
  ElementSheetEntry,
  ElementSheetWorkflowInput,
} from '@/platform/server/workflow/types';
import { storeGeneratedPng } from '@/stills/server/image-storage';
import { generateImageSoftening } from '@/stills/server/workflows/content-soften';
import type { GenerateImageSofteningResult } from '@/stills/server/workflows/content-soften';
import type { ElementSheetOutput } from './element-sheet-output';

const logger = getLogger(['openstory', 'workflow', 'element-sheet']);

type ElementSheetExecution = {
  event: Readonly<WorkflowEvent<ElementSheetWorkflowInput>>;
  step: WorkflowStep;
  scopedDb: WorkflowScopedDb;
  output: ElementSheetOutput;
};

function generateElement(
  { event, step, scopedDb }: ElementSheetExecution,
  entry: ElementSheetEntry,
  index: number
) {
  const input = event.payload;
  return generateImageSoftening({
    promptLocale: input.promptLocale,
    step,
    scopedDb,
    workflowRunId: event.instanceId,
    userId: input.userId,
    sequenceId: input.sequenceId,
    reservationId: input.reservationId,
    kind: 'element-sheet',
    logTag: '[ElementSheetWorkflow:cf]',
    subject: `element ${entry.token}`,
    stepName: `generate-element-image-${index}`,
    params: {
      model: input.imageModel ?? DEFAULT_IMAGE_MODEL,
      prompt: buildElementSheetPrompt(entry, input.styleConfig),
      imageSize: 'square_hd',
      numImages: 1,
    },
    meta: { elementId: entry.elementId },
    store: (result) =>
      storeGeneratedPng(
        result.imageUrls[0],
        STORAGE_BUCKETS.ELEMENTS,
        `${input.organizationId}/${input.sequenceId}/${generateId()}.png`
      ),
  });
}

async function recordElementCost(
  { event, step, scopedDb }: ElementSheetExecution,
  entry: ElementSheetEntry,
  index: number,
  generation: GenerateImageSofteningResult
) {
  const input = event.payload;
  const falUsage = await recordFalUsageStep(
    step,
    scopedDb,
    generation.metadata,
    `record-fal-usage-${index}`
  );
  await step.do(`deduct-credits-${index}`, async () => {
    await deductWorkflowCredits({
      scopedDb,
      costMicros: extractImageCost(generation.metadata),
      usedOwnKey: generation.metadata.usedOwnKey,
      description: `Element reference (${generation.params.model})`,
      idempotencyKey: `${event.instanceId}:element-ref-${index}`,
      reservationId: input.reservationId,
      metadata: {
        ...falUsage,
        model: generation.params.model,
        sequenceId: input.sequenceId,
        token: entry.token,
      },
      workflowName: 'ElementSheetWorkflow',
    });
  });
  return falUsage;
}

async function recordElementGeneration(
  execution: ElementSheetExecution,
  entry: ElementSheetEntry,
  index: number,
  generation: GenerateImageSofteningResult
) {
  const { event, step, scopedDb } = execution;
  const input = event.payload;
  const falUsage = await recordElementCost(execution, entry, index, generation);
  await step.do(`record-provenance-${index}`, async () => {
    await recordProvenance(scopedDb.provenance, {
      organizationId: input.organizationId,
      userId: input.userId,
      assetKind: 'element_sheet',
      assetId: entry.elementId,
      storageKey: generation.stored.path,
      provider: generation.via,
      model: generation.params.model,
      providerRequestId: falUsage.requestId ?? null,
      workflowRunId: event.instanceId,
      prompt: generation.params.prompt,
      sequenceId: input.sequenceId,
    });
  });
}

export async function runElementSheetEntry(
  execution: ElementSheetExecution,
  entry: ElementSheetEntry,
  index: number
) {
  const { event, step, output } = execution;
  const existing = await step.do(`check-existing-element-${index}`, () =>
    output.readExisting(entry)
  );
  if (existing?.imageUrl) {
    logger.info(
      `[ElementSheetWorkflow:cf] Element ${entry.token} already exists for sequence ${event.payload.sequenceId}; skipping generation`
    );
    return existing;
  }
  const generation = await generateElement(execution, entry, index);
  // Incurred usage and provenance precede publication, including a refusal.
  await recordElementGeneration(execution, entry, index, generation);
  return step.do(`ingest-element-${index}`, () =>
    output.publish(entry, generation.stored)
  );
}
