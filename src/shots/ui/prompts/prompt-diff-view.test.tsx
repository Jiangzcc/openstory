import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { PromptDiffView } from './prompt-diff-view';

afterEach(() => vi.restoreAllMocks());

describe('localized prompt differences', () => {
  it('keeps keyed segments and their original text while localizing change labels', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={createApplicationI18n('zh-CN')}>
        <PromptDiffView before="The room is warm." after="The room is cold." />
      </I18nextProvider>
    );
    expect(html).toContain('aria-label="已添加"');
    expect(html).toContain('aria-label="已移除"');
    expect(html).toContain('warm');
    expect(html).toContain('cold');
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unique "key"');
  });
});
