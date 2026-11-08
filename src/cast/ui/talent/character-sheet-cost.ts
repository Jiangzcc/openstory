import type { CharacterLook } from '@/platform/server/db/schema';
import type { defaultLookFaceState } from '@/cast/look-sheet-face';

export function characterSheetReferenceImageCount(
  look: Pick<CharacterLook, 'isDefault'> | undefined,
  referencePhotoUrl: string | null | undefined,
  faceState: ReturnType<typeof defaultLookFaceState>
): number | undefined {
  if (!look) return undefined;
  return Number(
    look.isDefault ? Boolean(referencePhotoUrl) : faceState === 'ready'
  );
}
