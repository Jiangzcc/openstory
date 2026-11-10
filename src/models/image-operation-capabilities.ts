import type { ImageOperation } from './image-channel-parameters';
import type { ImageOperationBinding } from './image-channels';

export const IMAGE_OPERATION_ISSUES = {
  unavailable: 'operation-unavailable',
  references: 'reference-count-unsupported',
  mask: 'mask-unavailable',
} as const;
type ImageOperationIssue =
  (typeof IMAGE_OPERATION_ISSUES)[keyof typeof IMAGE_OPERATION_ISSUES];
const VERIFIED_CAPABILITY_STATUS = 'verified';
const EDIT_OPERATION: ImageOperation = 'edit';

export function imageOperationIssue({
  binding,
  operation,
  referenceImageCount,
  hasMask,
}: {
  binding: Omit<ImageOperationBinding, 'upstreamModel'> | undefined;
  operation: ImageOperation;
  referenceImageCount: number;
  hasMask?: boolean;
}): ImageOperationIssue | null {
  if (binding?.status !== VERIFIED_CAPABILITY_STATUS)
    return IMAGE_OPERATION_ISSUES.unavailable;
  if (
    !Number.isSafeInteger(referenceImageCount) ||
    referenceImageCount < binding.minReferenceImages ||
    referenceImageCount > binding.maxReferenceImages
  )
    return IMAGE_OPERATION_ISSUES.references;
  if (
    hasMask &&
    (operation !== EDIT_OPERATION ||
      binding.mask !== VERIFIED_CAPABILITY_STATUS)
  )
    return IMAGE_OPERATION_ISSUES.mask;
  return null;
}
