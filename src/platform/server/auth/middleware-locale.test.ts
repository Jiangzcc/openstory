import { beforeEach, expect, it, vi } from 'vitest';
import type { RequestPrincipal } from './request-principal';
import type { ResolvedOrganization } from './organization-memo';
import { asStub } from '@/test/as-stub';

// Synthetic principals and DB handles; execute the real middleware callbacks.
const resolvePrincipal = vi.fn();
const resolveMembership = vi.fn();
const createScopedDb = vi.fn();
const getFirstOrganizationId = vi.fn();
const setActiveOrganization = vi.fn();
const getRequest = vi.fn();
const flush = vi.fn();
const scopedDb = { organizationId: 'mock-organization' };
const user = { id: 'mock-user', name: 'Mock user' };
const cookies = [
  undefined,
  'openstory_locale=zh-CN',
  'openstory_locale=en',
  'openstory_locale=invalid',
];

vi.doMock('#flush-scheduler', () => ({ scheduleFlushAnalytics: flush }));
vi.doMock('@tanstack/react-start/server', () => ({ getRequest }));
vi.doMock('./config', () => ({
  getAuth: () => ({ api: { setActiveOrganization } }),
}));
vi.doMock('./organization-memo', () => ({
  resolveOrganizationAndCompliance: resolveMembership,
}));
vi.doMock('@/platform/server/db/scoped', () => ({
  createScopedDb,
  createSystemAdminScopedDb: vi.fn(),
  getFirstOrganizationId,
  getSequenceByIdUnscoped: vi.fn(),
  getApiKeyOrganizationId: vi.fn(),
  getUserById: vi.fn(),
}));
vi.doMock('./request-principal', async () => ({
  ...(await vi.importActual<typeof import('./request-principal')>(
    './request-principal'
  )),
  resolveRequestPrincipal: resolvePrincipal,
  apiResourceMetadataUrl: () => 'https://mock.invalid/resource',
}));

const {
  authWithOrganizationRequestMiddleware,
  authWithOrganizationMiddleware,
} = await import('@/platform/middleware.fn');
function serverCallback<T>(callback: T | undefined): T {
  if (!callback) throw new Error('Middleware server callback is required.');
  return callback;
}
const requestHandler = serverCallback(
  authWithOrganizationRequestMiddleware.options.server
);
const functionHandler = serverCallback(
  authWithOrganizationMiddleware.options.server
);

function principal(): RequestPrincipal {
  return asStub<RequestPrincipal>({
    user,
    session: null,
    organizationId: scopedDb.organizationId,
  });
}

function membership(canAccess = true, canWrite = true): ResolvedOrganization {
  return asStub<ResolvedOrganization>({
    organization: {
      organizationId: scopedDb.organizationId,
      organizationName: 'Mock organization',
    },
    compliance: { enforcement: { canAccess, canWrite } },
  });
}

function request(path: string, cookie?: string): Request {
  return new Request('https://mock.invalid' + path, {
    method: 'POST',
    headers: cookie ? { cookie } : undefined,
    body: JSON.stringify({
      promptLocale: 'zh-CN',
      userId: 'forged-user',
      organizationId: 'forged-org',
    }),
  });
}

async function runRequest(
  value: Request,
  next = vi.fn(async () => new Response(null))
) {
  await requestHandler(
    asStub<Parameters<typeof requestHandler>[0]>({
      request: value,
      pathname: new URL(value.url).pathname,
      handlerType: 'router',
      context: {
        promptLocale: 'forged',
        user: { id: 'forged-user' },
        organizationId: 'forged-org',
      },
      next,
    })
  );
  return next;
}

async function runFunction(next = vi.fn(async () => new Response(null))) {
  await functionHandler(
    asStub<Parameters<typeof functionHandler>[0]>({
      context: {
        user,
        session: { session: { activeOrganizationId: scopedDb.organizationId } },
        promptLocale: 'forged',
        organizationId: 'forged-org',
      },
      next,
    })
  );
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvePrincipal.mockResolvedValue(principal());
  resolveMembership.mockResolvedValue(membership());
  createScopedDb.mockReturnValue(scopedDb);
  getFirstOrganizationId.mockResolvedValue('mock-first-organization');
  setActiveOrganization.mockResolvedValue(undefined);
  getRequest.mockReturnValue(request('/create'));
  flush.mockResolvedValue(undefined);
});

it.each(cookies)(
  'fixes external request language and identity for Cookie %s',
  async (cookie) => {
    const value = request('/api/v1/sequences', cookie);
    const next = await runRequest(value);
    expect(next).toHaveBeenCalledWith({
      context: {
        user,
        session: null,
        oauth: undefined,
        promptLocale: 'en',
        organizationId: scopedDb.organizationId,
        scopedDb,
      },
    });
    expect(resolvePrincipal).toHaveBeenCalledWith(value);
    expect(resolveMembership).toHaveBeenCalledWith(
      user.id,
      'POST',
      scopedDb.organizationId
    );
    expect(createScopedDb).toHaveBeenCalledWith(
      scopedDb.organizationId,
      user.id
    );
    expect(flush).toHaveBeenCalledOnce();
  }
);

it.each(cookies)(
  'keeps the website request language for Cookie %s',
  async (cookie) => {
    const next = await runRequest(request('/api/storage/upload', cookie));
    expect(next).toHaveBeenCalledWith({
      context: expect.objectContaining({
        user,
        organizationId: scopedDb.organizationId,
        scopedDb,
        promptLocale: cookie === 'openstory_locale=en' ? 'en' : 'zh-CN',
      }),
    });
  }
);

it.each(cookies)(
  'keeps the server function language and organization for Cookie %s',
  async (cookie) => {
    getRequest.mockReturnValue(request('/create', cookie));
    const next = await runFunction();
    expect(next).toHaveBeenCalledWith({
      context: {
        organizationId: scopedDb.organizationId,
        organizationName: 'Mock organization',
        promptLocale: cookie === 'openstory_locale=en' ? 'en' : 'zh-CN',
        scopedDb,
      },
    });
    expect(createScopedDb).toHaveBeenCalledWith(
      scopedDb.organizationId,
      user.id
    );
  }
);

it('refuses unauthenticated requests before creating any scoped DB', async () => {
  resolvePrincipal.mockResolvedValue(null);
  const next = vi.fn(async () => new Response(null));
  await expect(
    runRequest(request('/api/v1/sequences'), next)
  ).rejects.toMatchObject({ status: 401 });
  expect(next).not.toHaveBeenCalled();
  expect(createScopedDb).not.toHaveBeenCalled();
  expect(flush).toHaveBeenCalledOnce();
});

it('keeps OAuth generation scope ahead of organization context creation', async () => {
  resolvePrincipal.mockResolvedValue({
    ...principal(),
    oauth: { scopes: ['sequences:read'] },
  });
  const next = vi.fn(async () => new Response(null));
  await expect(
    runRequest(request('/api/v1/sequences'), next)
  ).rejects.toMatchObject({ status: 403 });
  expect(resolveMembership).not.toHaveBeenCalled();
  expect(createScopedDb).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});

it.each([null, membership(false), membership(true, false)])(
  'keeps request membership and compliance rejection before context creation: %s',
  async (state) => {
    resolveMembership.mockResolvedValue(
      state ?? { organization: null, compliance: null }
    );
    const next = vi.fn(async () => new Response(null));
    await expect(
      runRequest(request('/api/v1/sequences'), next)
    ).rejects.toMatchObject({ status: 403 });
    expect(next).not.toHaveBeenCalled();
    expect(createScopedDb).not.toHaveBeenCalled();
  }
);

it('does not switch a removed member to another organization during a function write', async () => {
  resolveMembership.mockResolvedValue({ organization: null, compliance: null });
  const next = vi.fn(async () => new Response(null));
  await expect(runFunction(next)).rejects.toThrow(
    'Switch organization and try again.'
  );
  expect(getFirstOrganizationId).not.toHaveBeenCalled();
  expect(setActiveOrganization).not.toHaveBeenCalled();
  expect(createScopedDb).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
