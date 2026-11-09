import {
  quoteConfiguredImageRequest,
  configuredImageSource,
} from './configured-image-billing';
import {
  estimateImageCost,
  estimateReferenceSheetCost,
  gateEstimate,
} from './cost-estimation';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { Resolution } from '@/models/resolutions';
import type { ImageModelRoutingSnapshot } from '@/models/image-channels';
import {
  characterSheetImageRequest,
  lookSheetAfterDefaultImageRequest,
  locationSheetImageRequest,
  elementSheetImageRequest,
} from '@/cast/sheet-image-request';
import type { TextToImageModel } from '@/models/models';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import type { PlanReferences } from '@/shots/server/update-stale-references';
import { ZERO_MICROS, addMicros, micros } from './money';
import type { Microdollars } from './money';
import type { EffectiveFalPricing } from './fal-cost';

type ReferenceSheetPlan = Pick<
  PlanReferences,
  | 'characterSheets'
  | 'lookSheetsAfterDefault'
  | 'locationSheets'
  | 'elementSheets'
>;

type PlanImageRequest = {
  model: TextToImageModel;
  aspectRatio: AspectRatio;
  referenceImageCount: number;
  resolution?: Resolution;
};

type PlanImageSelection = Pick<
  UpdateStalePlan,
  'targets' | 'references' | 'renderOptions'
>;

function targetImageModels(
  plan: Pick<UpdateStalePlan, 'renderOptions'>,
  target: Pick<UpdateStalePlan['targets'][number], 'imageModel'>
): TextToImageModel[] {
  return [
    ...new Set(
      plan.renderOptions?.imageModels?.length
        ? plan.renderOptions.imageModels
        : [target.imageModel]
    ),
  ];
}

function planImageRequests(
  plan: PlanImageSelection & Pick<UpdateStalePlan, 'aspectRatio'>,
  resolution?: Resolution
): PlanImageRequest[] {
  return [
    ...plan.targets
      .filter((target) => target.regenImage)
      .flatMap((target) =>
        targetImageModels(plan, target).map((model) => ({
          model,
          aspectRatio: plan.aspectRatio,
          referenceImageCount: target.imageReferenceCount,
          resolution,
        }))
      ),
    ...(plan.references ? referenceSheetImageRequests(plan.references) : []),
  ];
}

export function referenceSheetImageRequests(
  references: ReferenceSheetPlan
): PlanImageRequest[] {
  const { elementSheets } = references;
  return [
    ...references.characterSheets.map(characterSheetImageRequest),
    ...references.lookSheetsAfterDefault.map(lookSheetAfterDefaultImageRequest),
    ...references.locationSheets.map(locationSheetImageRequest),
    ...(elementSheets?.entries.map(() =>
      elementSheetImageRequest(elementSheets)
    ) ?? []),
  ];
}

export function quoteConfiguredPlanImages(
  plan: PlanImageSelection &
    Pick<UpdateStalePlan, 'aspectRatio'> &
    Partial<Pick<UpdateStalePlan, 'sequence'>>,
  imageModelRouting: ImageModelRoutingSnapshot | undefined
) {
  const requests = planImageRequests(plan, plan.sequence?.resolution);
  const quotes = requests
    .filter((request) =>
      configuredImageSource(request.model, imageModelRouting)
    )
    .map((request) =>
      quoteConfiguredImageRequest({
        ...request,
        imageModelRouting,
        operation: request.referenceImageCount > 0 ? 'edit' : 'generate',
        imageCount: 1,
      })
    );
  return {
    costMicros: quotes.reduce(
      (total, quote) => addMicros(total, quote.costMicros),
      ZERO_MICROS
    ),
    creditFloorMicros: micros(
      Math.max(ZERO_MICROS, ...quotes.map((quote) => quote.costMicros))
    ),
    imageSource: quotes.length > 0 ? ('platform' as const) : undefined,
  };
}

function estimateMixedReferenceSheets(
  references: ReferenceSheetPlan,
  imageModelRouting: ImageModelRoutingSnapshot | undefined,
  pricing: Record<string, EffectiveFalPricing>
) {
  return referenceSheetImageRequests(references).reduce(
    (total, request) =>
      addMicros(
        total,
        gateEstimate(
          estimateImageCost(request.model, request.aspectRatio, 1, {
            pricing,
            imageModelRouting,
            edit: configuredImageSource(request.model, imageModelRouting)
              ? request.referenceImageCount > 0
              : undefined,
            referenceImageCount: request.referenceImageCount,
          }),
          { model: request.model, operation: 'storyboard:character-sheets' }
        )
      ),
    ZERO_MICROS
  );
}

export function estimateReferenceSheetPlanCost(
  references: ReferenceSheetPlan,
  imageModel: TextToImageModel,
  imageModelRouting: ImageModelRoutingSnapshot | undefined,
  pricing: Record<string, EffectiveFalPricing>
) {
  const requests = referenceSheetImageRequests(references);
  if (
    configuredImageSource(imageModel, imageModelRouting) ||
    requests.some((request) =>
      configuredImageSource(request.model, imageModelRouting)
    )
  )
    return estimateMixedReferenceSheets(references, imageModelRouting, pricing);
  return estimateReferenceSheetCost({
    imageModel,
    pricing,
    imageModelRouting,
    characterSheets:
      references.characterSheets.length +
      references.lookSheetsAfterDefault.length,
    locationSheets: references.locationSheets.length,
    elementSheets: references.elementSheets?.entries.length ?? 0,
  });
}

export function planUsesConfiguredImages(
  plan: PlanImageSelection,
  imageModelRouting?: ImageModelRoutingSnapshot
): boolean {
  return (
    plan.targets.some(
      (target) =>
        target.regenImage &&
        targetImageModels(plan, target).some((model) =>
          configuredImageSource(model, imageModelRouting)
        )
    ) ||
    Boolean(
      plan.references &&
      referenceSheetImageRequests(plan.references).some((request) =>
        configuredImageSource(request.model, imageModelRouting)
      )
    )
  );
}

export function estimatePlanImageCost(
  plan: Pick<
    UpdateStalePlan,
    'targets' | 'references' | 'aspectRatio' | 'sequence' | 'renderOptions'
  >,
  imageModelRouting: ImageModelRoutingSnapshot | undefined,
  pricing: Record<string, EffectiveFalPricing>
) {
  const configured = quoteConfiguredPlanImages(plan, imageModelRouting);
  const builtinRequests = planImageRequests(
    plan,
    plan.sequence.resolution
  ).filter(
    (request) => !configuredImageSource(request.model, imageModelRouting)
  );
  const estimates = builtinRequests.map((request) => ({
    model: request.model,
    cost: estimateImageCost(request.model, request.aspectRatio, 1, {
      pricing,
      imageModelRouting,
      resolution: request.resolution,
    }),
  }));
  const costMicros = estimates.reduce<Microdollars>(
    (total, estimate) =>
      addMicros(
        total,
        gateEstimate(estimate.cost, {
          model: estimate.model,
          operation: 'storyboard:shot-images',
        })
      ),
    configured.costMicros
  );
  return {
    ...configured,
    costMicros,
    priced: estimates.every((estimate) => estimate.cost !== null),
  };
}
