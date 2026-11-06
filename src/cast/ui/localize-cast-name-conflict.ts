import type { TFunction } from 'i18next';
import { errorCode, errorMessage } from '@/platform/errors';

const CONFLICT_ERROR_CODE = 'CONFLICT';
const SUFFIX = '. Rename one first.';
const TEMPLATES = [
  {
    separator: ' is already a name in the cast of ',
    key: '{{name}} is already a name in the cast of {{sequenceTitle}}. Rename one first.',
  },
  {
    separator: ' is already a location in ',
    key: '{{name}} is already a location in {{sequenceTitle}}. Rename one first.',
  },
] as const;

export function localizeCastNameConflict(
  error: unknown,
  translate: TFunction<'cast'>
): string {
  const message = errorMessage(error);
  if (errorCode(error) !== CONFLICT_ERROR_CODE || !message.endsWith(SUFFIX)) {
    return message;
  }
  const body = message.slice(0, -SUFFIX.length);
  const matches = TEMPLATES.flatMap(({ separator, key }) => {
    const parts = body.split(separator);
    return parts.length === 1 ? [] : [{ key, parts }];
  });
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match || match.parts.length !== 2) return message;
  const [name, sequenceTitle] = match.parts;
  if (!name?.trim() || !sequenceTitle?.trim()) return message;
  return translate(match.key, { name, sequenceTitle });
}
