import type {
  ImageChannelModelId,
  ImageModelCatalogEntry,
} from './image-channels';
import type { ImageOperation } from './image-channel-parameters';
import { IMAGE_OPERATIONS } from './image-channel-parameters';
import type { BuiltinTextToImageModel, TextToImageModel } from './models';
import type { PromptRecommendation } from './prompt-length';
import {
  IMAGE_MODELS,
  isBuiltinTextToImageModel,
  supportsReferenceImages,
} from './models';

const CONFIGURED_IMAGE_QUALITY_RANK = 1_000;

type ImageModelMetadata = {
  id: TextToImageModel;
  name: string;
  description?: string;
  qualityRank: number;
  hidden: boolean;
  license?: 'open-weight' | 'proprietary';
};
export type ImageModelDefinition = ImageModelMetadata &
  (
    | { source: 'builtin'; id: BuiltinTextToImageModel }
    | {
        source: 'configured';
        id: ImageChannelModelId;
        configuration: ImageModelCatalogEntry;
      }
  );

function configuredImageModelDefinition(
  configuration: ImageModelCatalogEntry,
  builtin?: ImageModelMetadata
): ImageModelDefinition {
  return {
    ...builtin,
    id: configuration.id,
    name: builtin?.name ?? configuration.name,
    description: configuration.description ?? builtin?.description,
    qualityRank: builtin?.qualityRank ?? CONFIGURED_IMAGE_QUALITY_RANK,
    hidden: builtin?.hidden ?? false,
    source: 'configured',
    configuration,
  };
}

export function mergeImageModelCatalog(
  entries: readonly ImageModelCatalogEntry[] = []
): ImageModelDefinition[] {
  const builtins: ImageModelDefinition[] = Object.entries(IMAGE_MODELS)
    .filter(([id]) => isBuiltinTextToImageModel(id))
    .map(([id, model]) => {
      if (!isBuiltinTextToImageModel(id))
        throw new Error('Unknown built-in image model.');
      return {
        id,
        name: model.name,
        description: model.description,
        qualityRank: model.qualityRank,
        hidden: 'hidden' in model && model.hidden,
        license: model.license,
        source: 'builtin',
      };
    });
  const catalog = new Map(builtins.map((model) => [model.id, model] as const));
  for (const configuration of entries) {
    catalog.set(
      configuration.id,
      configuredImageModelDefinition(
        configuration,
        catalog.get(configuration.id)
      )
    );
  }
  return [...catalog.values()];
}

export function getImageModelDefinition(
  id: string,
  catalog: readonly ImageModelDefinition[] = mergeImageModelCatalog()
): ImageModelDefinition | undefined {
  return catalog.find((model) => model.id === id);
}

export function imageModelDisplayName(
  id: string,
  catalog: readonly ImageModelDefinition[] = mergeImageModelCatalog()
): string {
  return getImageModelDefinition(id, catalog)?.name ?? id;
}

export function getImagePromptRecommendation(
  model: ImageModelDefinition | undefined
): PromptRecommendation {
  if (!model || !isBuiltinTextToImageModel(model.id)) return {};
  const maxPromptLength = IMAGE_MODELS[model.id].maxPromptLength;
  return maxPromptLength === undefined ? {} : { maxPromptLength };
}

export function imageModelSupportsOperation(
  model: ImageModelDefinition,
  operation: ImageOperation,
  referenceCount?: number
): boolean {
  if (model.source === 'builtin')
    return operation === 'generate' || supportsReferenceImages(model.id);
  const binding = model.configuration.operations[operation];
  if (!binding || binding.status !== 'verified') return false;
  return (
    referenceCount === undefined ||
    (referenceCount >= binding.minReferenceImages &&
      referenceCount <= binding.maxReferenceImages)
  );
}

export function isSelectableImageModelId(
  id: unknown,
  catalog: readonly ImageModelDefinition[],
  operation?: ImageOperation,
  referenceCount?: number
): id is TextToImageModel {
  if (typeof id !== 'string') return false;
  const model = getImageModelDefinition(id, catalog);
  if (!model || model.hidden) return false;
  if (model.source === 'builtin')
    return (
      !operation ||
      imageModelSupportsOperation(model, operation, referenceCount)
    );
  if (!model.configuration.available) return false;
  return (operation ? [operation] : IMAGE_OPERATIONS).some(
    (candidate) =>
      imageModelSupportsOperation(model, candidate, referenceCount) &&
      model.configuration.priceCards.some(
        (price) => price.operation === candidate
      )
  );
}

export function imageModelSelectionError(
  selectedIds: readonly string[],
  catalog: readonly ImageModelDefinition[],
  operation?: ImageOperation,
  referenceCount?: number
): Error | null {
  const unavailable = selectedIds.find(
    (id) => !isSelectableImageModelId(id, catalog, operation, referenceCount)
  );
  return unavailable
    ? new Error('The selected image model is unavailable for this operation.')
    : null;
}
