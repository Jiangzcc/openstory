import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { apiKey } from '@better-auth/api-key';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readPublicApiKeyFromHeaders } from '@/platform/server/auth/public-api-key';

const ORIGIN = 'http://localhost:3999';
const ORGANIZATION = '01JSY7HY76H4X7NRAAQN9RS3EA';
const KEY_ORGANIZATION = '01JSY7HY76H4X7NRAAQN9RS3EB';
const EMAIL = 'admin-cookie-probe@example.invalid';
const MEMBER_EMAIL = 'member-cookie-probe@example.invalid';
const getApiKeyOrganizationId = vi.fn();
const getUserOrganizationMembership = vi.fn();

const auth = betterAuth({
  baseURL: ORIGIN,
  secret: 'temporary-diagnostic-secret-at-least-32-characters',
  database: memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
    apikey: [],
  }),
  telemetry: { enabled: false },
  emailAndPassword: { enabled: true },
  session: {
    cookieCache: { enabled: true, maxAge: 300, version: '2' },
    additionalFields: {
      activeOrganizationId: { type: 'string', required: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => ({
          data: { ...session, activeOrganizationId: ORGANIZATION },
        }),
      },
    },
  },
  plugins: [
    apiKey({
      enableSessionForAPIKeys: true,
      enableMetadata: true,
      defaultKeyLength: 64,
      rateLimit: { enabled: true, maxRequests: 10, timeWindow: 1000 },
      customAPIKeyGetter: (ctx) =>
        ctx.headers ? readPublicApiKeyFromHeaders(ctx.headers) : null,
    }),
  ],
});

vi.doMock('#env', () => ({
  getEnv: () => ({ VITE_APP_URL: ORIGIN, ADMIN_EMAILS: EMAIL }),
}));
vi.doMock('@/platform/server/auth/config', () => ({ getAuth: () => auth }));
vi.doMock('@/platform/server/db/scoped', () => ({
  getApiKeyOrganizationId,
  getUserById: vi.fn(),
  getUserOrganizationMembership,
  getSequenceByIdUnscoped: vi.fn(),
}));
vi.doMock('@/platform/server/compliance/generation-gate', () => ({
  loadComplianceState: vi.fn(async () => ({
    enforcement: { canAccess: true, canWrite: true },
  })),
}));
vi.doMock('@/platform/server/compliance/enforcement', () => ({
  restrictionNotice: () => 'restricted',
}));

const { authenticateMcpRequest } = await import('@/platform/server/mcp/auth');
const { adminSequenceAccessFor } =
  await import('@/platform/server/mcp/tool-context');

async function cookieSession(email: string) {
  const signup = await auth.api.signUpEmail({
    body: { email, name: 'Cookie probe', password: 'synthetic-password-123' },
    asResponse: true,
  });
  expect(signup.status).toBe(200);
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(cookie).toContain('session_token=');
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  if (!session) throw new Error('Synthetic cookie session was not created');
  return { cookie, user: session.user };
}

type CookieSession = Awaited<ReturnType<typeof cookieSession>>;
type KeyHeader = 'authorization' | 'x-api-key';
let admin: CookieSession;
let member: CookieSession;

beforeAll(async () => {
  admin = await cookieSession(EMAIL);
  member = await cookieSession(MEMBER_EMAIL);
});

async function issueKey(cookie: string) {
  return auth.api.createApiKey({
    headers: new Headers({ cookie }),
    body: {
      name: 'Synthetic MCP boundary key',
      prefix: 'osk_',
      metadata: { organizationId: KEY_ORGANIZATION },
    },
  });
}

function keyHeaders(header: KeyHeader, key: string, cookie?: string) {
  const headers = new Headers();
  headers.set(header, header === 'authorization' ? `Bearer ${key}` : key);
  if (cookie) headers.set('cookie', cookie);
  return headers;
}

async function authenticated(headers: Headers) {
  const result = await authenticateMcpRequest(
    new Request(`${ORIGIN}/mcp`, { headers })
  );
  if (result instanceof Response)
    throw new Error(`Authentication ${result.status}`);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  getApiKeyOrganizationId.mockResolvedValue(KEY_ORGANIZATION);
  // Organization and compliance checks are mocked; sessions and API keys are real.
  getUserOrganizationMembership.mockImplementation(
    async (_userId: string, organizationId: string) => ({
      organizationId,
      organizationName: 'Synthetic diagnostic organization',
      role: 'owner',
    })
  );
});

it('keeps a real signed cookie organization-scoped without API-key admin access', async () => {
  const headers = new Headers({ cookie: admin.cookie });
  expect(readPublicApiKeyFromHeaders(headers)).toBeNull();
  const session = await auth.api.getSession({ headers });
  expect(session?.user.email).toBe(EMAIL);
  expect(session?.session.activeOrganizationId).toBe(ORGANIZATION);
  const result = await authenticateMcpRequest(
    new Request(`${ORIGIN}/mcp`, { headers })
  );
  expect(result).not.toBeInstanceOf(Response);
  if (result instanceof Response) throw new Error('Cookie was rejected');
  expect(result.kind).toBe('session');
  expect(result.user.email).toBe(EMAIL);
  expect(result.organizationId).toBe(ORGANIZATION);
  expect(result.scopes).toEqual([]);
  const openOrganization = vi.fn();
  expect(
    adminSequenceAccessFor({
      kind: result.kind,
      email: result.user.email,
      openOrganization,
    })
  ).toBeUndefined();
  expect(getApiKeyOrganizationId).not.toHaveBeenCalled();
  expect(getUserOrganizationMembership).toHaveBeenCalledWith(
    session?.user.id,
    ORGANIZATION
  );
});

it.each(['authorization', 'x-api-key'] as const)(
  'validates a real issued API key from %s without a cookie',
  async (header) => {
    const issued = await issueKey(admin.cookie);
    const result = await authenticated(keyHeaders(header, issued.key));

    expect(result.kind).toBe('api_key');
    expect(result.user.id).toBe(admin.user.id);
    expect(result.session?.session.id).toBe(issued.id);
    expect(result.organizationId).toBe(KEY_ORGANIZATION);
    expect(getApiKeyOrganizationId).toHaveBeenCalledExactlyOnceWith(issued.id);
    expect(getUserOrganizationMembership).toHaveBeenCalledWith(
      admin.user.id,
      KEY_ORGANIZATION
    );
    const openOrganization = vi.fn();
    expect(
      adminSequenceAccessFor({
        kind: result.kind,
        email: result.user.email,
        openOrganization,
      })
    ).toBe(openOrganization);
  }
);

it.each(['authorization', 'x-api-key'] as const)(
  'uses the member key over another user admin cookie through %s',
  async (header) => {
    const issued = await issueKey(member.cookie);
    const result = await authenticated(
      keyHeaders(header, issued.key, admin.cookie)
    );

    expect(result.kind).toBe('api_key');
    expect(result.user.id).toBe(member.user.id);
    expect(result.session?.session.id).toBe(issued.id);
    expect(result.organizationId).toBe(KEY_ORGANIZATION);
    expect(getApiKeyOrganizationId).toHaveBeenCalledExactlyOnceWith(issued.id);
    expect(getUserOrganizationMembership).toHaveBeenCalledWith(
      member.user.id,
      KEY_ORGANIZATION
    );
    expect(
      adminSequenceAccessFor({
        kind: result.kind,
        email: result.user.email,
        openOrganization: vi.fn(),
      })
    ).toBeUndefined();
  }
);

it.each(['authorization', 'x-api-key'] as const)(
  'uses the admin key over another user member cookie through %s',
  async (header) => {
    const issued = await issueKey(admin.cookie);
    const result = await authenticated(
      keyHeaders(header, issued.key, member.cookie)
    );

    expect(result.kind).toBe('api_key');
    expect(result.user.id).toBe(admin.user.id);
    expect(result.session?.session.id).toBe(issued.id);
    expect(result.organizationId).toBe(KEY_ORGANIZATION);
    expect(getApiKeyOrganizationId).toHaveBeenCalledExactlyOnceWith(issued.id);
    const openOrganization = vi.fn();
    expect(
      adminSequenceAccessFor({
        kind: result.kind,
        email: result.user.email,
        openOrganization,
      })
    ).toBe(openOrganization);
  }
);

it.each(['authorization', 'x-api-key'] as const)(
  'rejects an invalid key through %s despite a valid admin cookie',
  async (header) => {
    const result = await authenticateMcpRequest(
      new Request(`${ORIGIN}/mcp`, {
        headers: keyHeaders(header, `osk_${'x'.repeat(64)}`, admin.cookie),
      })
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response))
      throw new Error('Invalid API key accepted');
    expect(result.status).toBe(401);
    expect(getApiKeyOrganizationId).not.toHaveBeenCalled();
    expect(getUserOrganizationMembership).not.toHaveBeenCalled();
  }
);

it('still rejects a request without a cookie, API key or OAuth token', async () => {
  const result = await authenticateMcpRequest(new Request(`${ORIGIN}/mcp`));
  expect(result).toBeInstanceOf(Response);
  if (!(result instanceof Response))
    throw new Error('Missing credentials accepted');
  expect(result.status).toBe(401);
  expect(getUserOrganizationMembership).not.toHaveBeenCalled();
});
