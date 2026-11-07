import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { MOCK_SYSTEM_STYLES } from '@/look/style-templates';
import { parseStyleConfig } from '@/look/style-config';
import type { Locale } from '@/platform/i18n/locale';
import type { Style } from '@/platform/server/db/schema';
import { createApplicationI18n } from '@/ui/i18n/runtime';

vi.mock('radix-ui', async (importOriginal) => {
  const radix = await importOriginal<typeof import('radix-ui')>();
  return {
    ...radix,
    Dialog: {
      ...radix.Dialog,
      // SSR has no portal host; the dialog content and primitives remain real.
      Portal: ({ children }: ComponentProps<typeof radix.Dialog.Portal>) => (
        <>{children}</>
      ),
    },
  };
});

import { StyleDetailDialog } from './style-detail-dialog';

function productStyle(overrides: Partial<Style> = {}): Style {
  const style = MOCK_SYSTEM_STYLES.find(({ name }) => name === 'Product Ad');
  if (!style) throw new Error('Expected Product Ad template');
  return { ...style, previewUrl: null, sampleVideos: [], ...overrides };
}

function createDialogRouter() {
  const root = createRootRoute();
  const home = createRoute({ path: '/', getParentRoute: () => root });
  const styles = createRoute({ path: '/styles', getParentRoute: () => root });
  return createRouter({
    routeTree: root.addChildren([home, styles]),
    history: createMemoryHistory({ initialEntries: ['/styles'] }),
    isServer: false,
    origin: 'http://localhost',
  });
}

function renderDialog(
  style: Style,
  locale: Locale,
  {
    inComposer = true,
    router,
  }: {
    inComposer?: boolean;
    router?: ReturnType<typeof createDialogRouter>;
  } = {}
) {
  const content = (
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <StyleDetailDialog
        style={style}
        open
        onOpenChange={vi.fn()}
        onUseStyle={inComposer ? vi.fn() : undefined}
        onTryStyle={inComposer ? vi.fn() : undefined}
      />
    </I18nextProvider>
  );
  return renderToStaticMarkup(
    router ? (
      <RouterContextProvider router={router}>{content}</RouterContextProvider>
    ) : (
      content
    )
  );
}

function textMarkup(text: string) {
  return renderToStaticMarkup(<span>{text}</span>).slice(
    '<span>'.length,
    -'</span>'.length
  );
}

describe('style detail dialog localization', () => {
  it.each([
    ['en', 'Use the Product Ad style'],
    ['zh-CN', '使用产品广告风格'],
  ] as const)(
    'links the library CTA to a style-only composer in %s',
    async (locale, label) => {
      const router = createDialogRouter();
      await router.load();
      const html = renderDialog(productStyle(), locale, {
        inComposer: false,
        router,
      });
      const link = html.match(
        new RegExp(`<a\\b(?=[^>]*aria-label="${label}")[^>]*>`)
      )?.[0];
      expect(link).toBeDefined();
      const href = link?.match(/href="([^"]+)"/)?.[1];
      if (!href) throw new Error('Library CTA has no destination');
      const destination = new URL(
        href.replaceAll('&amp;', '&'),
        'http://localhost'
      );
      expect(destination.pathname).toBe('/');
      expect(destination.searchParams.get('style')).toBe('product-ad');
      expect(destination.searchParams.get('prefill')).toBe('style');
      expect(destination.hash).toBe('#compose');
    }
  );

  it.each([
    ['en', 'Use the Product Ad style'],
    ['zh-CN', '使用产品广告风格'],
  ] as const)(
    'keeps the in-composer CTA as a selection button in %s',
    (locale, label) => {
      const html = renderDialog(productStyle(), locale);
      expect(html).toMatch(
        new RegExp(`<button\\b(?=[^>]*aria-label="${label}")[^>]*>`)
      );
      expect(html).not.toMatch(
        new RegExp(`<a\\b(?=[^>]*aria-label="${label}")[^>]*>`)
      );
    }
  );

  it('renders a platform style name, description, configuration, references and tags in Chinese', () => {
    const style = productStyle();
    const config = parseStyleConfig(style.config);
    const html = renderDialog(style, 'zh-CN');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('产品广告');
    expect(html).toContain('氛围');
    expect(html).toContain('使用此风格');
    const details = html.match(/<dd\b[^>]*>(.*?)<\/dd>/g) ?? [];
    expect(details).toHaveLength(5);
    for (const value of details) expect(value).toMatch(/[\u4e00-\u9fff]/);
    for (const original of [
      config.look.mood,
      config.look.artStyle,
      config.look.lighting,
      config.look.colorGrading,
      config.motion.camera,
      ...config.references,
      ...(style.tags ?? []),
    ]) {
      expect(html).not.toContain(`>${textMarkup(original)}<`);
    }
    expect(html).toContain('title="#FFFFFF"');
  });

  it('renders the original platform recipe in English mode', () => {
    const style = productStyle();
    const config = parseStyleConfig(style.config);
    const html = renderDialog(style, 'en');
    expect(html).toContain('Product Ad');
    expect(html).toContain('Use this style');
    for (const original of [
      style.description ?? '',
      config.look.mood,
      config.look.artStyle,
      config.look.lighting,
      config.look.colorGrading,
      config.motion.camera,
      ...config.references,
      ...(style.tags ?? []),
    ]) {
      expect(html).toContain(textMarkup(original));
    }
    expect(html).not.toContain('产品广告');
  });

  it('preserves a user style even when its name and recipe exactly match a template', () => {
    const style = productStyle({ isTemplate: false });
    const config = parseStyleConfig(style.config);
    const html = renderDialog(style, 'zh-CN');
    expect(html).toContain('Product Ad');
    expect(html).not.toContain('产品广告');
    for (const original of [
      style.description ?? '',
      config.look.mood,
      config.look.artStyle,
      config.look.lighting,
      config.look.colorGrading,
      config.motion.camera,
      ...config.references,
      ...(style.tags ?? []),
    ]) {
      expect(html).toContain(textMarkup(original));
    }
    expect(html).toContain('氛围');
  });

  it('preserves edited or unknown template fields as escaped content', () => {
    const base = productStyle();
    const config = parseStyleConfig(base.config);
    const edited = 'My own <ink & "light"> {{reference}}';
    const style = productStyle({
      config: {
        ...config,
        look: { ...config.look, mood: edited },
        references: [edited],
      },
      tags: [edited],
    });
    const html = renderDialog(style, 'zh-CN');
    expect(
      html.match(
        new RegExp(
          textMarkup(edited).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'g'
        )
      )
    ).toHaveLength(3);
    expect(html).not.toContain('<ink');
  });
});
