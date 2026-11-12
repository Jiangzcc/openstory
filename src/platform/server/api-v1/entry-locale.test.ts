import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { micros } from '@/billing/money';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { LLMRequestParams, StreamChunk } from '@/models/server/llm-client';
import type { ResolvedLlmKey } from '@/models/server/db/api-keys';
import type { Locale } from '@/platform/i18n/locale';
import type { User, Session } from '@/platform/server/auth/config';
import type { RequestPrincipal } from '@/platform/server/auth/request-principal';
import type { ResolvedOrganization } from '@/platform/server/auth/organization-memo';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { CreateSequencesResult } from '@/sequences/server/create-sequences';
import { asStub } from '@/test/as-stub';

// Real route/middleware callbacks, schemas, one-shot resolution, enhancement, prompts and SSE.
// Mock principal/membership/compliance, scoped DB, final writes, sheet jobs and LLM transport.
// Direct callback composition in Node: no HTTP dispatcher, real auth, SQLite/D1 or provider acceptance.
const resolvePrincipal =
  vi.fn<
    typeof import('@/platform/server/auth/request-principal').resolveRequestPrincipal
  >();
const resolveMembership =
  vi.fn<
    typeof import('@/platform/server/auth/organization-memo').resolveOrganizationAndCompliance
  >();
const createScopedDb = vi.fn();
const flush = vi.fn(async () => undefined);
const createSequences =
  vi.fn<typeof import('@/sequences/server/create-sequences').createSequences>();
const createCharacter =
  vi.fn<typeof import('@/cast/server/cast-edit').createOrganizationCharacter>();
const createLocation =
  vi.fn<
    typeof import('@/cast/server/locations/organization-locations').createOrganizationLocation
  >();
const triggerLocationSheet =
  vi.fn<
    typeof import('@/cast/server/locations/organization-locations').triggerOrganizationLocationSheet
  >();
const getRequestHeader = vi.fn<(name: string) => string | undefined>();
const noNetwork = vi.fn(() => {
  throw new Error('REST entry tests must never make network requests.');
});
const callLLMStream =
  vi.fn<(params: LLMRequestParams) => AsyncGenerator<StreamChunk>>();
const cost = micros(125);

vi.doMock('#flush-scheduler', () => ({ scheduleFlushAnalytics: flush }));
vi.doMock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(),
  getRequestHeader,
}));
vi.doMock('@/platform/server/auth/config', () => ({
  getAuth: () => ({ api: { setActiveOrganization: vi.fn() } }),
}));
vi.doMock('@/platform/server/auth/organization-memo', () => ({
  resolveOrganizationAndCompliance: resolveMembership,
}));
vi.doMock('@/platform/server/db/scoped', () => ({
  createScopedDb,
  createSystemAdminScopedDb: vi.fn(),
  getFirstOrganizationId: vi.fn(),
  getSequenceByIdUnscoped: vi.fn(),
  getApiKeyOrganizationId: vi.fn(),
  getUserById: vi.fn(),
}));
vi.doMock('@/platform/server/auth/request-principal', async () => ({
  ...(await vi.importActual<
    typeof import('@/platform/server/auth/request-principal')
  >('@/platform/server/auth/request-principal')),
  resolveRequestPrincipal: resolvePrincipal,
  apiResourceMetadataUrl: () =>
    'https://rest-entry.invalid/.well-known/oauth-protected-resource/api/v1',
}));
vi.doMock('@/sequences/server/create-sequences', () => ({ createSequences }));
vi.doMock('@/cast/server/cast-edit', () => ({
  createOrganizationCharacter: createCharacter,
}));
vi.doMock('@/cast/server/locations/organization-locations', () => ({
  createOrganizationLocation: createLocation,
  triggerOrganizationLocationSheet: triggerLocationSheet,
}));
vi.doMock('@/models/server/byteplus-config', () => ({
  claimBytePlusVia: () => 'fal',
}));
vi.doMock('@/models/server/llm-client', () => ({
  callLLMStream,
  ENHANCE_REASONING: 'low',
  llmCostFromUsage: () => cost,
}));

const { authWithOrganizationRequestMiddleware } =
  await import('@/platform/middleware.fn');
const createModule = await import('./create');
const enhanceModule = await import('./enhance');
const oneShot = vi.spyOn(createModule, 'runOneShotCreate');
const buildGenerator = vi.spyOn(enhanceModule, 'buildEnhanceGenerator');
const { Route: SequenceRoute } = await import('@/routes/api/v1/sequences');
const { Route: EnhanceRoute } = await import('@/routes/api/v1/scripts.enhance');
const { getPrompt } = await import('@/platform/server/ai/prompts-index');

type HandlerContext = {
  promptLocale: Locale;
  user: User;
  organizationId: string;
  scopedDb: ScopedDb;
};
type PostHandler = (args: {
  request: Request;
  context: HandlerContext;
}) => Promise<Response>;
const postSchema = z.object({
  POST: z.custom<PostHandler>((value) => typeof value === 'function'),
});
const sequencePost = vi.fn(
  postSchema.parse(SequenceRoute.options.server?.handlers).POST
);
const enhancePost = vi.fn(
  postSchema.parse(EnhanceRoute.options.server?.handlers).POST
);
const endpoints = [
  {
    name: 'sequences',
    path: '/api/v1/sequences',
    post: sequencePost,
    middleware: SequenceRoute.options.server?.middleware,
    body: { enhance: 'off' },
  },
  {
    name: 'scripts/enhance',
    path: '/api/v1/scripts/enhance',
    post: enhancePost,
    middleware: EnhanceRoute.options.server?.middleware,
    body: {},
  },
] as const;

const user = asStub<User>({ id: generateId(), name: 'Mock REST user' });
const organizationId = generateId();
const sequenceId = generateId();
const session = asStub<Session>({
  user,
  session: { id: 'mock-cookie-session', activeOrganizationId: organizationId },
});
const script =
  'INT. 海边灯塔 — 夜\n守塔人说：“不要翻译这句对白。”\nKEEP_TOKEN_01 remains unchanged.';
const enhancedScript =
  'Scene 1 — 30s\n守塔人说：“不要翻译这句对白。”\nKEEP_TOKEN_01 remains unchanged.';
const cookies = [
  { name: 'zh-CN', value: 'openstory_locale=zh-CN' },
  { name: 'en', value: 'openstory_locale=en' },
  { name: 'missing', value: undefined },
  { name: 'invalid value', value: 'openstory_locale=invalid' },
  { name: 'malformed encoding', value: 'openstory_locale=%E0%A4%A' },
];
const forged = {
  userId: 'forged-user',
  user: { id: 'forged-user' },
  organizationId: 'forged-organization',
  locale: 'zh-CN',
  promptLocale: 'zh-CN',
  scopedDb: { organizationId: 'forged-organization' },
};
const llmKey: ResolvedLlmKey = {
  key: 'mock-never-sent',
  source: 'platform',
  via: 'openrouter',
};
const modelConfiguration = vi.fn(async () => ({
  ...DEFAULT_MODEL_CONFIGURATION,
}));
const resolveLlmKey = vi.fn(async () => llmKey);
const deductCredits = vi.fn(async () => undefined);
const hasEnoughCredits = vi.fn(async () => true);
const listStyles = vi.fn(async () => []);
const deleteCharacter = vi.fn();
const deleteLocation = vi.fn();
let scopedDb: ScopedDb;

function principal(): RequestPrincipal {
  return { user, session, organizationId, oauth: null };
}

function membership(canAccess = true, canWrite = true): ResolvedOrganization {
  return asStub<ResolvedOrganization>({
    organization: {
      organizationId,
      organizationName: 'Mock REST organization',
    },
    compliance: {
      enforcement: { canAccess, canWrite, canGenerate: true, mostSevere: null },
    },
  });
}

function request(
  path: string,
  body: unknown,
  cookie?: string,
  raw = false
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.8',
    'user-agent': 'rest-entry-regression',
  });
  if (cookie) headers.set('cookie', cookie);
  return new Request('https://rest-entry.invalid' + path, {
    method: 'POST',
    headers,
    body: raw ? String(body) : JSON.stringify(body),
  });
}

async function dispatch(
  endpoint: (typeof endpoints)[number],
  value: Request
): Promise<Response> {
  expect(endpoint.middleware).toEqual([authWithOrganizationRequestMiddleware]);
  const callback = authWithOrganizationRequestMiddleware.options.server;
  if (!callback)
    throw new Error('Expected a real request middleware callback.');
  const next = vi.fn(async ({ context }: { context: HandlerContext }) =>
    endpoint.post({ request: value, context })
  );
  try {
    const result = await callback(
      asStub<Parameters<typeof callback>[0]>({
        request: value,
        pathname: endpoint.path,
        handlerType: 'router',
        context: forged,
        next,
      })
    );
    if (!(result instanceof Response))
      throw new Error('Expected the route Response.');
    return result;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

async function* completion(
  params: LLMRequestParams
): AsyncGenerator<StreamChunk> {
  // Synthetic model output; the actual generator must process it and strip TOTAL.
  const text = enhancedScript + '\nTOTAL: 30s';
  yield { done: false, delta: text, accumulated: text };
  yield {
    done: true,
    delta: '',
    accumulated: text,
    parsed: undefined,
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    model: params.model,
    via: 'openrouter',
  };
}

function expectNoDownstreamWork() {
  expect(oneShot).not.toHaveBeenCalled();
  expect(buildGenerator).not.toHaveBeenCalled();
  expect(modelConfiguration).not.toHaveBeenCalled();
  expect(resolveLlmKey).not.toHaveBeenCalled();
  expect(callLLMStream).not.toHaveBeenCalled();
  expect(createSequences).not.toHaveBeenCalled();
  expect(createCharacter).not.toHaveBeenCalled();
  expect(createLocation).not.toHaveBeenCalled();
  expect(triggerLocationSheet).not.toHaveBeenCalled();
  expect(deductCredits).not.toHaveBeenCalled();
  expect(deleteCharacter).not.toHaveBeenCalled();
  expect(deleteLocation).not.toHaveBeenCalled();
}

async function expectEnglishEnhancement() {
  expect(callLLMStream).toHaveBeenCalledTimes(1);
  const params = callLLMStream.mock.calls[0]?.[0];
  const expected = await getPrompt('script/enhance', { userCountry: '' }, 'en');
  expect(params?.messages[0]).toEqual({
    role: 'system',
    content:
      expected.compiled +
      '\n\nReturn ONLY the enhanced script text. No JSON, no markdown formatting, no explanations.',
  });
  expect(params?.messages[1]?.role).toBe('user');
  expect(params?.messages[1]?.content).toContain(
    '<USER_SCRIPT>\n' + script + '\n</USER_SCRIPT>'
  );
  expect(params?.messages[1]?.content).toContain(
    'Enhance the script inside <USER_SCRIPT>'
  );
  expect(params).toMatchObject({
    userId: user.id,
    apiKey: llmKey,
    metadata: { organizationId },
  });
  expect(resolveLlmKey).toHaveBeenCalledWith(
    DEFAULT_MODEL_CONFIGURATION.defaultAnalysis,
    []
  );
  expect(deductCredits).toHaveBeenCalledWith(cost, {
    description: 'Script enhancement',
    metadata: { model: DEFAULT_MODEL_CONFIGURATION.defaultAnalysis },
  });
}

function expectTrustedCreate(expectedScript: string) {
  expect(createSequences).toHaveBeenCalledTimes(1);
  expect(createSequences).toHaveBeenCalledWith(
    expect.objectContaining({ script: expectedScript }),
    expect.objectContaining({
      promptLocale: 'en',
      user,
      organizationId,
      scopedDb,
      notify: false,
    })
  );
  expect(oneShot.mock.calls[0]?.[1]).toMatchObject({
    promptLocale: 'en',
    user,
    organizationId,
    request: { ipAddress: '203.0.113.8', userAgent: 'rest-entry-regression' },
  });
  expect(oneShot.mock.calls[0]?.[1].scopedDb).toBe(scopedDb);
  for (const key of Object.keys(forged)) {
    expect(oneShot.mock.calls[0]?.[0]).not.toHaveProperty(key);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', noNetwork);
  getRequestHeader.mockReset();
  resolvePrincipal.mockResolvedValue(principal());
  resolveMembership.mockResolvedValue(membership());
  modelConfiguration.mockResolvedValue({ ...DEFAULT_MODEL_CONFIGURATION });
  resolveLlmKey.mockResolvedValue(llmKey);
  hasEnoughCredits.mockResolvedValue(true);
  listStyles.mockResolvedValue([]);
  scopedDb = asStub<ScopedDb>({
    organizationId,
    modelConfiguration: { get: modelConfiguration },
    textChannels: { getSnapshot: vi.fn(async () => []) },
    apiKeys: {
      resolveLlmKey,
      resolveOptionalKey: vi.fn(async () => null),
    },
    billing: { hasEnoughCredits, deductCredits },
    styles: { list: listStyles },
    characters: {
      listOrganization: vi.fn(async () => []),
      softDeleteForOrganization: deleteCharacter,
    },
    locations: {
      listOrganization: vi.fn(async () => []),
      softDeleteForOrganization: deleteLocation,
    },
  });
  createScopedDb.mockReturnValue(scopedDb);
  createSequences.mockResolvedValue(
    asStub<CreateSequencesResult>({
      entries: [
        {
          sequence: { id: sequenceId, status: 'processing' },
          workflowRunId: 'mock-storyboard-run',
        },
      ],
    })
  );
  callLLMStream.mockImplementation(completion);
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(noNetwork).not.toHaveBeenCalled();
});

describe('POST /api/v1/sequences: real route and one-shot service', () => {
  it.each(cookies)(
    'uses trusted identity and external English for Cookie $name with enhancement off',
    async ({ value }) => {
      const endpoint = endpoints[0];
      const valueRequest = request(
        endpoint.path,
        { script, enhance: 'off', ...forged },
        value
      );
      const response = await dispatch(endpoint, valueRequest);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        sequences: [
          {
            id: sequenceId,
            workflowRunId: 'mock-storyboard-run',
            statusUrl: '/api/v1/sequences/' + sequenceId,
          },
        ],
      });
      expectTrustedCreate(script);
      expect(callLLMStream).not.toHaveBeenCalled();
      expect(deductCredits).not.toHaveBeenCalled();
      expect(resolvePrincipal).toHaveBeenCalledWith(valueRequest);
      expect(resolveMembership).toHaveBeenCalledWith(
        user.id,
        'POST',
        organizationId
      );
      expect(createScopedDb).toHaveBeenCalledWith(organizationId, user.id);
      expect(sequencePost.mock.calls[0]?.[0].context.promptLocale).toBe('en');
    }
  );

  it.each(cookies)(
    'composes real one-shot enhancement to the LLM boundary for Cookie $name',
    async ({ value }) => {
      const endpoint = endpoints[0];
      const response = await dispatch(
        endpoint,
        request(endpoint.path, { script, enhance: 'always', ...forged }, value)
      );
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ enhancedScript });
      await expectEnglishEnhancement();
      expectTrustedCreate(enhancedScript);
    }
  );

  it('strips forged location fields while forwarding trusted identity and locale to sheet scheduling', async () => {
    const endpoint = endpoints[0];
    const locationId = generateId();
    createLocation.mockResolvedValue(
      asStub<Awaited<ReturnType<typeof createLocation>>>({
        id: locationId,
        name: '码头',
      })
    );
    triggerLocationSheet.mockResolvedValue('mock-location-sheet-run');
    const response = await dispatch(
      endpoint,
      request(
        endpoint.path,
        {
          script,
          enhance: 'off',
          ...forged,
          locations: [
            {
              name: '码头',
              description: '灯塔旁的码头',
              rendering: 'Watercolor',
              ...forged,
            },
          ],
        },
        'openstory_locale=zh-CN'
      )
    );
    expect(response.status).toBe(202);
    expect(createLocation).toHaveBeenCalledWith(
      scopedDb,
      {
        name: '码头',
        description: '灯塔旁的码头',
        rendering: 'Watercolor',
        photoUrls: [],
      },
      {
        promptLocale: 'en',
        userId: user.id,
        organizationId,
        triggerSheet: false,
      }
    );
    expect(triggerLocationSheet).toHaveBeenCalledWith(scopedDb, {
      promptLocale: 'en',
      userId: user.id,
      organizationId,
      locationId,
    });
    expectTrustedCreate(script);
    expect(createSequences.mock.calls[0]?.[0].suggestedLocationIds).toEqual([
      locationId,
    ]);
    expect(callLLMStream).not.toHaveBeenCalled();
  });

  it('rejects an invalid configured analysis model before final writes or a paid call', async () => {
    const endpoint = endpoints[0];
    const response = await dispatch(
      endpoint,
      request(endpoint.path, {
        script,
        enhance: 'off',
        analysisModels: ['not-a-real-analysis-model'],
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(oneShot).toHaveBeenCalledTimes(1);
    expect(createSequences).not.toHaveBeenCalled();
    expect(callLLMStream).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(createCharacter).not.toHaveBeenCalled();
    expect(createLocation).not.toHaveBeenCalled();
    expect(triggerLocationSheet).not.toHaveBeenCalled();
  });

  it('rejects extra fields on strict inline character objects before the shared service', async () => {
    const endpoint = endpoints[0];
    const response = await dispatch(
      endpoint,
      request(endpoint.path, {
        script,
        enhance: 'off',
        characters: [{ name: '守塔人', userId: 'forged-user' }],
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expectNoDownstreamWork();
  });
});

describe('POST /api/v1/scripts/enhance: real generator, prompts and SSE', () => {
  it.each(cookies)(
    'keeps external English and original script at the LLM boundary for Cookie $name',
    async ({ value }) => {
      const endpoint = endpoints[1];
      const response = await dispatch(
        endpoint,
        request(endpoint.path, { script, ...forged }, value)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/event-stream; charset=utf-8'
      );
      const body = await response.text();
      const terminal = body
        .split('\n\n')
        .find((part) => part.startsWith('event: done\n'));
      expect(terminal).toBeDefined();
      const payload = z
        .object({
          enhancedScript: z.string(),
          _links: z.object({
            'create-sequence': z.object({
              examples: z.array(
                z.object({ script: z.string(), enhance: z.string() })
              ),
            }),
          }),
        })
        .parse(JSON.parse((terminal ?? '').replace('event: done\ndata: ', '')));
      expect(payload.enhancedScript).toBe(enhancedScript);
      expect(payload._links['create-sequence'].examples).toEqual([
        { script: enhancedScript, enhance: 'off' },
      ]);
      expect(body).not.toContain('event: error');
      expect(body).not.toContain('TOTAL:');
      await expectEnglishEnhancement();
      expect(buildGenerator.mock.calls[0]?.[1].scopedDb).toBe(scopedDb);
      expect(buildGenerator.mock.calls[0]?.[1]).toMatchObject({
        promptLocale: 'en',
        user,
        organizationId,
      });
      for (const key of Object.keys(forged)) {
        expect(buildGenerator.mock.calls[0]?.[0]).not.toHaveProperty(key);
      }
      expect(createSequences).not.toHaveBeenCalled();
      expect(createCharacter).not.toHaveBeenCalled();
      expect(createLocation).not.toHaveBeenCalled();
      expect(triggerLocationSheet).not.toHaveBeenCalled();
    }
  );
});

describe.each(endpoints)('$name entry guards and context trust', (endpoint) => {
  it('sets English in the route itself even when injected context and Cookie say zh-CN', async () => {
    const response = await endpoint.post({
      request: request(
        endpoint.path,
        { script, ...endpoint.body, ...forged },
        'openstory_locale=zh-CN'
      ),
      context: { promptLocale: 'zh-CN', user, organizationId, scopedDb },
    });
    expect(response.status).toBe(endpoint.name === 'sequences' ? 202 : 200);
    await response.text();
    if (endpoint.name === 'sequences') expectTrustedCreate(script);
    else await expectEnglishEnhancement();
    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it.each(['api-key', 'oauth'] as const)(
    'retains fixed English for a mock %s principal',
    async (kind) => {
      resolvePrincipal.mockResolvedValue({
        ...principal(),
        session: null,
        oauth:
          kind === 'oauth'
            ? asStub<NonNullable<RequestPrincipal['oauth']>>({
                scopes: ['generate'],
              })
            : null,
      });
      const value = request(
        endpoint.path,
        { script, ...endpoint.body, ...forged },
        'openstory_locale=zh-CN'
      );
      value.headers.set(
        'authorization',
        kind === 'api-key' ? 'Bearer osk_mock_only' : 'Bearer mock.oauth.only'
      );
      const response = await dispatch(endpoint, value);
      expect(response.status).toBe(endpoint.name === 'sequences' ? 202 : 200);
      await response.text();
      expect(endpoint.post.mock.calls[0]?.[0].context).toMatchObject({
        promptLocale: 'en',
        user,
        organizationId,
      });
      expect(endpoint.post.mock.calls[0]?.[0].context.scopedDb).toBe(scopedDb);
      if (endpoint.name === 'sequences') expectTrustedCreate(script);
      else await expectEnglishEnhancement();
    }
  );

  it.each([
    { reason: 'unauthenticated', status: 401, code: 'UNAUTHORIZED' },
    { reason: 'missing membership', status: 403, code: 'NO_ORGANIZATION' },
    { reason: 'access restricted', status: 403, code: 'ACCOUNT_RESTRICTED' },
    { reason: 'write restricted', status: 403, code: 'ACCOUNT_RESTRICTED' },
    { reason: 'missing OAuth scope', status: 403, code: 'INSUFFICIENT_SCOPE' },
  ])(
    'rejects $reason before the route callback or any downstream work',
    async ({ reason, status, code }) => {
      if (reason === 'unauthenticated')
        resolvePrincipal.mockResolvedValue(null);
      if (reason === 'missing membership')
        resolveMembership.mockResolvedValue({
          organization: null,
          compliance: null,
        });
      if (reason === 'access restricted')
        resolveMembership.mockResolvedValue(membership(false, false));
      if (reason === 'write restricted')
        resolveMembership.mockResolvedValue(membership(true, false));
      if (reason === 'missing OAuth scope')
        resolvePrincipal.mockResolvedValue({
          ...principal(),
          session: null,
          oauth: asStub<NonNullable<RequestPrincipal['oauth']>>({
            scopes: ['sequences:read'],
          }),
        });
      const response = await dispatch(
        endpoint,
        request(endpoint.path, { script, ...endpoint.body, ...forged })
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(endpoint.post).not.toHaveBeenCalled();
      expect(createScopedDb).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalledTimes(1);
      expectNoDownstreamWork();
    }
  );

  it('rejects malformed JSON without starting shared services or writes', async () => {
    const response = await dispatch(
      endpoint,
      request(endpoint.path, '{"script":', undefined, true)
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_JSON' },
    });
    expect(endpoint.post).toHaveBeenCalledTimes(1);
    expectNoDownstreamWork();
  });

  it.each([
    { name: 'short script', input: { script: 'short' } },
    { name: 'non-string script', input: { script: 42 } },
    { name: 'invalid target duration', input: { targetSeconds: 0 } },
    { name: 'invalid aspect ratio', input: { aspectRatio: 'invalid' } },
  ])(
    'rejects schema failure $name before reads, model calls or writes',
    async ({ input }) => {
      const response = await dispatch(
        endpoint,
        request(endpoint.path, {
          script,
          ...endpoint.body,
          ...input,
          ...forged,
        })
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });
      expect(endpoint.post).toHaveBeenCalledTimes(1);
      expectNoDownstreamWork();
    }
  );

  it('rejects an unresolvable style before the model or final writes', async () => {
    const response = await dispatch(
      endpoint,
      request(endpoint.path, {
        script,
        ...endpoint.body,
        style: 'missing-style',
      })
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(listStyles).toHaveBeenCalledTimes(1);
    expect(callLLMStream).not.toHaveBeenCalled();
    expect(createSequences).not.toHaveBeenCalled();
    expect(createCharacter).not.toHaveBeenCalled();
    expect(createLocation).not.toHaveBeenCalled();
    expect(triggerLocationSheet).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
  });
});
