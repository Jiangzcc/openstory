import type { AspectRatio } from './aspect-ratios';
import type {
  ImageChannelParameter,
  ImageChannelParameterValues,
  ImageOperation,
} from './image-channel-parameters';
import { validateImageChannelParameters } from './image-channel-parameters';
import { requireConfiguredImageSize } from './image-resource-budget';
import type { Resolution } from './resolutions';
import { resolveConfiguredImageSize } from './configured-image-specification';

export type ConfiguredImageParameterInput = {
  parameters?: ImageChannelParameterValues;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  imageCount?: number;
  seed?: number;
  outputFormat?: string;
};

export function resolveConfiguredImageParameters(
  definitions: readonly ImageChannelParameter[],
  operation: ImageOperation,
  input: ConfiguredImageParameterInput = {}
): ImageChannelParameterValues {
  const active = definitions.filter(
    (definition) =>
      definition.status === 'verified' &&
      definition.operations.includes(operation)
  );
  const values: ImageChannelParameterValues = { ...input.parameters };
  const size = active.find((definition) => definition.key === 'size');
  if (values.size === undefined && size && input.aspectRatio) {
    values.size = resolveConfiguredImageSize(
      size,
      input.aspectRatio,
      input.resolution
    );
  }
  const inherited = {
    n: input.imageCount,
    seed: input.seed,
    output_format: input.outputFormat,
  };
  for (const definition of active) {
    const value = inheritedValue(definition.key, inherited);
    if (values[definition.key] === undefined && value !== undefined)
      values[definition.key] = value;
  }
  if (
    input.imageCount !== undefined &&
    input.imageCount > 1 &&
    !active.some((definition) => definition.key === 'n')
  ) {
    throw new Error(
      'This image model has no verified native image count parameter.'
    );
  }
  const parameters = validateImageChannelParameters(
    definitions,
    operation,
    values
  );
  requireConfiguredImageSize(parameters.size);
  return parameters;
}

function inheritedValue(
  key: string,
  inherited: { n?: number; seed?: number; output_format?: string }
): string | number | undefined {
  if (key === 'n') return inherited.n;
  if (key === 'seed') return inherited.seed;
  if (key === 'output_format') return inherited.output_format;
  return undefined;
}
