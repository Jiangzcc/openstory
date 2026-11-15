import type { ScopedDb } from '@/platform/server/db/scoped';
import type { Locale } from '@/platform/i18n/locale';
import { ValidationError } from '@/platform/errors';
import {
  AUTO_STYLE_ID,
  type AutoStyleDraft,
  placeholderAutoStyleDraft,
} from '@/look/auto-style';
import { parseStyleConfig } from '@/look/style-config';
import type { StyleConfig } from '@/look/style-config';
import { localizeTemplateStyleConfig } from '@/look/localization/style-content';

export type StyleSource =
  | { kind: 'library'; config: StyleConfig }
  /** Fresh automatic style: placeholder row now, recipe derived by the run. */
  | { kind: 'pending'; draft: AutoStyleDraft }
  /** Copy of another sequence's (already derived) automatic style. */
  | { kind: 'clone'; draft: AutoStyleDraft };

export async function resolveStyleSource(
  scopedDb: {
    styles: ScopedDb['styles'];
    sequences: Pick<ScopedDb['sequences'], 'getById'>;
  },
  styleId: string,
  locale: Locale = 'en'
): Promise<StyleSource> {
  if (styleId === AUTO_STYLE_ID) {
    return { kind: 'pending', draft: placeholderAutoStyleDraft() };
  }
  // `getById` hides other organizations' bound rows, so reaching the clone branch
  // means the source is ours.
  const style = await scopedDb.styles.getById(styleId);
  if (!style) {
    throw new ValidationError(`Style ${styleId} not found`);
  }
  if (style.sequenceId === null) {
    return {
      kind: 'library',
      config: localizeTemplateStyleConfig(style, locale),
    };
  }
  // Copying a sequence whose style is still being derived: the source row
  // holds only the placeholder, so the copy derives its own.
  const source = await scopedDb.sequences.getById(style.sequenceId);
  if (source?.styleConfig == null) {
    return { kind: 'pending', draft: placeholderAutoStyleDraft() };
  }
  return {
    kind: 'clone',
    draft: {
      name: style.name,
      description: style.description,
      config: parseStyleConfig(source.styleConfig),
      category: style.category,
      tags: style.tags ?? [],
    },
  };
}
