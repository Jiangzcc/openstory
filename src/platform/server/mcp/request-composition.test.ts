import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createServerEntry } from '@tanstack/react-start/server';
// oxlint-disable-next-line boundaries/no-raw-db -- substitute the isolated in-memory DB at the factory boundary
import { getDb } from '#db-client';
import { generateId } from '@/platform/id';
import { LOCALE_COOKIE } from '@/platform/i18n/locale';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  apikey,
  enforcementActions,
  member,
  organization,
  sequences,
  user,
  verification,
} from '@/platform/server/db/schema';
import { getAuth } from '@/platform/server/auth/config';
import { handleMcpPost } from './handle';
import {
  authWithOrganizationRequestMiddleware,
  type OrganizationContext,
} from '@/platform/middleware.fn';
import { Route as SequencesRoute } from '@/routes/api/v1/sequences';
import { asStub } from '@/test/as-stub';

const runtime = vi.hoisted(() => ({
  create: vi.fn(async ({ id }: { id: string; params: unknown }) => ({ id })),
  network: vi.fn(async () => {
    throw new Error('Unexpected network in local composition test');
  }),
  env: {
    VITE_APP_URL: 'http://localhost:3998',
    BETTER_AUTH_SECRET:
      'synthetic-local-composition-secret-at-least-32-characters',
    ADMIN_EMAILS: '',
    OPENROUTER_KEY: 'synthetic-local-key',
    FAL_KEY: 'synthetic-local-key',
    ELEVENLABS_API_KEY: '',
    E2E_TEST: 'false',
  },
}));

vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#flush-scheduler', () => ({
  scheduleFlushAnalytics: vi.fn(async () => undefined),
}));
vi.mock('#env', () => ({
  getEnv: () => ({
    ...runtime.env,
    STORYBOARD_WORKFLOW: { create: runtime.create },
  }),
}));
vi.mock('cloudflare:workers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('cloudflare:workers')>()),
  env: { MCP_JWT_RATE_LIMITER: { limit: async () => ({ success: true }) } },
}));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.mock('@/platform/server/emails/email-service', () => ({
  sendOtpEmail: vi.fn(async () => ({ success: true })),
  sendOrganizationInvitationEmail: vi.fn(async () => ({ success: true })),
}));

// Seeded identities/OTP, real production auth and D1; only external effects use doubles.
const origin = runtime.env.VITE_APP_URL;
const protocol = '2026-07-28';
const app = createServerEntry({
  fetch: (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/auth/')) return getAuth().handler(request);
    if (pathname === '/api/v1/sequences') return dispatchRest(request);
    return handleMcpPost(request);
  },
});

async function dispatchRest(request: Request): Promise<Response> {
  const callback = authWithOrganizationRequestMiddleware.options.server;
  const handlers = SequencesRoute.options.server?.handlers;
  if (
    !callback ||
    !handlers ||
    typeof handlers === 'function' ||
    !handlers.POST
  ) {
    throw new Error('Expected the production REST middleware and POST handler');
  }
  const post = handlers.POST;
  const next = async ({ context }: { context: OrganizationContext }) =>
    post(asStub<Parameters<typeof post>[0]>({ request, context }));
  // Framework routing is driven explicitly; auth, context construction and service writes are real.
  const result = await callback(
    asStub<Parameters<typeof callback>[0]>({
      request,
      pathname: '/api/v1/sequences',
      handlerType: 'router',
      context: {},
      next,
    })
  );
  if (!(result instanceof Response))
    throw new Error('Expected the route Response');
  return result;
}

let database: Awaited<ReturnType<typeof createTestDb>>;
let caller: Awaited<ReturnType<typeof signIn>>;
let other: Awaited<ReturnType<typeof signIn>>;

async function signIn() {
  const id = generateId();
  const organizationId = generateId();
  const email = 'p3-' + id.toLowerCase() + '@example.invalid';
  await database.db
    .insert(user)
    .values({ id, email, name: 'Synthetic P3 caller', status: 'active' });
  await database.db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic P3 organization',
    slug: organizationId,
  });
  await database.db.insert(member).values({
    id: generateId(),
    organizationId,
    userId: id,
    role: 'owner',
    createdAt: new Date(),
  });
  await database.db.insert(verification).values({
    id: generateId(),
    identifier: 'sign-in-otp-' + email,
    value: '123456:0',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const response = await app.fetch(
    new Request(origin + '/api/auth/sign-in/email-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, otp: '123456' }),
    })
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(cookie).toContain('session_token=');
  return { id, email, organizationId, cookie };
}

async function issueKey(actor = caller, organizationId = actor.organizationId) {
  const response = await app.fetch(
    new Request(origin + '/api/auth/api-key/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        cookie: actor.cookie,
      },
      body: JSON.stringify({
        name: 'Synthetic composition key',
        prefix: 'osk_',
        metadata: { organizationId },
      }),
    })
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return z
    .object({ id: z.string(), key: z.string() })
    .parse(await response.json());
}

function mcpRequest(
  headers: HeadersInit,
  args: Record<string, unknown> = {},
  name = 'openstory.create_sequence'
) {
  return new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocol,
      'mcp-method': 'tools/call',
      'mcp-name': name,
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': protocol,
          'io.modelcontextprotocol/clientInfo': {
            name: 'synthetic-p3-composition',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        arguments:
          name === 'openstory.create_sequence'
            ? {
                script:
                  '小鹿 walks past the lighthouse. “Keep this dialogue.” ' +
                  generateId(),
                enhance: 'off',
                startFrames: true,
                stopAt: 'script',
                ...args,
              }
            : args,
      },
    }),
  });
}

const envelope = z.object({
  result: z
    .object({ isError: z.boolean().optional(), structuredContent: z.unknown() })
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  vi.stubGlobal('fetch', runtime.network);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await database.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  runtime.env.ADMIN_EMAILS = '';
  caller = await signIn();
  other = await signIn();
});

type Credential = 'session' | 'authorization' | 'x-api-key' | 'oauth';
const credentials: Credential[] = [
  'session',
  'authorization',
  'x-api-key',
  'oauth',
];
const localeCookies = [undefined, 'zh-CN', 'en', 'invalid', '%E0%A4%A'];

async function signedOAuth(
  options: {
    scopes?: string;
    audience?: string;
    organizationId?: string;
    expiresAt?: number;
  } = {}
) {
  // A signed JWT fixture uses the production signer/JWKS, not a consent/code exchange.
  const { token } = await getAuth().api.signJWT({
    body: {
      payload: {
        sub: caller.id,
        aud: options.audience ?? origin + '/mcp',
        iss: origin,
        scope: options.scopes ?? 'generate sequences:read sequences:write',
        organization_id: options.organizationId ?? caller.organizationId,
        exp: options.expiresAt ?? Math.floor(Date.now() / 1000) + 600,
        jti: generateId(),
      },
    },
  });
  return token;
}

async function credentialHeaders(
  kind: Credential,
  locale?: string,
  audience = origin + '/mcp'
): Promise<Headers> {
  const headers = new Headers();
  const cookies = locale === undefined ? [] : [LOCALE_COOKIE + '=' + locale];
  if (kind === 'session') cookies.push(caller.cookie);
  else cookies.push(other.cookie);
  if (kind === 'authorization' || kind === 'x-api-key') {
    const { key } = await issueKey();
    headers.set(kind, kind === 'authorization' ? 'Bearer ' + key : key);
  }
  if (kind === 'oauth')
    headers.set('authorization', 'Bearer ' + (await signedOAuth({ audience })));
  headers.set('cookie', cookies.join('; '));
  return headers;
}

async function created(response: Response, actor = caller) {
  expect(response.status, await response.clone().text()).toBe(200);
  const body = envelope.parse(await response.json());
  expect(body.error).toBeUndefined();
  expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
  const content = z
    .object({
      sequences: z.array(
        z.object({ id: z.string(), workflowRunId: z.string() })
      ),
    })
    .parse(body.result?.structuredContent);
  expect(content.sequences).toHaveLength(1);
  const [entry] = content.sequences;
  if (!entry) throw new Error('Missing created sequence');
  const stored = await database.db.query.sequences.findFirst({
    where: { id: entry.id },
  });
  expect(stored).toMatchObject({
    organizationId: actor.organizationId,
    createdBy: actor.id,
    workflowRunId: entry.workflowRunId,
  });
  expect(runtime.create).toHaveBeenCalledOnce();
  expect(runtime.create.mock.calls[0]?.[0]).toMatchObject({
    id: entry.workflowRunId,
    params: {
      userId: actor.id,
      organizationId: actor.organizationId,
      promptLocale: 'en',
      sequenceId: entry.id,
      script: stored?.script,
    },
  });
  expect(runtime.network).not.toHaveBeenCalled();
  return stored;
}

async function noNewSequence() {
  expect(
    await database.db
      .select()
      .from(sequences)
      .where(eq(sequences.organizationId, caller.organizationId))
  ).toEqual([]);
  expect(
    await database.db
      .select()
      .from(sequences)
      .where(eq(sequences.organizationId, other.organizationId))
  ).toEqual([]);
  expect(runtime.create).not.toHaveBeenCalled();
  expect(runtime.network).not.toHaveBeenCalled();
}

describe.each(credentials)(
  'real %s credential through MCP HTTP, D1 and shared service',
  (kind) => {
    it.each(localeCookies)(
      'keeps external English and original script for Cookie %s',
      async (locale) => {
        const headers = await credentialHeaders(kind, locale);
        const script =
          '用户原文 — 灯塔前的小鹿说：“Keep this dialogue.” ' + generateId();
        const stored = await created(
          await app.fetch(mcpRequest(headers, { script }))
        );
        expect(stored?.script).toBe(script);
        expect(stored?.createdBy).not.toBe(other.id);
      }
    );

    it('cannot let JSON identity or locale override the authenticated caller', async () => {
      const headers = await credentialHeaders(kind, 'zh-CN');
      await created(
        await app.fetch(
          mcpRequest(headers, {
            userId: other.id,
            user: { id: other.id },
            organizationId: other.organizationId,
            promptLocale: 'zh-CN',
            scopedDb: { organizationId: other.organizationId },
            context: {
              userId: other.id,
              organizationId: other.organizationId,
              promptLocale: 'zh-CN',
            },
          })
        )
      );
      expect(
        await database.db
          .select()
          .from(sequences)
          .where(eq(sequences.organizationId, other.organizationId))
      ).toEqual([]);
    });

    it('refuses the next write after real membership removal without choosing another organization', async () => {
      const headers = await credentialHeaders(kind, 'en');
      const warm = await app.fetch(mcpRequest(headers, {}, 'whoami'));
      expect(warm.status).toBe(200);
      await database.db.delete(member).where(eq(member.userId, caller.id));
      const response = await app.fetch(mcpRequest(headers));
      expect(response.status).toBe(403);
      await noNewSequence();
    });

    it.each(['user', 'organization'] as const)(
      'refuses terminated %s before domain writes',
      async (subject) => {
        const headers = await credentialHeaders(kind);
        await database.db.insert(enforcementActions).values({
          id: generateId(),
          action: 'account_terminated',
          reason: 'other',
          ...(subject === 'user'
            ? { subjectUserId: caller.id }
            : { subjectOrganizationId: caller.organizationId }),
        });
        const response = await app.fetch(mcpRequest(headers));
        expect(response.status).toBe(403);
        await noNewSequence();
      }
    );
  }
);

describe('real credential rejection and organization selection', () => {
  it('refuses an unauthenticated request with forged actor data', async () => {
    const response = await app.fetch(
      mcpRequest(
        {},
        { userId: caller.id, organizationId: caller.organizationId }
      )
    );
    expect(response.status).toBe(401);
    await noNewSequence();
  });

  it.each(['authorization', 'x-api-key'] as const)(
    'refuses an invalid %s key despite another valid Cookie',
    async (header) => {
      const fakeKey = 'osk_' + 'x'.repeat(64);
      const response = await app.fetch(
        mcpRequest({
          [header]: header === 'authorization' ? 'Bearer ' + fakeKey : fakeKey,
          cookie: other.cookie,
        })
      );
      expect(response.status).toBe(401);
      await noNewSequence();
    }
  );

  it.each(['disabled', 'expired'] as const)(
    'refuses a real %s key despite a valid Cookie',
    async (kind) => {
      const key = await issueKey();
      await database.db
        .update(apikey)
        .set(
          kind === 'disabled'
            ? { enabled: false }
            : { expiresAt: new Date(Date.now() - 60_000) }
        )
        .where(eq(apikey.id, key.id));
      const response = await app.fetch(
        mcpRequest({ authorization: 'Bearer ' + key.key, cookie: other.cookie })
      );
      expect(response.status).toBe(401);
      await noNewSequence();
    }
  );

  it('acts for key metadata when its owner belongs to two organizations', async () => {
    await database.db.insert(member).values({
      id: generateId(),
      organizationId: other.organizationId,
      userId: caller.id,
      role: 'member',
      createdAt: new Date(),
    });
    const { key } = await issueKey(caller, other.organizationId);
    const response = await app.fetch(
      mcpRequest({ authorization: 'Bearer ' + key, cookie: caller.cookie })
    );
    await created(response, {
      ...caller,
      organizationId: other.organizationId,
    });
    expect(
      await database.db
        .select()
        .from(sequences)
        .where(eq(sequences.organizationId, caller.organizationId))
    ).toEqual([]);
  });

  it.each(['owner', 'admin', 'member'] as const)(
    'preserves create access for organization %s role',
    async (role) => {
      await database.db
        .update(member)
        .set({ role })
        .where(eq(member.userId, caller.id));
      await created(
        await app.fetch(mcpRequest(await credentialHeaders('authorization')))
      );
    }
  );

  it('refuses a key naming an organization its owner does not belong to', async () => {
    const { key } = await issueKey(caller, other.organizationId);
    const response = await app.fetch(
      mcpRequest({ authorization: 'Bearer ' + key, cookie: other.cookie })
    );
    expect(response.status).toBe(403);
    await noNewSequence();
  });
});

describe('real OAuth signature, audience, expiry and scope', () => {
  it.each(['wrong-audience', 'expired', 'tampered'] as const)(
    'refuses %s JWT despite a valid Cookie',
    async (kind) => {
      const token = await signedOAuth({
        ...(kind === 'wrong-audience' ? { audience: origin + '/api/v1' } : {}),
        ...(kind === 'expired'
          ? { expiresAt: Math.floor(Date.now() / 1000) - 60 }
          : {}),
      });
      const segments = token.split('.');
      if (kind === 'tampered')
        segments[2] =
          (segments[2]?.startsWith('a') ? 'b' : 'a') + segments[2]?.slice(1);
      const response = await app.fetch(
        mcpRequest({
          authorization: 'Bearer ' + segments.join('.'),
          cookie: other.cookie,
        })
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain(
        'invalid_token'
      );
      await noNewSequence();
    }
  );

  it('lets read-only OAuth identify its caller but refuses the generate tool before writes', async () => {
    const token = await signedOAuth({ scopes: 'sequences:read' });
    const headers = { authorization: 'Bearer ' + token, cookie: other.cookie };
    const who = await app.fetch(mcpRequest(headers, {}, 'whoami'));
    expect(who.status).toBe(200);
    expect(JSON.stringify(await who.json())).toContain(caller.organizationId);
    const response = await app.fetch(mcpRequest(headers));
    expect(response.status).toBe(200);
    const body = envelope.parse(await response.json());
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    });
    await noNewSequence();
  });
});

describe('real enforcement reaches the workflow admission backstop', () => {
  it.each(['generation_suspended', 'account_suspended'] as const)(
    'keeps %s readable and starts no generation',
    async (action) => {
      const headers = await credentialHeaders('authorization');
      await database.db.insert(enforcementActions).values({
        id: generateId(),
        subjectUserId: caller.id,
        action,
        reason: 'other',
      });
      const who = await app.fetch(mcpRequest(headers, {}, 'whoami'));
      expect(who.status).toBe(200);
      const response = await app.fetch(mcpRequest(headers));
      expect(response.status).toBe(200);
      const body = envelope.parse(await response.json());
      expect(body.result?.isError).toBe(true);
      expect(body.result?.structuredContent).toMatchObject({
        error: { code: 'ACCOUNT_RESTRICTED' },
      });
      expect(runtime.create).not.toHaveBeenCalled();
      expect(runtime.network).not.toHaveBeenCalled();
      // A script-only create may already have written its failed row before the trigger guard.
    }
  );
});

describe('real system-admin API Key exception remains narrowly scoped', () => {
  it.each(credentials)(
    'only an admin API Key rebinds the foreign organization for %s',
    async (kind) => {
      const foreign = await created(
        await app.fetch(mcpRequest({ cookie: other.cookie })),
        other
      );
      if (!foreign) throw new Error('Missing foreign sequence');
      await database.db
        .update(sequences)
        .set({ status: 'completed', workflowRunId: null })
        .where(eq(sequences.id, foreign.id));
      runtime.create.mockClear();
      runtime.env.ADMIN_EMAILS = caller.email;
      const headers = await credentialHeaders(kind, 'zh-CN');
      const script =
        '保留跨组织原文。The lighthouse keeper returns. ' + generateId();
      const response = await app.fetch(
        mcpRequest(
          headers,
          { sequenceId: foreign.id, script },
          'openstory.regenerate_storyboard'
        )
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = envelope.parse(await response.json());
      if (kind === 'session' || kind === 'oauth') {
        expect(body.result?.isError).toBe(true);
        expect(body.result?.structuredContent).toMatchObject({
          error: { code: 'NOT_FOUND' },
        });
        expect(runtime.create).not.toHaveBeenCalled();
        const stored = await database.db
          .select()
          .from(sequences)
          .where(eq(sequences.organizationId, other.organizationId));
        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBe(foreign.id);
      } else {
        expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
        const content = z
          .object({
            sequenceId: z.string(),
            sourceSequenceId: z.string(),
            workflowRunId: z.string(),
          })
          .parse(body.result?.structuredContent);
        expect(content.sourceSequenceId).toBe(foreign.id);
        expect(runtime.create).toHaveBeenCalledOnce();
        expect(runtime.create.mock.calls[0]?.[0]).toMatchObject({
          id: content.workflowRunId,
          params: {
            userId: caller.id,
            organizationId: other.organizationId,
            promptLocale: 'en',
            sequenceId: content.sequenceId,
            script,
          },
        });
        expect(
          await database.db.query.sequences.findFirst({
            where: { id: content.sequenceId },
          })
        ).toMatchObject({
          organizationId: other.organizationId,
          createdBy: caller.id,
          script,
          workflowRunId: content.workflowRunId,
        });
      }
      expect(
        await database.db
          .select()
          .from(sequences)
          .where(eq(sequences.organizationId, caller.organizationId))
      ).toEqual([]);
      expect(runtime.network).not.toHaveBeenCalled();
    }
  );

  it('refuses the same foreign sequence for a normal API Key', async () => {
    const foreign = await created(
      await app.fetch(mcpRequest({ cookie: other.cookie })),
      other
    );
    if (!foreign) throw new Error('Missing foreign sequence');
    runtime.create.mockClear();
    const response = await app.fetch(
      mcpRequest(
        await credentialHeaders('authorization'),
        { sequenceId: foreign.id },
        'openstory.get_sequence'
      )
    );
    const body = envelope.parse(await response.json());
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.network).not.toHaveBeenCalled();
  });

  it('rejects an untrusted Origin before a valid credential starts work', async () => {
    const headers = await credentialHeaders('authorization');
    headers.set('origin', 'https://untrusted-p3.example.invalid');
    const response = await app.fetch(mcpRequest(headers));
    expect(response.status).toBe(403);
    await noNewSequence();
  });
});

function restRequest(headers: HeadersInit, args: Record<string, unknown> = {}) {
  return new Request(origin + '/api/v1/sequences', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify({
      script: '网页以外调用不翻译原文。Keep the user dialogue. ' + generateId(),
      enhance: 'off',
      startFrames: true,
      stopAt: 'script',
      ...args,
    }),
  });
}

async function createdRest(response: Response) {
  expect(response.status, await response.clone().text()).toBe(202);
  const content = z
    .object({
      sequences: z.array(
        z.object({ id: z.string(), workflowRunId: z.string() })
      ),
    })
    .parse(await response.json());
  expect(content.sequences).toHaveLength(1);
  const [entry] = content.sequences;
  if (!entry) throw new Error('Missing REST sequence');
  const stored = await database.db.query.sequences.findFirst({
    where: { id: entry.id },
  });
  expect(stored).toMatchObject({
    organizationId: caller.organizationId,
    createdBy: caller.id,
    workflowRunId: entry.workflowRunId,
  });
  expect(runtime.create).toHaveBeenCalledOnce();
  expect(runtime.create.mock.calls[0]?.[0]).toMatchObject({
    id: entry.workflowRunId,
    params: {
      userId: caller.id,
      organizationId: caller.organizationId,
      promptLocale: 'en',
      sequenceId: entry.id,
      script: stored?.script,
    },
  });
  expect(runtime.network).not.toHaveBeenCalled();
  return stored;
}

describe('REST middleware and shared creation with real authentication and D1', () => {
  it.each(credentials)(
    'keeps trusted identity and English with real %s and forged JSON',
    async (kind) => {
      const headers = await credentialHeaders(
        kind,
        'zh-CN',
        origin + '/api/v1'
      );
      const script = '不翻译这句台词。“Keep this dialogue.” ' + generateId();
      const stored = await createdRest(
        await app.fetch(
          restRequest(headers, {
            script,
            userId: other.id,
            user: { id: other.id },
            organizationId: other.organizationId,
            promptLocale: 'zh-CN',
            scopedDb: { organizationId: other.organizationId },
          })
        )
      );
      expect(stored?.script).toBe(script);
      expect(
        await database.db
          .select()
          .from(sequences)
          .where(eq(sequences.organizationId, other.organizationId))
      ).toEqual([]);
    }
  );

  it.each(credentials)(
    'rechecks actual membership on the next REST write for %s',
    async (kind) => {
      const headers = await credentialHeaders(kind, 'en', origin + '/api/v1');
      await createdRest(await app.fetch(restRequest(headers)));
      runtime.create.mockClear();
      await database.db.delete(member).where(eq(member.userId, caller.id));
      const response = await app.fetch(restRequest(headers));
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: 'NO_ORGANIZATION' },
      });
      expect(
        await database.db
          .select()
          .from(sequences)
          .where(eq(sequences.organizationId, caller.organizationId))
      ).toHaveLength(1);
      expect(runtime.create).not.toHaveBeenCalled();
      expect(runtime.network).not.toHaveBeenCalled();
    }
  );

  it.each(['account_suspended', 'account_terminated'] as const)(
    'refuses actual %s before REST writes',
    async (action) => {
      const headers = await credentialHeaders('authorization');
      await database.db.insert(enforcementActions).values({
        id: generateId(),
        subjectUserId: caller.id,
        action,
        reason: 'other',
      });
      const response = await app.fetch(restRequest(headers));
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: 'ACCOUNT_RESTRICTED' },
      });
      await noNewSequence();
    }
  );

  it('verifies a real scoped JWT before refusing a REST generation call', async () => {
    const token = await signedOAuth({
      scopes: 'sequences:read',
      audience: origin + '/api/v1',
    });
    const response = await app.fetch(
      restRequest({ authorization: 'Bearer ' + token, cookie: other.cookie })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    });
    await noNewSequence();
  });
});
