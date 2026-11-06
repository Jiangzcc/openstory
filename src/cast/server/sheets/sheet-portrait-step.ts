import type { WorkflowStep } from 'cloudflare:workers';
import { deleteFile } from '#storage';
import { base64ToBytes } from '@/platform/base64';
import { generateId } from '@/platform/id';
import { getLogger } from '@/platform/logger';
import { usesConfiguredImageChannel } from '@/models/image-channels';
import { configuredImageGenerationQuote } from '@/stills/server/configured-image-generation';
import { runConfiguredSingleImageStep } from '@/stills/server/configured-image-step';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import { extractImageCost } from '@/billing/server/workflow-deduction';
import { recordProvenance } from '@/platform/server/compliance/provenance';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import { uploadResponse } from '@/platform/server/storage/upload-response';
import { getExtensionFromMimeType } from '@/platform/server/storage/file';
import {
  drawSheetPortrait,
  sheetPortraitGenerationRequest,
} from './sheet-portrait';
import type { DrawnPortrait, SheetPortraitInput } from './sheet-portrait';

const logger = getLogger(['openstory', 'cast', 'sheet-portrait']);
type PortraitStepInput = SheetPortraitInput & { step: WorkflowStep };
type PortraitRequest = ReturnType<typeof sheetPortraitGenerationRequest>;
const PORTRAIT_DATA_URI = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/;

async function uploadConfiguredPortrait(
  args: SheetPortraitInput,
  request: PortraitRequest,
  image: ImageGenerationResult
) {
  const source = image.imageUrls[0];
  const match = source ? PORTRAIT_DATA_URI.exec(source) : null;
  if (!match?.[1] || !match[2])
    throw new Error('Configured portrait did not return image bytes.');
  const contentType = match[1];
  const extension = getExtensionFromMimeType(contentType);
  const bytes = base64ToBytes(match[2]);
  const path = args.storageDir + '/' + generateId() + '-portrait.' + extension;
  const uploaded = await uploadResponse(
    new Response(bytes, {
      headers: {
        'content-type': contentType,
        'content-length': String(bytes.length),
      },
    }),
    request.bucket,
    path,
    { contentType }
  );
  return { url: uploaded.publicUrl, path: uploaded.path, contentType };
}

async function storeConfiguredPortrait(
  args: SheetPortraitInput,
  request: PortraitRequest,
  image: ImageGenerationResult
) {
  const stored = await uploadConfiguredPortrait(args, request, image);
  try {
    await recordProvenance(args.scopedDb.provenance, {
      organizationId: args.scopedDb.organizationId,
      userId: args.userId,
      assetKind:
        args.kind === 'character' ? 'character_sheet' : 'location_sheet',
      assetId: args.subjectId,
      storageKey: stored.path,
      provider: image.via,
      model: request.params.model,
      providerRequestId: image.metadata.requestId ?? null,
      workflowRunId: args.chargeKey,
      prompt: request.params.prompt,
      sequenceId: args.sequenceId ?? undefined,
      referenceImageCount: 1,
    });
  } catch (error) {
    if (isEngineAbortError(error)) throw error;
    await deleteFile(request.bucket, stored.path);
    throw error;
  }
  return stored;
}

async function reserveConfiguredPortrait(
  args: PortraitStepInput,
  request: PortraitRequest
) {
  return args.step.do('reserve-portrait', async () => {
    const quote = configuredImageGenerationQuote(
      request.params,
      args.scopedDb.models.imageModelRouting
    );
    const hold = await args.scopedDb.billing.createReservation(
      quote.costMicros,
      {
        idempotencyKey: args.chargeKey + ':portrait-hold',
        sequenceId: args.sequenceId ?? undefined,
      }
    );
    return hold.ok && hold.remaining >= quote.costMicros
      ? hold.reservationId
      : null;
  });
}

async function runConfiguredPortraitStep(
  args: PortraitStepInput,
  request: PortraitRequest
): Promise<DrawnPortrait | null> {
  const reservationId = await reserveConfiguredPortrait(args, request);
  if (!reservationId) return null;
  try {
    const image = await runConfiguredSingleImageStep({
      step: args.step,
      stepName: 'draw-portrait',
      workflowRunId: args.chargeKey,
      scopedDb: args.scopedDb,
      params: request.params,
      reservationId,
      store: (result) => storeConfiguredPortrait(args, request, result),
    });
    return {
      portraitUrl: image.stored.url,
      costMicros: extractImageCost(image.metadata),
      usedOwnKey: image.metadata.usedOwnKey,
      reservationId,
    };
  } catch (error) {
    if (isEngineAbortError(error)) throw error;
    await args.step.do('release-portrait-hold', () =>
      args.scopedDb.billing.zeroReservation(reservationId)
    );
    logger.warn('Configured portrait not kept; tiles crop the sheet.', {
      err: error,
      kind: args.kind,
      subjectId: args.subjectId,
    });
    return null;
  }
}

export async function runSheetPortraitStep(
  args: PortraitStepInput
): Promise<DrawnPortrait | null> {
  const request = sheetPortraitGenerationRequest(args.kind, args.sheetUrl);
  if (
    !usesConfiguredImageChannel(
      request.params.model,
      args.scopedDb.models.imageModelRouting
    )
  )
    return args.step.do('draw-portrait', () => drawSheetPortrait(args));
  return runConfiguredPortraitStep(args, request);
}
