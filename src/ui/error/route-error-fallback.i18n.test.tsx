import { createApplicationI18n } from '@/ui/i18n/runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { RouteErrorFallback } from './route-error-fallback';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({
    state: {
      location: { pathname: '/stitch/example', href: '/stitch/example' },
    },
    invalidate: vi.fn(),
  }),
}));

function renderFallback(locale: 'zh-CN' | 'en', heading?: string) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <RouteErrorFallback
        error={new Error('Original diagnostic')}
        reset={vi.fn()}
        heading={heading}
      />
    </I18nextProvider>
  );
}

describe('route error fallback localization', () => {
  it('translates the omitted heading and preserves the diagnostic', () => {
    const html = renderFallback('zh-CN');
    expect(html).toContain('出错了');
    expect(html).toContain('Original diagnostic');
    expect(html).not.toContain('Something went wrong');
  });

  it('preserves an explicit caller heading', () => {
    const html = renderFallback('zh-CN', 'My original heading');
    expect(html).toContain('My original heading');
    expect(html).toContain('Original diagnostic');
  });

  it('keeps the original default English heading', () => {
    expect(renderFallback('en')).toContain('Something went wrong');
  });
});
