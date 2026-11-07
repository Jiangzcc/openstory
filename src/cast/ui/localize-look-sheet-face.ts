import type { TFunction } from 'i18next';
import type { defaultLookFaceState } from '@/cast/look-sheet-face';

const FACE_MESSAGES = {
  ready: {
    default: 'Drawn from the default look. The face stays; the outfit changes.',
    named:
      'Drawn from the default look, {{name}}. The face stays; the outfit changes.',
  },
  generating: {
    default: 'Drawn from the default look. That sheet is still generating.',
    named:
      'Drawn from the default look, {{name}}. That sheet is still generating.',
  },
  missing: {
    default:
      'Drawn from the default look. Generate that sheet first, or upload one for this look.',
    named:
      'Drawn from the default look, {{name}}. Generate that sheet first, or upload one for this look.',
  },
} as const;

function hasDefaultName(name: string) {
  return name.trim().toLowerCase() === 'default';
}

export function localizeDefaultLookCaption(
  translate: TFunction<'cast'>,
  name: string,
  hasOtherLooks: boolean
): string {
  if (!hasOtherLooks)
    return translate(
      'This is the default look. Looks you add keep this face and change the outfit.'
    );
  return hasDefaultName(name)
    ? translate(
        'This is the default look. Other looks keep this face and change the outfit.'
      )
    : translate(
        'This is the default look, {{name}}. Other looks keep this face and change the outfit.',
        { name }
      );
}

export function localizeLookSheetFaceMessage(
  translate: TFunction<'cast'>,
  name: string,
  state: ReturnType<typeof defaultLookFaceState>
): string {
  const messages = FACE_MESSAGES[state];
  return translate(hasDefaultName(name) ? messages.default : messages.named, {
    name,
  });
}
