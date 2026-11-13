import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createServerEntry } from '@tanstack/react-start/server';
import { z } from 'zod';
// oxlint-disable-next-line boundaries/no-raw-db -- isolated D1 replaces only the raw handle
import { getDb } from '#db-client';
import { getAuth } from '@/platform/server/auth/config';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { LOCALE_COOKIE, type Locale } from '@/platform/i18n/locale';
import {
  creditReservations,
  credits,
  enforcementActions,
  generatedAssets,
  member,
  organization,
  transactions,
  user,
  verification,
} from '@/platform/server/db/schema';
import type { GeneratedAssetInput } from '@/platform/server/db/schema';
import type * as entries from '@/studio/studio-assets.fn';

const runtime = vi.hoisted(() => ({
  network: vi.fn(async (): Promise<Response> => {
    throw new Error('Unexpected network in synthetic Studio contract');
  }),
  chat: vi.fn(),
  observation: vi.fn(() => []),
  trigger: vi.fn(),
  checkAllowed: vi.fn(),
  startCheck: vi.fn(),
  put: vi.fn(async (_key: string, body: BodyInit) => {
    await new Response(body).arrayBuffer();
  }),
  head: vi.fn(async () => null),
  list: vi.fn(),
  delete: vi.fn(async () => undefined),
  env: {
    VITE_APP_URL: 'http://localhost:3996',
    BETTER_AUTH_SECRET:
      'synthetic-studio-contract-secret-at-least-32-characters',
    ADMIN_EMAILS: '',
    OPENROUTER_KEY: 'synthetic-studio-key',
    FAL_KEY: 'synthetic-studio-key',
    ELEVENLABS_API_KEY: '',
    E2E_TEST: 'false',
    ARK_API_KEY: 'synthetic-ark-key',
    R2_PUBLIC_STORAGE_DOMAIN: '',
  },
}));

vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({ getEnv: () => runtime.env }));
vi.mock(
  '#storage',
  () => import('@/platform/server/storage/storage-cloudflare')
);
// Final service boundaries are synthetic; Start, auth, Zod, SQL, pricing and stream consumption stay real.
vi.mock('cloudflare:workers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('cloudflare:workers')>()),
  env: {
    R2_STORAGE_BUCKET: {
      put: runtime.put,
      head: runtime.head,
      list: runtime.list,
      delete: runtime.delete,
    },
  },
}));
vi.mock('@tanstack/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/ai')>()),
  chat: runtime.chat,
}));
vi.mock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: runtime.observation,
}));
vi.mock('#flush-scheduler', () => ({
  scheduleFlushAnalytics: vi.fn(async () => undefined),
}));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.mock('@/platform/server/emails/email-service', () => ({
  sendOtpEmail: vi.fn(async () => ({ success: true })),
  sendOrganizationInvitationEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/platform/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/realtime')>()),
  getBillingChannel: () => ({
    emit: vi.fn(async () => undefined),
    history: async () => [],
  }),
}));
vi.mock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: runtime.trigger,
}));
vi.mock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => ({}),
}));
vi.mock('@/cast/server/upload-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/cast/server/upload-check')>()),
  requireUploadCheckAllowed: runtime.checkAllowed,
  startCheckForStoredUpload: runtime.startCheck,
}));
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tanstack/react-start')>();
  let functionId = 0;
  // Test-only compiler adapter: supply extracted metadata and the original handler to the real builder.
  function compiledBuilder<T extends object>(builder: T): T {
    return new Proxy(builder, {
      get(target, property, receiver) {
        const method = Reflect.get(target, property, receiver);
        if (typeof method !== 'function') return method;
        if (property === 'handler') {
          return (handler: unknown) => {
            if (typeof handler !== 'function')
              throw new Error('Expected an uncompiled .fn handler');
            const id = 'synthetic-studio-function-' + ++functionId;
            const extracted = Object.assign(
              () => {
                throw new Error('Client RPC is outside this composition test');
              },
              {
                url: '/_server/' + id,
                serverFnMeta: {
                  id,
                  name: id,
                  filename: 'synthetic-test-adapter',
                },
              }
            );
            return Reflect.apply(method, target, [extracted, handler]);
          };
        }
        if (property === 'middleware' || property === 'validator') {
          return (...args: unknown[]) => {
            const next = Reflect.apply(method, target, args);
            if (typeof next !== 'function')
              throw new Error('Expected the real callable Start builder');
            return compiledBuilder(next);
          };
        }
        return method;
      },
    });
  }
  return {
    ...original,
    createServerFn: new Proxy(original.createServerFn, {
      apply(target, thisArg, args) {
        return compiledBuilder(Reflect.apply(target, thisArg, args));
      },
    }),
  };
});

// Fixture factory follows create-studio-asset.test.ts; production entries use the real middleware.
const { createScopedDb } = await import('@/platform/server/db/scoped');

const origin = runtime.env.VITE_APP_URL;
const authApp = createServerEntry({
  fetch: (request) => getAuth().handler(request),
});
const INITIAL_BALANCE = 100_000_000;
const REPORTED_COST = 0.0024;
const DRAFT_TEXT = '"@Image1: Lena says Stay here. 雨声继续。"';
const createInput = {
  activity: 'image',
  prompt: 'A red fox in fog',
  imageModel: 'gpt_image_2',
  aspectRatio: '16:9',
  resolution: '720p',
};
let database: Awaited<ReturnType<typeof createTestDb>>;
let caller: Awaited<ReturnType<typeof signIn>>;
let foreign: Awaited<ReturnType<typeof signIn>>;

// Synthetic OTP and rows; the production Better Auth handler creates and signs the session.
async function signIn() {
  const id = generateId();
  const organizationId = generateId();
  const email = 'studio-' + id.toLowerCase() + '@example.invalid';
  await database.db
    .insert(user)
    .values({ id, email, name: 'Synthetic Studio caller', status: 'active' });
  await database.db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic Studio organization',
    slug: organizationId,
  });
  await database.db.insert(member).values({
    id: generateId(),
    userId: id,
    organizationId,
    role: 'owner',
    createdAt: new Date(),
  });
  await database.db
    .insert(credits)
    .values({ organizationId, balance: INITIAL_BALANCE });
  await database.db.insert(verification).values({
    id: generateId(),
    identifier: 'sign-in-otp-' + email,
    value: '123456:0',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const response = await authApp.fetch(
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

type ServerFunction = Pick<
  typeof entries.createStudioAssetsFn,
  'method' | '__executeServer'
>;
const executionSchema = z.object({
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const createResultSchema = z.object({
  assets: z.array(z.object({ id: z.string(), workflowRunId: z.string() })),
});
const presignSchema = z.object({
  uploadUrl: z.string(),
  publicUrl: z.string(),
  path: z.string(),
  contentType: z.string(),
});

function poisonedData() {
  return {
    userId: foreign.id,
    organizationId: foreign.organizationId,
    promptLocale: 'en',
    locale: 'en',
    model: 'unconfigured-client-model',
    modelConfiguration: { studioDraft: 'unconfigured-client-model' },
  };
}

function startContext(request: Request) {
  return {
    request,
    getRouter: () => {
      throw new Error('Router is outside this synthetic test');
    },
    startOptions: {},
    contextAfterGlobalMiddlewares: {},
    handlerType: 'serverFn' as const,
  };
}

type RunInContext = (
  request: Request,
  callback: () => Promise<Response>
) => Promise<Response>;

function createExecutor(runInContext: RunInContext) {
  return execute.bind(undefined, runInContext);
}

// Enter after RPC decoding; the compiler/manifest/HTTP serializer and global middleware are outside this test.
async function execute(
  runInContext: RunInContext,
  fn: ServerFunction,
  data: unknown,
  locale?: string,
  cookie = caller.cookie
) {
  let result: unknown;
  const app = createServerEntry({
    fetch: (request) =>
      runInContext(request, async () => {
        result = await fn.__executeServer({
          method: fn.method,
          data,
          context: {
            ...poisonedData(),
            user: { id: foreign.id, email: foreign.email },
            session: {
              user: { id: foreign.id },
              session: { activeOrganizationId: foreign.organizationId },
            },
            scopedDb: {
              userId: foreign.id,
              organizationId: foreign.organizationId,
            },
          },
        });
        return new Response(null, { status: 204 });
      }),
  });
  const cookies = [
    cookie,
    ...(locale === undefined ? [] : [LOCALE_COOKIE + '=' + locale]),
  ]
    .filter(Boolean)
    .join('; ');
  const response = await app.fetch(
    new Request(origin + '/_server/synthetic-studio-contract', {
      method: fn.method,
      headers: {
        cookie: cookies,
        origin,
        'cf-connecting-ip': '203.0.113.8',
        'user-agent': 'synthetic-studio',
      },
    })
  );
  expect(response.status, await response.clone().text()).toBe(204);
  return executionSchema.parse(result);
}

async function asset(
  actor = caller,
  source: 'studio' | 'catalog' = 'studio',
  input: GeneratedAssetInput = { prompt: 'Synthetic original' }
) {
  return createScopedDb(actor.organizationId, actor.id).generatedAssets.insert({
    provider: 'fal',
    endpointId: 'synthetic/endpoint',
    activity: 'video',
    modelName: 'Synthetic model',
    source,
    input,
    status: 'completed',
  });
}

async function reservations() {
  return database.db.select().from(creditReservations);
}
async function ledger() {
  return database.db.select().from(transactions);
}
async function assets() {
  return database.db.select().from(generatedAssets);
}

beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  vi.stubGlobal('fetch', runtime.network);
  caller = await signIn();
  foreign = await signIn();
  expect(runtime.network).not.toHaveBeenCalled();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await database.close();
});
beforeEach(async () => {
  await database.db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_run_id_write_failure')
  );
  await database.db.delete(enforcementActions);
  await database.db.delete(generatedAssets);
  await database.db.delete(creditReservations);
  await database.db.delete(transactions);
  await database.db.update(credits).set({ balance: INITIAL_BALANCE });
  vi.clearAllMocks();
  runtime.env.ADMIN_EMAILS = '';
  runtime.trigger.mockResolvedValue('synthetic-studio-run');
  runtime.list.mockResolvedValue({ objects: [], truncated: false });
  runtime.head.mockResolvedValue(null);
  runtime.checkAllowed.mockResolvedValue(undefined);
  runtime.startCheck.mockResolvedValue(undefined);
  runtime.chat.mockImplementation(() =>
    (async function* () {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: DRAFT_TEXT };
      yield {
        type: 'RUN_FINISHED',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cost: REPORTED_COST,
        },
      };
    })()
  );
});
afterEach(() => {
  expect(runtime.network).not.toHaveBeenCalled();
});

const localeCases = [
  { label: 'Chinese', cookie: 'zh-CN', expected: 'zh-CN' },
  { label: 'English', cookie: 'en', expected: 'en' },
  { label: 'missing', cookie: undefined, expected: 'zh-CN' },
  { label: 'unsupported', cookie: 'fr-FR', expected: 'zh-CN' },
  { label: 'malformed', cookie: '%E0%A4%A', expected: 'zh-CN' },
] satisfies Array<{
  label: string;
  cookie: string | undefined;
  expected: Locale;
}>;

// Streaming pass-through only; production R2 FixedLengthStream enforcement is outside Node.
class SyntheticFixedLengthStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  constructor(_length: number) {
    super();
  }
}
beforeEach(() =>
  vi.stubGlobal('FixedLengthStream', SyntheticFixedLengthStream)
);

export {
  runtime,
  origin,
  createInput,
  database,
  caller,
  foreign,
  poisonedData,
  createExecutor,
  startContext,
  asset,
  reservations,
  ledger,
  assets,
  localeCases,
  createResultSchema,
  presignSchema,
  createScopedDb,
};
