import { createRouter } from '@tanstack/react-router';
import { I18nextProvider } from 'react-i18next';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { resolveLocale } from '@/platform/i18n/locale';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { DefaultNotFound } from '@/ui/error/default-not-found';
import { captureRouteError } from '@/ui/react-errors';
import { getQueryClient } from '@/ui/query-client';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = getQueryClient();
  const i18n = createApplicationI18n();

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    context: { queryClient, i18n },
    Wrap: ({ children }) => (
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    ),
    dehydrate: () => ({ locale: resolveLocale(i18n.resolvedLanguage) }),
    hydrate: async ({ locale }) => {
      await i18n.changeLanguage(resolveLocale(locale));
    },
    defaultNotFoundComponent: DefaultNotFound,
    // Boundary-caught errors never hit window.onerror; this is how they reach
    // PostHog, with the component stack (#1283).
    defaultOnCatch: captureRouteError,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
