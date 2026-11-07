import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import type { Locale } from '@/platform/i18n/locale';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { RenderingField } from './rendering-field';

function renderField(
  value: string | null,
  locale: Locale,
  required = false,
  idPrefix = 'character'
) {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <form>
        <RenderingField
          idPrefix={idPrefix}
          defaultValue={value}
          required={required}
        />
      </form>
    </I18nextProvider>
  );
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  const hidden = inputs.find((input) => input.includes('type="hidden"'));
  const visible = inputs.find((input) => input.includes('data-slot="input"'));
  if (!hidden || !visible) throw new Error('Expected both rendering inputs');
  return { html, hidden, visible };
}

describe('rendering field localization', () => {
  it.each([
    ['zh-CN', '真人实拍', '呈现风格'],
    ['en', 'Photoreal live action', 'Rendered as'],
  ] as const)(
    'shows the default in %s and submits its canonical value',
    (locale, display, label) => {
      for (const prefix of ['character', 'location']) {
        const { html, hidden, visible } = renderField(
          PHOTOREAL_RENDERING,
          locale,
          true,
          prefix
        );
        expect(visible).toContain(`value="${display}"`);
        expect(hidden).toContain(`value="${PHOTOREAL_RENDERING}"`);
        expect(hidden).toContain('name="rendering"');
        expect(visible).not.toContain('name=');
        expect(html.match(/\bname="rendering"/g)).toHaveLength(1);
        expect(html).toContain(`for="${prefix}-rendering"`);
        expect(visible).toContain(`id="${prefix}-rendering"`);
        expect(html).toContain(label);
      }
    }
  );

  it.each([
    '真人实拍',
    '3D animated, Pixar-like',
    'Photoreal live action, watercolor texture',
    'photoreal live action',
    ' Photoreal live action ',
    '自定义水墨风格',
  ])('preserves custom rendering exactly: %s', (custom) => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const { visible, hidden } = renderField(custom, locale);
      expect(visible).toContain(`value="${custom}"`);
      expect(hidden).toContain(`value="${custom}"`);
    }
  });

  it('escapes custom text in both inputs without treating it as markup', () => {
    const { html, hidden, visible } = renderField(
      '<illustration & "ink">',
      'zh-CN'
    );
    const escaped = '&lt;illustration &amp; &quot;ink&quot;&gt;';
    expect(visible).toContain(`value="${escaped}"`);
    expect(hidden).toContain(`value="${escaped}"`);
    expect(html).not.toContain('<illustration');
  });

  it.each([
    [null, true],
    [null, false],
    ['', true],
    ['', false],
  ] as const)('keeps %s empty with required=%s', (value, required) => {
    const { visible, hidden, html } = renderField(value, 'zh-CN', required);
    expect(visible).toContain('value=""');
    expect(hidden).toContain('value=""');
    expect(html.match(/\bname="rendering"/g)).toHaveLength(1);
    expect(hidden).not.toContain('required=');
    if (required) expect(visible).toContain('required=""');
    else expect(visible).not.toContain('required=');
    expect(visible).not.toContain('真人实拍');
  });
});
