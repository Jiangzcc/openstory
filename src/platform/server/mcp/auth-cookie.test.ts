import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { apiKey } from '@better-auth/api-key';
import { beforeEach, expect, it, vi } from 'vitest';
import { readPublicApiKeyFromHeaders } from '@/platform/server/auth/public-api-key';

const ORIGIN = 'http://localhost:3999';
const ORGANIZATION = '01JSY7HY76H4X7NRAAQN9RS3EA';
const EMAIL = 'admin-cookie-probe@example.invalid';
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

beforeEach(() => {
  vi.clearAllMocks();
  getUserOrganizationMembership.mockResolvedValue({
    organizationId: ORGANIZATION,
    organizationName: 'Synthetic diagnostic organization',
    role: 'owner',
  });
});

it('keeps a real signed cookie organization-scoped without API-key admin access', async () => {
  const signup = await auth.api.signUpEmail({
    body: {
      email: EMAIL,
      name: 'Cookie probe',
      password: 'synthetic-password-123',
    },
    asResponse: true,
  });
  expect(signup.status).toBe(200);
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(cookie).toContain('session_token=');
  const headers = new Headers({ cookie });
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

it('still rejects a request without a cookie, API key or OAuth token', async () => {
  const result = await authenticateMcpRequest(new Request(`${ORIGIN}/mcp`));
  expect(result).toBeInstanceOf(Response);
  if (!(result instanceof Response))
    throw new Error('Missing credentials accepted');
  expect(result.status).toBe(401);
  expect(getUserOrganizationMembership).not.toHaveBeenCalled();
});
