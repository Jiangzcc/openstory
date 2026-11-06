import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';
import type { GeneratedAsset } from '@/platform/server/db/schema';

export type StudioImageOutputAsset = Pick<
  GeneratedAsset,
  'activity' | 'status' | 'input' | 'outputs'
>;

function requestedImageCount(
  input: StudioImageOutputAsset['input']
): number | null {
  const parameters = input.channelParameters;
  if (
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters)
  )
    return null;
  const requested = parameters.n;
  return typeof requested === 'number' &&
    Number.isSafeInteger(requested) &&
    requested >= 1 &&
    requested <= IMAGE_PARAMETER_LIMITS.maximumImages
    ? requested
    : null;
}

export function studioPartialImageOutput(
  asset: StudioImageOutputAsset
): { requested: number; actual: number } | null {
  if (asset.activity !== 'image' || asset.status !== 'completed') return null;
  const requested = requestedImageCount(asset.input);
  if (requested === null) return null;
  const actual = (asset.outputs ?? []).filter((output) =>
    output.contentType.startsWith('image/')
  ).length;
  return actual < requested ? { requested, actual } : null;
}
