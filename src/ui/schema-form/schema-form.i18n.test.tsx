import type { JsonSchema } from '@/models/catalog';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { TooltipProvider } from '@/ui/shadcn/tooltip';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from './schema-form';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string', title: 'Prompt' },
    duration: {
      type: 'string',
      title: 'Duration',
      enum: ['auto', '4', '5', '6', '7', '8', '9', '10'],
    },
    vendor_field: { type: 'string', title: 'Vendor-specific setting' },
  },
  required: ['prompt', 'vendor_field'],
};

function renderForm(locale: 'zh-CN' | 'en') {
  const value = { prompt: 'My original English prompt' };
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <TooltipProvider>
        <SchemaForm schema={schema} value={value} onChange={vi.fn()} />
      </TooltipProvider>
    </I18nextProvider>
  );
  return { html, value };
}

describe('schema form localization', () => {
  it('translates field labels and selected defaults while preserving values', () => {
    const { html, value } = renderForm('zh-CN');
    expect(html).toContain('提示词');
    expect(html).toContain('时长');
    expect(html).toContain('模型默认值');
    expect(html).toContain('Vendor-specific setting');
    expect(html).toContain('My original English prompt');
    expect(value).toEqual({ prompt: 'My original English prompt' });
  });

  it('keeps the original English labels in English mode', () => {
    const { html } = renderForm('en');
    expect(html).toContain('Prompt');
    expect(html).toContain('Duration');
    expect(html).toContain('Model default');
    expect(html).not.toContain('提示词');
  });
});
