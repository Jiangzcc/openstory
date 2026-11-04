import { withThemeByClassName } from '@storybook/addon-themes';
import type { Decorator, Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RealtimeProvider } from '@/platform/ui/realtime/client';
import { TooltipProvider } from '@/ui/shadcn/tooltip';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { setupWorker } from 'msw/browser';
import { handlers } from '../src/mocks/handlers';

import '../src/styles/global.css';
import { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createApplicationI18n } from '../src/ui/i18n/runtime';
import { resolveLocale } from '../src/platform/i18n/locale';

const withI18n: Decorator = function WithI18n(Story, context) {
  const locale = resolveLocale(context.globals.locale);
  const i18n = useMemo(() => createApplicationI18n(locale), [locale]);
  return (
    <I18nextProvider i18n={i18n}>
      <Story />
    </I18nextProvider>
  );
};

/*
 * Initializes MSW with our API handlers
 * See https://github.com/mswjs/msw-storybook-addon#configuring-msw
 * to learn how to customize it
 */

// Create a client for Storybook
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Components render <Link> (e.g. SceneListItem), which needs a router context.
// A root-only memory router is enough: links resolve, nothing navigates.
const withRouter: Decorator = (Story) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Story /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
};

const withProviders: Decorator = (Story) => (
  <QueryClientProvider client={queryClient}>
    <RealtimeProvider>
      {/* Radix Tooltip needs a provider (same as src/components/providers.tsx). */}
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    </RealtimeProvider>
  </QueryClientProvider>
);

const preview: Preview = {
  globalTypes: {
    locale: {
      description: 'Language / 语言',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'zh-CN', title: '简体中文' },
          { value: 'en', title: 'English' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    backgrounds: {
      disabled: true,
    },

    // Adds default padding around components
    layout: 'padded',

    viewport: {},

    // Configure MSW handlers globally for all stories
    msw: {
      handlers,
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },

  loaders: [
    mswLoader(async () => {
      const worker = setupWorker();
      await worker.start({ onUnhandledFrame: 'bypass' });
      return worker;
    }),
  ],

  decorators: [
    withI18n,
    withProviders,
    withRouter,
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark',
      },
      defaultTheme: 'dark',
    }),
  ],

  initialGlobals: {
    locale: 'zh-CN',
    viewport: {
      value: 'responsive',
      isRotated: false,
    },
  },
};

export default preview;
