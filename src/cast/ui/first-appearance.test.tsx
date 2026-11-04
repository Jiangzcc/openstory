import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { Locale } from '@/platform/i18n/locale';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { FirstAppearance } from './first-appearance';

const fixtureMention = {
  firstMentionSceneId: 'scene_001',
  firstMentionLine: 12,
  firstMentionText: 'First Appears {{value2}} & <draft>',
};

function renderMention(
  locale: Locale,
  mention: ComponentProps<typeof FirstAppearance>['mention']
) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <FirstAppearance mention={mention} />
    </I18nextProvider>
  );
}

describe('first appearance display', () => {
  it('localizes the scene and line while keeping the quoted script verbatim', () => {
    const html = renderMention('zh-CN', fixtureMention);
    expect(html).toContain('场景 scene_001，第 12 行');
    expect(html).toContain('First Appears {{value2}} &amp; &lt;draft&gt;');
    expect(html).not.toContain(', Line');
  });

  it('preserves the English scene and line display', () => {
    expect(renderMention('en', fixtureMention)).toContain(
      'Scene scene_001, Line 12'
    );
    expect(
      renderMention('en', { ...fixtureMention, firstMentionLine: null })
    ).not.toContain(', Line');
  });

  it('stays hidden without a first scene', () => {
    expect(renderMention('zh-CN', null)).toBe('');
    expect(
      renderMention('zh-CN', { ...fixtureMention, firstMentionSceneId: null })
    ).toBe('');
  });
});
