import type { getSessionFn } from '@/platform/session.fn';
import { sessionQueryOptions } from '@/platform/ui/auth/session-query';
import { Route } from '@/routes/docs';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { UserSidebarFooter } from '@/ui/layout/user-sidebar-footer';
import { SidebarMenu, SidebarProvider } from '@/ui/shadcn/sidebar';
import { TooltipProvider } from '@/ui/shadcn/tooltip';
import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { i18n as I18n } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<Session>>(),
}));
vi.mock('@/platform/session.fn', () => ({
  getSessionFn: () => mocks.getSession(),
}));
vi.mock('@/platform/ui/auth/client', () => ({
  authClient: { signOut: vi.fn(), organization: {} },
  authData: vi.fn(),
}));
vi.mock('@/billing/ui/system-admin-status', () => ({
  systemAdminStatusQueryOptions: {
    queryKey: ['system-admin-status'],
    queryFn: vi.fn(),
  },
}));
vi.mock('content-collections', () => ({ allDocs: [] }));

type Session = Awaited<ReturnType<typeof getSessionFn>>;
const clients: QueryClient[] = [];
const signedInSession = {
  session: {
    id: '01K9AT4D9D2FT3N30TRZ95C4F1',
    activeOrganizationId: '01K9AT4D9D2FT3N30TRZ95C4F2',
    userId: '01K9AT4D9D2FT3N30TRZ95C4F3',
    token: 'mock-browser-session',
    expiresAt: new Date('2026-11-09T00:00:00Z'),
    createdAt: new Date('2026-11-08T00:00:00Z'),
    updatedAt: new Date('2026-11-08T00:00:00Z'),
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: '01K9AT4D9D2FT3N30TRZ95C4F3',
    name: 'Story writer',
    email: 'writer@example.test',
    image: null,
    emailVerified: true,
    status: 'active',
    createdAt: new Date('2026-11-08T00:00:00Z'),
    updatedAt: new Date('2026-11-08T00:00:00Z'),
  },
  membership: {
    organizationId: '01K9AT4D9D2FT3N30TRZ95C4F2',
    organizationName: 'Story organization',
    role: 'member',
  },
} satisfies Session;

function createClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return client;
}

function createDocsRouter(queryClient: QueryClient) {
  const root = createRootRouteWithContext<{
    queryClient: QueryClient;
    i18n: I18n;
  }>()();
  const docs = createRoute({
    getParentRoute: () => root,
    path: '/docs',
    beforeLoad: (context) => Route.options.beforeLoad?.({ ...context }),
  });
  const login = createRoute({ getParentRoute: () => root, path: '/login' });
  return createRouter({
    routeTree: root.addChildren([docs, login]),
    context: { queryClient, i18n: createApplicationI18n('en') },
    history: createMemoryHistory({ initialEntries: ['/docs'] }),
    isServer: true,
    origin: 'http://localhost',
  });
}

function renderFooter(
  queryClient: QueryClient,
  router: ReturnType<typeof createDocsRouter>
) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={router.options.context.i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider>
            <SidebarProvider>
              <SidebarMenu>
                <UserSidebarFooter />
              </SidebarMenu>
            </SidebarProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function expectPublicDocsLoaded(router: ReturnType<typeof createDocsRouter>) {
  expect(router.state.location.pathname).toBe('/docs');
  expect(router.state.matches.at(-1)?.status).toBe('success');
}

beforeEach(() => mocks.getSession.mockReset());
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('public docs session snapshot', () => {
  it('renders anonymous sign-in on the server and from the serialized client cache', async () => {
    mocks.getSession.mockResolvedValue(null);
    const serverClient = createClient();
    const serverRouter = createDocsRouter(serverClient);
    await serverRouter.load();
    expectPublicDocsLoaded(serverRouter);
    const serverHtml = renderFooter(serverClient, serverRouter);
    expect(serverHtml).toContain('href="/login"');
    expect(serverHtml).toContain('Sign in');
    expect(serverHtml).not.toContain('animate-pulse');

    const client = createClient();
    hydrate(client, JSON.parse(JSON.stringify(dehydrate(serverClient))));
    const clientRouter = createDocsRouter(client);
    await clientRouter.load();
    expectPublicDocsLoaded(clientRouter);
    expect(client.getQueryData(sessionQueryOptions.queryKey)).toBeNull();
    expect(renderFooter(client, clientRouter)).toBe(serverHtml);
    expect(mocks.getSession).toHaveBeenCalledOnce();
  });

  it('preserves the signed-in identity in both initial footer renders', async () => {
    mocks.getSession.mockResolvedValue(signedInSession);
    const serverClient = createClient();
    const serverRouter = createDocsRouter(serverClient);
    await serverRouter.load();
    expectPublicDocsLoaded(serverRouter);
    const serverHtml = renderFooter(serverClient, serverRouter);
    expect(serverHtml).toContain('Story writer');
    expect(serverHtml).toContain('writer@example.test');
    expect(serverHtml).not.toContain('href="/login"');
    expect(serverHtml).not.toContain('animate-pulse');

    const client = createClient();
    hydrate(client, JSON.parse(JSON.stringify(dehydrate(serverClient))));
    const clientRouter = createDocsRouter(client);
    await clientRouter.load();
    expect(renderFooter(client, clientRouter)).toBe(serverHtml);
    expect(mocks.getSession).toHaveBeenCalledOnce();
  });

  it('waits for a delayed session before completing the docs route', async () => {
    let resolveSession!: (session: Session) => void;
    mocks.getSession.mockReturnValue(
      new Promise<Session>((resolve) => {
        resolveSession = resolve;
      })
    );
    const client = createClient();
    const router = createDocsRouter(client);
    let loaded = false;
    const loading = router.load().then(() => {
      loaded = true;
    });
    await vi.waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
    expect(loaded).toBe(false);
    expect(client.getQueryState(sessionQueryOptions.queryKey)?.status).toBe(
      'pending'
    );
    expect(dehydrate(client).queries).toHaveLength(0);

    resolveSession(null);
    await loading;
    expect(loaded).toBe(true);
    expectPublicDocsLoaded(router);
    expect(renderFooter(client, router)).toContain('href="/login"');
    expect(renderFooter(client, router)).not.toContain('animate-pulse');
  });

  it('demonstrates the unseeded SSR branch that the docs boundary prevents', async () => {
    mocks.getSession.mockResolvedValue(null);
    const unseeded = createClient();
    const router = createDocsRouter(unseeded);
    const serverHtml = renderFooter(unseeded, router);
    expect(serverHtml).toContain('animate-pulse');
    expect(serverHtml).not.toContain('href="/login"');
    expect(dehydrate(unseeded).queries).toHaveLength(0);

    const client = createClient();
    await client.ensureQueryData(sessionQueryOptions);
    const settledHtml = renderFooter(client, createDocsRouter(client));
    expect(settledHtml).toContain('href="/login"');
    expect(settledHtml).not.toContain('animate-pulse');
    expect(settledHtml).not.toBe(serverHtml);
  });
});
