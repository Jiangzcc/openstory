import type { ImageOperation } from '../image-channel-parameters';
import type { TextToImageModel } from '../models';
import type { ImageModelDefinition } from '../image-model-catalog';
import {
  getImageModelDefinition,
  imageModelDisplayName,
  isSelectableImageModelId,
} from '../image-model-catalog';
import {
  compareSelectorModels,
  QUALITY_DEFAULT_IMAGE,
  selectorGroup,
  TURBO_IMAGE_MODELS,
} from '../generation-mode';

const UNKNOWN_IMAGE_QUALITY_RANK = 1_000;
export type ImageModelCapabilityFilter = {
  operation?: ImageOperation;
  referenceCount?: number;
};
export type ImageModelOption = {
  id: TextToImageModel;
  name: string;
  group: 'fast' | 'quality';
  badge?: 'open-weight' | 'proprietary';
  disabled: boolean;
};

export function imageModelSelectorOptions(
  catalog: readonly ImageModelDefinition[],
  filter: ImageModelCapabilityFilter & {
    selectedIds?: readonly TextToImageModel[];
  } = {}
): ImageModelOption[] {
  const available = (id: string) =>
    isSelectableImageModelId(
      id,
      catalog,
      filter.operation,
      filter.referenceCount
    );
  const selected = filter.selectedIds ?? [];
  const entries = catalog
    .filter((model) => available(model.id) || selected.includes(model.id))
    .map((model) => ({
      id: model.id,
      name: model.name,
      group: selectorGroup(model.id, TURBO_IMAGE_MODELS),
      badge: model.license,
      disabled: !available(model.id),
    }));
  const missing = selected.filter(
    (id) => !entries.some((model) => model.id === id)
  );
  return entries
    .concat(
      missing.map((id) => ({
        id,
        name: imageModelDisplayName(id, catalog),
        group: selectorGroup(id, TURBO_IMAGE_MODELS),
        badge: undefined,
        disabled: true,
      }))
    )
    .sort((a, b) =>
      compareSelectorModels(
        a.id,
        b.id,
        TURBO_IMAGE_MODELS,
        QUALITY_DEFAULT_IMAGE,
        (id) =>
          getImageModelDefinition(id, catalog)?.qualityRank ??
          UNKNOWN_IMAGE_QUALITY_RANK
      )
    );
}
