import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, Trans } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { PORTRAIT_RIGHTS_V1 } from '@/platform/compliance/attestations';
import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useTemplateTranslation } from '@/look/ui/use-template-translation';
import { AttestationStatementText } from '@/cast/ui/attestation-statement-text';
import { createApplicationI18n } from './runtime';

function renderChinese(children: ReactNode) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n()}>{children}</I18nextProvider>
  );
}

function StyleName({ isTemplate }: { isTemplate: boolean }) {
  const translateTemplate = useTemplateTranslation({ isTemplate });
  return <span>{translateTemplate('Product Ad')}</span>;
}

describe('localized rendering boundaries', () => {
  it('localizes managed presets and preserves an identically named user style', () => {
    expect(renderChinese(<StyleName isTemplate />)).toContain('产品广告');
    expect(renderChinese(<StyleName isTemplate={false} />)).toContain(
      'Product Ad'
    );
  });

  it('shows the exact signed English attestation beside its Chinese translation', () => {
    const html = renderChinese(
      <AttestationStatementText id="rights" text={PORTRAIT_RIGHTS_V1.text} />
    );
    expect(html).toContain('签署声明的英文原文');
    expect(html).toContain('<p lang="en">' + PORTRAIT_RIGHTS_V1.text + '</p>');
    expect(html).toMatch(/<p id="rights">[^<]*[一-鿿]/);
  });

  it('preserves unknown attestation text instead of guessing its meaning', () => {
    const html = renderChinese(
      <AttestationStatementText id="rights" text="Future statement v2" />
    );
    expect(html).toContain('Future statement v2');
    expect(html).not.toContain('签署声明的英文原文');
  });

  it('keeps rich text and user text as React content', () => {
    const html = renderChinese(
      <Trans
        ns="cast"
        i18nKey="Type @ in a prompt or script to insert <0>{{value1}}</0>."
        values={{ value1: 'User & Name' }}
        components={[<code key="name" />]}
      />
    );
    expect(html).toContain('<code>User &amp; Name</code>');
    expect(html).toMatch(/[一-鿿]/);
  });

  it.each(['zh-CN', 'en'] as const)(
    'preserves interpolation syntax and markup inside user names in %s',
    (locale) => {
      const i18n = createApplicationI18n(locale);
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <Trans
            ns="cast"
            i18nKey="Type @ in a prompt or script to insert <0>{{value1}}</0>."
            values={{
              value1: 'Draft {{value2}} & <0>original</0> &lt;note&gt;',
              value2: 'Grok Imagine',
            }}
            components={[<code key="name" />]}
          />
        </I18nextProvider>
      );
      expect(html).toContain(
        '<code>Draft {{value2}} &amp; &lt;0&gt;original&lt;/0&gt; &amp;lt;note&amp;gt;</code>'
      );
      expect(html).not.toContain('Grok Imagine');
      expect(
        i18n.t('Type @ in a prompt or script to insert <0>{{value1}}</0>.', {
          ns: 'cast',
          value1: 'Draft {{value2}}',
          value2: 'Grok Imagine',
        })
      ).toContain('Draft {{value2}}');
    }
  );

  it('uses the current language when an already registered callback completes', async () => {
    const i18n = createApplicationI18n();
    const capture = vi.fn<(translateEvent: TFunction<'shots'>) => void>();
    function CaptureNotification({ onCapture }: { onCapture: typeof capture }) {
      const translateEvent = useLiveTranslation('shots');
      onCapture(translateEvent);
      return null;
    }
    renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <CaptureNotification onCapture={capture} />
      </I18nextProvider>
    );
    const translateEvent = capture.mock.calls[0]?.[0];
    expect(translateEvent).toBeDefined();
    expect(translateEvent?.('Music track uploaded')).toBe('配乐已上传');
    await i18n.changeLanguage('en');
    expect(translateEvent?.('Music track uploaded')).toBe(
      'Music track uploaded'
    );
  });
});
