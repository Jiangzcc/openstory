import type { Decorator } from '@storybook/react-vite';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import type { i18n as I18n } from 'i18next';
import type { ReactNode } from 'react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { asStub } from '@/test/as-stub';

vi.mock('@storybook/addon-themes', () => ({
  withThemeByClassName: () => (Story: () => ReactNode) => createElement(Story),
}));
vi.mock('@/platform/ui/realtime/client', () => ({
  RealtimeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/ui/shadcn/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('msw-storybook-addon/csf3', () => ({ mswLoader: () => undefined }));
vi.mock('msw/browser', () => ({
  setupWorker: () => ({
    start: () => {
      throw new Error('Offline decorator tests must not start MSW');
    },
  }),
}));
vi.mock('@/mocks/handlers', () => ({ handlers: [] }));

import preview from '../../../.storybook/preview';

function decorate(
  index: number,
  Story: () => ReactNode,
  id: string,
  locale: string
) {
  const decorators = preview.decorators;
  const decorator = Array.isArray(decorators) ? decorators[index] : undefined;
  if (!decorator) throw new Error('Missing real Storybook decorator');
  return decorator(
    asStub<Parameters<Decorator>[0]>(Story),
    asStub<Parameters<Decorator>[1]>({ id, globals: { locale } })
  );
}

function captureClient(id: string) {
  let captured: QueryClient | undefined;
  const Probe = () => {
    captured = useQueryClient();
    return null;
  };
  const Wrap = () => decorate(1, Probe, id, 'en');
  renderToStaticMarkup(createElement(Wrap));
  if (!captured) throw new Error('No real query client captured');
  return captured;
}

function createOfflineRoot() {
  // A synthetic empty host avoids a DOM dependency; React's client reconciler executes the real key and state.
  const addEventListener = () => undefined;
  const removeEventListener = () => undefined;
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener,
    removeEventListener,
  };
  const window = {
    document,
    HTMLIFrameElement: class {},
    addEventListener,
    removeEventListener,
  };
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return createRoot(
    asStub<HTMLElement>({
      nodeType: 1,
      tagName: 'DIV',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: document,
      addEventListener,
      removeEventListener,
    })
  );
}

describe('Storybook decorator isolation', () => {
  it('isolates locale instances between story renders', async () => {
    const seen: I18n[] = [];
    const Probe = () => {
      const { t, i18n } = useTranslation('auth');
      seen.push(i18n);
      return createElement('span', null, t('Sign in · OpenStory'));
    };
    const Wrap = ({ locale }: { locale: string }) =>
      decorate(0, Probe, 'same-story', locale);
    expect(
      renderToStaticMarkup(createElement(Wrap, { locale: 'zh-CN' }))
    ).toContain('登录');
    expect(
      renderToStaticMarkup(createElement(Wrap, { locale: 'en' }))
    ).toContain('Sign in');
    expect(seen[0]).not.toBe(seen[1]);
    await seen[1]?.changeLanguage('zh-CN');
    expect(seen[0]?.resolvedLanguage).toBe('zh-CN');
  });

  it.each(['another-story', 'same-story'])(
    'isolates query results from a second instance named %s',
    async (secondId) => {
      const first = captureClient('same-story');
      const second = captureClient(secondId);
      // Synthetic story responses replace MSW/network; the real decorators and QueryClient execute.
      const fromA = vi.fn(async () => [{ id: 'MOCK_A', name: 'Story A' }]);
      const fromB = vi.fn(async () => [{ id: 'MOCK_B', name: 'Story B' }]);
      const queryKey = ['styles', 'list'];
      try {
        await first.fetchQuery({
          queryKey,
          queryFn: fromA,
          staleTime: Infinity,
        });
        expect(
          await second.fetchQuery({
            queryKey,
            queryFn: fromB,
            staleTime: Infinity,
          })
        ).toEqual([{ id: 'MOCK_B', name: 'Story B' }]);
        expect(fromA).toHaveBeenCalledOnce();
        expect(fromB).toHaveBeenCalledOnce();
      } finally {
        first.clear();
        second.clear();
      }
    }
  );

  it('keeps the cache on locale changes and remounts it on story changes', async () => {
    const clients: QueryClient[] = [];
    const Probe = () => {
      clients.push(useQueryClient());
      return null;
    };
    const Wrap = ({ id, locale }: { id: string; locale: string }) =>
      decorate(1, Probe, id, locale);
    const root = createOfflineRoot();
    const queryKey = ['styles', 'list'];
    try {
      for (const step of [
        { id: 'story-a', locale: 'zh-CN' },
        { id: 'story-a', locale: 'en' },
        { id: 'story-b', locale: 'en' },
      ]) {
        await act(async () => {
          root.render(createElement(Wrap, step));
        });
        clients[0]?.setQueryData(queryKey, 'MOCK_STORY_A');
      }
      expect(clients).toHaveLength(3);
      expect(clients[1]).toBe(clients[0]);
      expect(clients[1]?.getQueryData(queryKey)).toBe('MOCK_STORY_A');
      expect(clients[2]).not.toBe(clients[1]);
      expect(clients[2]?.getQueryData(queryKey)).toBeUndefined();
    } finally {
      await act(async () => {
        root.unmount();
      });
      for (const client of clients) client.clear();
      vi.unstubAllGlobals();
    }
  });
});
