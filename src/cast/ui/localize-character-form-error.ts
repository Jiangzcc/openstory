import type { TFunction } from 'i18next';
import type { z } from 'zod';

export function localizeCharacterFormError(
  error: z.ZodError,
  translate: TFunction<'cast'>
): string {
  const issue = error.issues[0];
  if (issue?.code === 'too_big' && issue.origin === 'string' && issue.inclusive)
    return translate('This field must be {{maximum}} characters or fewer.', {
      maximum: issue.maximum,
    });
  if (
    issue?.code === 'too_small' &&
    issue.origin === 'string' &&
    issue.inclusive
  )
    return translate('Minimum number of characters: {{minimum}}.', {
      minimum: issue.minimum,
    });
  return translate('Check the fields and try again.');
}
