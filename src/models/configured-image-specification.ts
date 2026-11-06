import { ASPECT_RATIOS } from './aspect-ratios';
import type { AspectRatio } from './aspect-ratios';
import type {
  ImageChannelParameter,
  ImageOperation,
} from './image-channel-parameters';
import { supportsConfiguredImageSize } from './image-resource-budget';
import {
  RESOLUTIONS,
  resolutionDimensions,
  tierForShortEdge,
} from './resolutions';
import type { Resolution } from './resolutions';

export const CONFIGURED_IMAGE_RESOLUTION_ERROR =
  'The image model has no verified size for this resolution.';
const ASPECT_ERROR =
  'The image model has no verified size for this aspect ratio.';

export interface ConfiguredImageOutputOptions {
  aspectRatios: AspectRatio[];
  resolutions: Resolution[];
  fixedSize?: string;
  automatic: boolean;
}

function sizeDefinition(
  definitions: readonly ImageChannelParameter[],
  operation: ImageOperation
) {
  return definitions.find(
    (field) =>
      field.key === 'size' &&
      field.status === 'verified' &&
      field.operations.includes(operation)
  );
}

function dimensions(size: string) {
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size);
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : undefined;
}

function matchesRatio(size: string, ratio: AspectRatio): boolean {
  const value = dimensions(size);
  const [width, height] = ratio.split(':').map(Number);
  return Boolean(
    value && value.width * Number(height) === value.height * Number(width)
  );
}

function candidateSizes(definition: ImageChannelParameter): string[] {
  return [
    ...new Set([...(definition.values ?? []), definition.defaultValue]),
  ].filter(
    (value): value is string =>
      typeof value === 'string' &&
      value !== 'auto' &&
      supportsConfiguredImageSize(value)
  );
}

function derivedSize(resolution: Resolution, ratio: AspectRatio): string {
  const { width, height } = resolutionDimensions(resolution, ratio);
  return width + 'x' + height;
}

function tierOfSize(size: string): Resolution | undefined {
  const value = dimensions(size);
  return value
    ? tierForShortEdge(Math.min(value.width, value.height))
    : undefined;
}

function chooseSize(
  sizes: string[],
  ratio: AspectRatio,
  resolution: Resolution
): string {
  const [first] = sizes;
  if (sizes.length === 1 && first) return first;
  const target = derivedSize(resolution, ratio);
  if (sizes.includes(target)) return target;
  const candidates = sizes.filter((size) => tierOfSize(size) === resolution);
  const wanted = resolutionDimensions(resolution, ratio);
  const distance = (size: string) => {
    const value = dimensions(size);
    return value
      ? Math.abs(value.width - wanted.width) +
          Math.abs(value.height - wanted.height)
      : Infinity;
  };
  const selected = candidates.sort((a, b) => distance(a) - distance(b))[0];
  if (!selected) throw new Error(CONFIGURED_IMAGE_RESOLUTION_ERROR);
  return selected;
}

export function resolveConfiguredImageSize(
  definition: ImageChannelParameter,
  ratio: AspectRatio,
  resolution?: Resolution
): string {
  if (!definition.values && resolution) {
    const size = derivedSize(resolution, ratio);
    if (!supportsConfiguredImageSize(size))
      throw new Error(CONFIGURED_IMAGE_RESOLUTION_ERROR);
    return size;
  }
  const sizes = candidateSizes(definition).filter((size) =>
    matchesRatio(size, ratio)
  );
  const [first] = sizes;
  if (first) return resolution ? chooseSize(sizes, ratio, resolution) : first;
  if (definition.values?.includes('auto') || definition.defaultValue === 'auto')
    return 'auto';
  throw new Error(ASPECT_ERROR);
}

export function configuredImageOutputOptions(
  definitions: readonly ImageChannelParameter[],
  operation: ImageOperation,
  ratio: AspectRatio
): ConfiguredImageOutputOptions {
  const field = sizeDefinition(definitions, operation);
  if (!field) return { aspectRatios: [], resolutions: [], automatic: true };
  if (!field.values) {
    return {
      aspectRatios: ASPECT_RATIOS.map((option) => option.value),
      resolutions: RESOLUTIONS.filter((tier) =>
        supportsConfiguredImageSize(derivedSize(tier, ratio))
      ),
      automatic: false,
    };
  }
  return enumeratedOutputOptions(field, ratio);
}

function enumeratedOutputOptions(
  field: ImageChannelParameter,
  ratio: AspectRatio
): ConfiguredImageOutputOptions {
  const all = candidateSizes(field);
  const sizes = all.filter((size) => matchesRatio(size, ratio));
  const resolutions = RESOLUTIONS.filter((tier) =>
    sizes.some((size) => tierOfSize(size) === tier)
  );
  const [onlyResolution] = resolutions;
  const fixedSize =
    resolutions.length === 1 && onlyResolution
      ? chooseSize(sizes, ratio, onlyResolution)
      : undefined;
  return {
    aspectRatios: ASPECT_RATIOS.filter((option) =>
      all.some((size) => matchesRatio(size, option.value))
    ).map((option) => option.value),
    resolutions,
    ...(fixedSize ? { fixedSize } : {}),
    automatic: !all.length && Boolean(field.values?.includes('auto')),
  };
}
