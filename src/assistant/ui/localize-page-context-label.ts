import type { i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';
import type { PageContextItem } from '@/assistant/page-context';

const DRAFT_CONTEXT_KINDS = new Set<PageContextItem['kind']>([
  'draft_script',
  'draft_prompt',
  'selection',
]);

export function localizePageContextLabel(i18n: I18n, item: PageContextItem) {
  return DRAFT_CONTEXT_KINDS.has(item.kind)
    ? translateStaticLabel(i18n, 'assistant', item.label)
    : item.label;
}
