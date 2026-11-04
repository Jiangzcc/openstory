import { createApplicationI18n } from '@/ui/i18n/runtime';
import { describe, expect, it } from 'vitest';
import { localizePageContextLabel } from './localize-page-context-label';

describe('assistant context label localization', () => {
  it('translates draft placeholders while preserving named resources', () => {
    const i18n = createApplicationI18n('zh-CN');
    const draft = {
      id: 'mock-draft',
      kind: 'draft_prompt',
      label: 'Unsaved prompt',
    } as const;
    const sequence = {
      id: 'mock-sequence',
      kind: 'sequence',
      label: 'Unsaved prompt',
    } as const;
    expect(localizePageContextLabel(i18n, draft)).toBe('未保存的提示词');
    expect(localizePageContextLabel(i18n, sequence)).toBe('Unsaved prompt');
    expect(draft.label).toBe('Unsaved prompt');
  });
});
