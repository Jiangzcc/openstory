import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as studioActions from '@/studio/server/studio-asset-actions';
import { createServerEntry } from '@tanstack/react-start/server';
// oxlint-disable-next-line boundaries/no-raw-db -- isolated migrated D1 replaces only the database handle
import { getDb } from '#db-client';
import { uploadFile } from '#storage';
import { generateId } from '@/platform/id';
import { LOCALE_COOKIE, type Locale } from '@/platform/i18n/locale';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  credits,
  enforcementActions,
  member,
  organization,
  sequences,
  styles,
  user,
  verification,
} from '@/platform/server/db/schema';
import { getAuth } from '@/platform/server/auth/config';
import { PORTRAIT_RIGHTS_V1 } from '@/platform/compliance/attestations';
import { sha256Hex } from '@/platform/compliance/hash';
import {
  authWithOrganizationRequestMiddleware,
  type OrganizationContext,
} from '@/platform/middleware.fn';
import {
  assistantTools,
  chatToolName,
} from '@/assistant/server/assistant-tools';
import { toolContext } from '@/assistant/server/assistant-chat';
import {
  analyzeTalentClipForOrganization,
  analyzeTalentMediaForOrganization,
} from '@/cast/server/talent/analyze-talent-media';
import { handleMcpPost } from '../handle';
import { asStub } from '@/test/as-stub';

const runtime = vi.hoisted(() => ({
  workflow: vi.fn(
    async (_path: unknown, _input: unknown, _options?: unknown) =>
      'synthetic-workflow-' + crypto.randomUUID()
  ),
  network: vi.fn(async () => {
    throw new Error('Unexpected external network in upload contract');
  }),
  env: {
    VITE_APP_URL: 'http://localhost:3998',
    BETTER_AUTH_SECRET: 'synthetic-asset-upload-secret-at-least-32-characters',
    ADMIN_EMAILS: '',
    OPENROUTER_KEY: 'synthetic-key',
    FAL_KEY: 'synthetic-key',
    ELEVENLABS_API_KEY: '',
    E2E_TEST: 'false',
  },
}));
vi.mock('@/assistant/server/durability', () => ({
  assistantStreamLog: vi.fn(),
  heldStreamLog: vi.fn(),
  sealStreamLog: vi.fn(),
}));
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({ getEnv: () => runtime.env }));
vi.mock('#flush-scheduler', () => ({ scheduleFlushAnalytics: vi.fn() }));
vi.mock('#storage', () => ({
  uploadFile: vi.fn(async (bucket: string, path: string) => ({
    path,
    fullPath: bucket + '/' + path,
    publicUrl: '/r2/' + bucket + '/' + path,
  })),
  storageObjectSize: vi.fn(async () => null),
}));
vi.mock('cloudflare:workers', async (original) => ({
  ...(await original<typeof import('cloudflare:workers')>()),
  env: { MCP_JWT_RATE_LIMITER: { limit: async () => ({ success: true }) } },
}));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.mock('@/platform/server/emails/email-service', () => ({
  sendOtpEmail: vi.fn(async () => ({ success: true })),
  sendOrganizationInvitationEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: runtime.workflow,
}));
vi.mock('@/cast/server/talent/analyze-talent-media', () => ({
  analyzeTalentMediaForOrganization: vi.fn(),
  analyzeTalentClipForOrganization: vi.fn(),
}));

// Synthetic OTP/identities, storage, classifier and workflow effects; auth, adapters, upload ledger and Studio service writes are real.
const origin = runtime.env.VITE_APP_URL;
const protocol = '2026-07-28';
const hookTimeout = 60_000;
const otpLifetime = 60_000;
const balance = 100_000_000;
const tokenLifetime = 600;
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sequenceId = generateId();
let database: Awaited<ReturnType<typeof createTestDb>>;
let caller: Awaited<ReturnType<typeof signIn>>;
let other: Awaited<ReturnType<typeof signIn>>;
let apiKey: string;
let generateToken: string;
const envelope = z.object({
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
    })
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const uploadResult = z.object({
  upload: z.string(),
  url: z.string(),
  mediaType: z.string(),
  rights: z.string(),
});
const started = z.object({
  assets: z.array(z.object({ id: z.string(), workflowRunId: z.string() })),
});
const app = createServerEntry({
  fetch: (request) => {
    if (new URL(request.url).pathname.startsWith('/api/auth/'))
      return getAuth().handler(request);
    return handleMcpPost(request);
  },
});
async function authPost(path: string, body: unknown, cookie = '') {
  const response = await app.fetch(
    new Request(origin + '/api/auth/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie },
      body: JSON.stringify(body),
    })
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response;
}
async function signIn() {
  const id = generateId(),
    organizationId = generateId();
  const email = id.toLowerCase() + '@example.invalid';
  await database.db
    .insert(user)
    .values({ id, email, name: 'Synthetic upload caller', status: 'active' });
  await database.db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic uploads',
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
    expiresAt: new Date(Date.now() + otpLifetime),
  });
  const response = await authPost('sign-in/email-otp', {
    email,
    otp: '123456',
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { id, organizationId, cookie };
}
async function issueKey() {
  const response = await authPost(
    'api-key/create',
    {
      name: 'Synthetic upload contract',
      prefix: 'osk_',
      metadata: { organizationId: caller.organizationId },
    },
    caller.cookie
  );
  return z.object({ key: z.string() }).parse(await response.json()).key;
}
async function credentials() {
  apiKey = await issueKey();
  const { token } = await getAuth().api.signJWT({
    body: {
      payload: {
        sub: caller.id,
        aud: origin + '/mcp',
        iss: origin,
        scope: 'generate',
        organization_id: caller.organizationId,
        exp: Math.floor(Date.now() / 1000) + tokenLifetime,
        jti: generateId(),
      },
    },
  });
  generateToken = token;
}
beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  vi.stubGlobal('fetch', runtime.network);
  caller = await signIn();
  other = await signIn();
  await credentials();
  const styleId = generateId();
  await database.db.insert(styles).values({
    id: styleId,
    organizationId: caller.organizationId,
    name: 'Synthetic style',
    config: {
      mood: 'neutral',
      artStyle: 'cinematic',
      lighting: 'natural',
      colorPalette: [],
      cameraWork: 'static',
      referenceFilms: [],
      colorGrading: 'neutral',
    },
  });
  await database.db.insert(sequences).values({
    id: sequenceId,
    organizationId: caller.organizationId,
    title: 'Synthetic upload sequence',
    styleId,
  });
  await database.db
    .insert(credits)
    .values({ organizationId: caller.organizationId, balance });
}, hookTimeout);
afterAll(async () => {
  vi.unstubAllGlobals();
  await database.close();
});
afterEach(() => {
  expect(runtime.network).not.toHaveBeenCalled();
});
beforeEach(async () => {
  vi.clearAllMocks();
  // Fresh real credentials keep the synthetic requests inside the unchanged per-key rate limit.
  apiKey = await issueKey();
  vi.mocked(analyzeTalentMediaForOrganization).mockResolvedValue(
    asStub({ subjectKind: 'other' })
  );
  vi.mocked(analyzeTalentClipForOrganization).mockResolvedValue(
    asStub({ subjectKind: 'other' })
  );
});

type Entry = 'mcp' | 'assistant-zh' | 'assistant-en';
const entries: Entry[] = ['mcp', 'assistant-zh', 'assistant-en'];
function mcpRequest(
  name: string,
  args: unknown,
  key = apiKey,
  locale = 'zh-CN'
) {
  return new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocol,
      'mcp-method': 'tools/call',
      'mcp-name': 'openstory.' + name,
      authorization: 'Bearer ' + key,
      cookie: other.cookie + '; ' + LOCALE_COOKIE + '=' + locale,
      'cf-connecting-ip': '192.0.2.14',
      'user-agent': 'synthetic-upload-contract',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'openstory.' + name,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': protocol,
          'io.modelcontextprotocol/clientInfo': {
            name: 'synthetic-upload-contract',
            version: '1',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}
async function assistantCall(name: string, args: unknown, locale?: string) {
  const request = new Request(origin + '/api/assistant/chat', {
    headers: {
      cookie:
        caller.cookie +
        (locale === undefined ? '' : '; ' + LOCALE_COOKIE + '=' + locale),
      'cf-connecting-ip': '192.0.2.14',
      'user-agent': 'synthetic-upload-contract',
    },
  });
  const middleware = authWithOrganizationRequestMiddleware.options.server;
  if (!middleware)
    throw new Error('Missing production organization middleware');
  let toolFailure: { error: unknown } | undefined;
  const next = async ({ context }: { context: OrganizationContext }) => {
    const tool = assistantTools().find(
      (candidate) => candidate.name === chatToolName('openstory.' + name)
    );
    if (!tool?.execute) throw new Error('Missing assistant tool ' + name);
    try {
      return await tool.execute(args, {
        context: toolContext({
          ...context,
          origin,
          request,
          organizationName: await context.scopedDb.assistant.organizationName(),
        }),
      });
    } catch (error) {
      toolFailure = { error };
      throw error;
    }
  };
  // The harness supplies HTTP dispatch and tool selection; session middleware and both tool adapters execute unchanged.
  const dispatch = createServerEntry({
    fetch: async () =>
      Response.json(
        await middleware(
          asStub<Parameters<typeof middleware>[0]>({
            request,
            pathname: '/api/assistant/chat',
            handlerType: 'router',
            context: {},
            next,
          })
        )
      ),
  });
  const response = await dispatch.fetch(request);
  if (toolFailure) throw toolFailure.error;
  return response.json();
}
async function call(entry: Entry, name: string, args: unknown) {
  if (entry !== 'mcp')
    return assistantCall(name, args, entry === 'assistant-en' ? 'en' : 'zh-CN');
  const response = await app.fetch(mcpRequest(name, args));
  expect(response.status).toBe(200);
  const body = envelope.parse(await response.json());
  expect(body.error).toBeUndefined();
  expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
  return body.result?.structuredContent;
}
async function upload(
  entry: Entry,
  use = 'studio',
  extra: Record<string, unknown> = {}
) {
  return uploadResult.parse(
    await call(entry, 'upload_media', {
      use,
      data: png,
      mimeType: 'image/png',
      ...(use === 'studio' ? {} : { sequenceId }),
      ...extra,
    })
  );
}
function createInput() {
  return {
    activity: 'image',
    prompt: '小鹿 by the port. “Keep this dialogue.”',
    imageModel: 'nano_banana_2_1',
    aspectRatio: '16:9',
    count: 2,
  };
}
function localeOf(entry: Entry): Locale {
  return entry === 'assistant-zh' ? 'zh-CN' : 'en';
}
async function ledger(url: string) {
  return database.db.query.uploadAttestations.findMany({
    where: { subjectId: await sha256Hex(url) },
  });
}

describe('authenticated upload classification and storage contract', () => {
  it.each(entries)(
    '%s writes its trusted identity and locale into the real ledger',
    async (entry) => {
      const result = await upload(entry);
      expect(result.upload).toContain(
        '/r2/talent/' + caller.organizationId + '/uploads/'
      );
      expect(result.url).toBe(origin + result.upload);
      expect(result.rights).toBe('cleared');
      expect(analyzeTalentMediaForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          promptLocale: localeOf(entry),
          userId: caller.id,
          scopedDb: expect.objectContaining({
            organizationId: caller.organizationId,
          }),
          imageUrls: [result.upload],
        })
      );
      expect(await ledger(result.upload)).toEqual([
        expect.objectContaining({
          organizationId: caller.organizationId,
          userId: caller.id,
          depictsRealPerson: false,
          ipAddress: '192.0.2.14',
        }),
      ]);
    }
  );
  it.each(['shot_image', 'character_sheet', 'location_sheet', 'element'])(
    '%s has the authenticated organization and sequence prefix',
    async (use) => {
      const result = await upload('mcp', use);
      expect(result.upload.split('/')).toContain(caller.organizationId);
      expect(result.upload.split('/')).toContain(sequenceId);
      expect(result.upload).not.toContain(other.organizationId);
      expect(result.rights).toBe('cleared');
    }
  );
});
describe('uploaded reference media classification', () => {
  it.each(['studio', 'element'])(
    '%s clips reach the real clip-classification adapter',
    async (use) => {
      // Synthetic transport bytes exercise dispatch and ledger, not a real video decoder.
      const result = await upload('assistant-zh', use, {
        data: 'AAAA',
        mimeType: 'video/mp4',
      });
      expect(analyzeTalentClipForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          promptLocale: 'zh-CN',
          userId: caller.id,
          key: result.upload.slice('/r2/'.length),
          scopedDb: expect.objectContaining({
            organizationId: caller.organizationId,
          }),
        })
      );
      expect(analyzeTalentMediaForOrganization).not.toHaveBeenCalled();
    }
  );
  it.each(['shot_video', 'music', 'dialogue'])(
    '%s reports not_checked rather than inventing rights',
    async (use) => {
      const mimeType = use === 'shot_video' ? 'video/mp4' : 'audio/wav';
      const result = await upload('mcp', use, { data: 'AAAA', mimeType });
      expect(result.rights).toBe('not_checked');
      expect(await ledger(result.upload)).toEqual([]);
      expect(analyzeTalentClipForOrganization).not.toHaveBeenCalled();
      expect(analyzeTalentMediaForOrganization).not.toHaveBeenCalled();
    }
  );
});
describe('portrait sign-off and classifier failures', () => {
  it('refuses a human image without sign-off and persists signed rights with sign-off', async () => {
    vi.mocked(analyzeTalentMediaForOrganization).mockResolvedValue(
      asStub({ subjectKind: 'human' })
    );
    const response = await app.fetch(
      mcpRequest('upload_media', {
        use: 'studio',
        data: png,
        mimeType: 'image/png',
      })
    );
    expect(envelope.parse(await response.json()).result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'ATTESTATION_REQUIRED' } },
    });
    const result = await upload('assistant-zh', 'studio', {
      portraitAttestation: {
        statementVersion: PORTRAIT_RIGHTS_V1.version,
        authorizationBasis: 'synthetic self authorization',
      },
    });
    expect(result.rights).toBe('signed');
    expect(await ledger(result.upload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statementVersion: PORTRAIT_RIGHTS_V1.version,
          authorizationBasis: 'synthetic self authorization',
          userId: caller.id,
          organizationId: caller.organizationId,
        }),
      ])
    );
  });
  it('keeps classifier failure unchecked', async () => {
    vi.mocked(analyzeTalentMediaForOrganization).mockRejectedValueOnce(
      new Error('Synthetic classifier failure')
    );
    const response = await app.fetch(
      mcpRequest('upload_media', {
        use: 'studio',
        data: png,
        mimeType: 'image/png',
      })
    );
    expect(envelope.parse(await response.json()).result?.isError).toBe(true);
    const stored = await vi.mocked(uploadFile).mock.results.at(-1)?.value;
    expect(await ledger(stored?.publicUrl ?? '')).toEqual([]);
  });
});
describe('authenticated upload scope', () => {
  it('enforces the signed OAuth generate-only scope before upload storage', async () => {
    const response = await app.fetch(
      mcpRequest(
        'upload_media',
        { use: 'studio', data: png, mimeType: 'image/png' },
        generateToken
      )
    );
    expect(envelope.parse(await response.json()).result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'INSUFFICIENT_SCOPE' } },
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
describe('real Studio reservation and fan-out contract', () => {
  it.each(entries)(
    '%s returns every stored id/run and preserves user prompt text',
    async (entry) => {
      const stored = await upload(entry);
      const input = {
        ...createInput(),
        referenceImages: [stored.url],
        count: 3,
      };
      const result = started.parse(
        await call(entry, 'create_studio_assets', input)
      );
      expect(result.assets).toHaveLength(3);
      expect(new Set(result.assets.map((asset) => asset.id)).size).toBe(3);
      expect(runtime.workflow).toHaveBeenCalledTimes(3);
      for (const asset of result.assets) {
        const row = await database.db.query.generatedAssets.findFirst({
          where: { id: asset.id },
        });
        expect(row).toMatchObject({
          userId: caller.id,
          organizationId: caller.organizationId,
          status: 'queued',
          workflowRunId: asset.workflowRunId,
          input: { prompt: input.prompt, referenceImages: [stored.upload] },
        });
        expect(runtime.workflow).toHaveBeenCalledWith(
          '/studio',
          expect.objectContaining({
            assetId: asset.id,
            userId: caller.id,
            organizationId: caller.organizationId,
            promptLocale: localeOf(entry),
            input: expect.objectContaining({
              prompt: input.prompt,
              referenceImages: [stored.upload],
            }),
          }),
          expect.anything()
        );
      }
    }
  );
});
describe('real Studio reference admission', () => {
  it('refuses a foreign Studio upload before starting or classifying anything', async () => {
    const response = await app.fetch(
      mcpRequest('create_studio_assets', {
        ...createInput(),
        referenceImages: [
          '/r2/talent/' + other.organizationId + '/uploads/foreign.png',
        ],
      })
    );
    expect(envelope.parse(await response.json()).result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'ATTESTATION_REQUIRED' } },
    });
    expect(runtime.workflow).not.toHaveBeenCalled();
    expect(analyzeTalentMediaForOrganization).not.toHaveBeenCalled();
  });
  it('the real authenticated adapter refuses identity and language overrides before any service effect', async () => {
    const response = await app.fetch(
      mcpRequest('create_studio_assets', {
        ...createInput(),
        promptLocale: 'zh-CN',
        userId: other.id,
        organizationId: other.organizationId,
      })
    );
    const result = envelope.parse(await response.json());
    expect(result.error !== undefined || result.result?.isError === true).toBe(
      true
    );
    expect(runtime.workflow).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe('request locale defaults through real upload service', () => {
  it.each([undefined, 'invalid', '%E0%A4%A'])(
    'assistant cookie %s defaults to Chinese',
    async (locale) => {
      await assistantCall(
        'upload_media',
        { use: 'studio', data: png, mimeType: 'image/png' },
        locale
      );
      expect(analyzeTalentMediaForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ promptLocale: 'zh-CN' })
      );
    }
  );
  it.each(['zh-CN', 'en', 'invalid', '%E0%A4%A'])(
    'external MCP cookie %s keeps English',
    async (locale) => {
      const response = await app.fetch(
        mcpRequest(
          'upload_media',
          { use: 'studio', data: png, mimeType: 'image/png' },
          apiKey,
          locale
        )
      );
      expect(envelope.parse(await response.json()).result?.isError).not.toBe(
        true
      );
      expect(analyzeTalentMediaForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ promptLocale: 'en' })
      );
    }
  );
});

describe('Studio draft generation admission on registered tools', () => {
  it.each(
    entries.flatMap((entry) =>
      (['user', 'organization'] as const).map((subject) => ({ entry, subject }))
    )
  )(
    'blocks a generation-suspended $subject on $entry before calling the draft service',
    async ({ entry, subject }) => {
      const id = generateId();
      const draft = vi
        .spyOn(studioActions, 'draftStudioPromptForOrganization')
        .mockResolvedValue({ prompt: 'Mock service must not run' });
      await database.db.insert(enforcementActions).values({
        id,
        action: 'generation_suspended',
        reason: 'other',
        ...(subject === 'user'
          ? { subjectUserId: caller.id }
          : { subjectOrganizationId: caller.organizationId }),
      });
      try {
        const args = { activity: 'image', references: [] };
        if (entry === 'mcp') {
          const response = await app.fetch(
            mcpRequest('draft_studio_prompt', args)
          );
          expect(response.status).toBe(200);
          expect(envelope.parse(await response.json()).result?.isError).toBe(
            true
          );
        } else {
          await expect(
            assistantCall(
              'draft_studio_prompt',
              args,
              entry === 'assistant-en' ? 'en' : 'zh-CN'
            )
          ).rejects.toThrow(
            'New generations are paused on this account following a other report.'
          );
        }
        expect(draft).not.toHaveBeenCalled();
        expect(runtime.workflow).not.toHaveBeenCalled();
        expect(uploadFile).not.toHaveBeenCalled();
      } finally {
        draft.mockRestore();
        await database.db
          .delete(enforcementActions)
          .where(eq(enforcementActions.id, id));
      }
    }
  );
});
