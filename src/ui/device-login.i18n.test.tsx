import { Route } from '@/routes/_app/device';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/device-auth.fn', () => ({
  decideDeviceGrantFn: vi.fn(),
  lookupDeviceGrantFn: vi.fn(),
}));
vi.mock('@/platform/ui/auth/route-guards', () => ({
  requireSessionOrRedirect: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

function renderStatus(locale: 'zh-CN' | 'en', status: 'approved' | 'denied') {
  const userCode = 'ABCD-EFGH';
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(['deviceGrant', userCode], {
    status,
    teamName: 'User team',
  });
  vi.spyOn(Route, 'useSearch').mockReturnValue({ user_code: userCode });
  vi.spyOn(Route, 'useNavigate').mockReturnValue(vi.fn());
  const Page = Route.options.component;
  if (!Page) throw new Error('Device route has no component');
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <QueryClientProvider client={queryClient}>
        <Page />
      </QueryClientProvider>
    </I18nextProvider>
  );
}

describe('device login terminal status localization', () => {
  it.each([
    ['approved', '批准'],
    ['denied', '拒绝'],
  ] as const)(
    'localizes the persisted %s status and preserves the device code',
    (status, translated) => {
      const html = renderStatus('zh-CN', status);
      expect(html).toContain('已' + translated);
      expect(html).toContain('<code class="font-mono">ABCD-EFGH</code>');
      expect(html).not.toContain('已' + status);
    }
  );

  it.each(['approved', 'denied'] as const)(
    'preserves English %s wording',
    (status) => {
      const html = renderStatus('en', status);
      expect(html).toContain('has already been ' + status + '.');
      expect(html).toContain('ABCD-EFGH');
    }
  );
});
