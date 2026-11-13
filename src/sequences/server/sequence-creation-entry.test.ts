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
import { createServerEntry } from '@tanstack/react-start/server';
import { runWithStartContext } from '@tanstack/start-storage-context';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
// oxlint-disable-next-line boundaries/no-raw-db -- replace only the raw handle with isolated D1
import { getDb } from '#db-client';
import { getAuth } from '@/platform/server/auth/config';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { LOCALE_COOKIE } from '@/platform/i18n/locale';
import { AuthenticationError } from '@/platform/errors';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import { MODEL_CONFIGURATION_KEY } from '@/models/server/db/model-configuration';
import { TEST_FAL_PRICING } from '@/billing/fal-pricing-fixture';
import {
  appMetadata,
  credits,
  member,
  organization,
  sequences,
  user,
  verification,
} from '@/platform/server/db/schema';

const runtime = vi.hoisted(() => {
  const network = vi.fn(async (): Promise<Response> => {
    throw new Error(
      'Synthetic sequence creation forbids provider/network calls'
    );
  });
  vi.stubGlobal('fetch', network);
  return {
    network,
    capture: vi.fn(),
    afterCapture: vi.fn<() => Promise<void>>(async () => undefined),
    trigger: vi.fn<typeof import('./launchers').triggerStoryboard>(),
    env: {
      VITE_APP_URL: 'http://localhost:3995',
      BETTER_AUTH_SECRET: 'synthetic-sequence-secret-at-least-32-characters',
      ADMIN_EMAILS: '',
      OPENROUTER_KEY: 'synthetic-sequence-key',
      FAL_KEY: 'synthetic-sequence-key',
      ELEVENLABS_API_KEY: '',
      E2E_TEST: 'false',
    },
  };
});
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({ getEnv: () => runtime.env }));
vi.mock('#flush-scheduler', () => ({
  scheduleFlushAnalytics: vi.fn(async () => undefined),
}));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.mock('@/look/server/bump-style-popularity', () => ({
  bumpStylePopularity: vi.fn(),
}));
vi.mock('@/platform/server/emails/email-service', () => ({
  sendOtpEmail: vi.fn(async () => ({ success: true })),
  sendOrganizationInvitationEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/billing/server/fal-pricing-live', () => ({
  getEffectiveFalPricing: async () => TEST_FAL_PRICING,
}));
// Only final dispatch and effects are doubles; Start/auth, D1 reads/writes, schemas and create orchestration stay real.
vi.mock('./launchers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./launchers')>()),
  triggerStoryboard: runtime.trigger,
}));
vi.mock('@/platform/server/db/scoped', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/server/db/scoped')>();
  return {
    ...actual,
    loadModelConfiguration: async () => {
      runtime.capture();
      const snapshot = await actual.loadModelConfiguration();
      await runtime.afterCapture();
      return snapshot;
    },
    loadModelRuntimeConfiguration: async () => {
      runtime.capture();
      const snapshot = await actual.loadModelRuntimeConfiguration();
      await runtime.afterCapture();
      return snapshot;
    },
  };
});

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

const { createSequenceFn } = await import('../sequences.fn');
const origin = runtime.env.VITE_APP_URL;
const INITIAL_BALANCE = 10_000_000;
const authApp = createServerEntry({
  fetch: (request) => getAuth().handler(request),
});
let database: Awaited<ReturnType<typeof createTestDb>>;
let caller: Awaited<ReturnType<typeof signIn>>;
let foreign: Awaited<ReturnType<typeof signIn>>;
const configurationA: ModelConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  defaultAnalysis: 'google/gemini-3.8-flash',
  defaultImage: 'flux_2_turbo',
  defaultVideo: 'minimax_h3_max',
  defaultMusic: 'ace_step',
};
const configurationB: ModelConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  defaultAnalysis: 'anthropic/claude-sonnet-5.5',
  defaultImage: 'gpt_image_2',
  defaultVideo: 'minimax_h3_max',
  defaultMusic: 'ace_step',
};
const executionSchema = z.object({
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const sequenceResultSchema = z.array(
  z.object({
    id: z.string(),
    organizationId: z.string(),
    createdBy: z.string(),
    analysisModel: z.string(),
    script: z.string(),
  })
);

async function saveConfiguration(configuration: ModelConfiguration) {
  const value = JSON.stringify(configuration);
  await database.db
    .insert(appMetadata)
    .values({ key: MODEL_CONFIGURATION_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appMetadata.key,
      set: { value, updatedAt: new Date() },
    });
}

function input(extra: Record<string, unknown> = {}) {
  return {
    script:
      'INT. LIGHTHOUSE - NIGHT. A keeper lights the lamp. ' + generateId(),
    styleId: 'auto',
    aspectRatio: '16:9',
    stopAt: 'script',
    generateStartFrames: true,
    generateVoices: false,
    ...extra,
  };
}

// Enter after RPC decoding; no compiled manifest, browser serializer or global request middleware is claimed.
async function execute(data: unknown, locale?: string, cookie = caller.cookie) {
  let result: unknown;
  const app = createServerEntry({
    fetch: (request) =>
      runWithStartContext(
        {
          request,
          getRouter: () => {
            throw new Error('Router is outside this composition test');
          },
          startOptions: {},
          contextAfterGlobalMiddlewares: {},
          handlerType: 'serverFn',
        },
        async () => {
          result = await createSequenceFn.__executeServer({
            method: createSequenceFn.method,
            data,
            context: {
              user: { id: foreign.id },
              organizationId: foreign.organizationId,
              promptLocale: 'en',
              modelConfiguration: configurationB,
            },
          });
          return new Response(null, { status: 204 });
        }
      ),
  });
  const cookies = [
    cookie,
    ...(locale === undefined ? [] : [LOCALE_COOKIE + '=' + locale]),
  ]
    .filter(Boolean)
    .join('; ');
  const response = await app.fetch(
    new Request(origin + '/_server/synthetic-create-capture', {
      method: createSequenceFn.method,
      headers: {
        cookie: cookies,
        origin,
        'user-agent': 'synthetic-sequence-capture',
      },
    })
  );
  expect(response.status, await response.clone().text()).toBe(204);
  return executionSchema.parse(result);
}

beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  caller = await signIn();
  foreign = await signIn();
});
afterAll(async () => {
  await database.close();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  vi.clearAllMocks();
  runtime.afterCapture.mockReset().mockResolvedValue(undefined);
  runtime.trigger.mockReset().mockImplementation(async () => ({
    workflowRunId: 'synthetic-storyboard-' + generateId(),
  }));
  await saveConfiguration(configurationA);
});
afterEach(() => {
  expect(runtime.network).not.toHaveBeenCalled();
});

const locales = [
  { label: 'Chinese', cookie: 'zh-CN', expected: 'zh-CN' },
  { label: 'English', cookie: 'en', expected: 'en' },
  { label: 'missing', cookie: undefined, expected: 'zh-CN' },
  { label: 'malformed', cookie: '%E0%A4%A', expected: 'zh-CN' },
];

describe('web sequence creation trusted preparation and capture', () => {
  it.each(locales)(
    'keeps the captured configuration with trusted actor and $label locale',
    async ({ cookie, expected }) => {
      runtime.afterCapture.mockImplementationOnce(() =>
        saveConfiguration(configurationB)
      );
      const request = input({
        userId: foreign.id,
        organizationId: foreign.organizationId,
        promptLocale: 'en',
        modelConfiguration: configurationB,
      });
      const outcome = await execute(request, cookie);
      expect(outcome.error).toBeUndefined();
      const rows = sequenceResultSchema.parse(outcome.result);
      expect(rows).toHaveLength(1);
      const created = rows[0];
      if (!created) throw new Error('Expected a created sequence');
      expect(rows[0]).toMatchObject({
        organizationId: caller.organizationId,
        createdBy: caller.id,
        analysisModel: configurationA.defaultAnalysis,
        script: request.script,
      });
      const stored = await database.db
        .select()
        .from(sequences)
        .where(eq(sequences.id, created.id));
      expect(stored[0]).toMatchObject({
        analysisModel: configurationA.defaultAnalysis,
        imageModel: configurationA.defaultImage,
        createdBy: caller.id,
        organizationId: caller.organizationId,
      });
      expect(runtime.capture).toHaveBeenCalledOnce();
      expect(runtime.trigger).toHaveBeenCalledOnce();
      const call = runtime.trigger.mock.calls[0];
      expect(call?.[1]).toMatchObject({
        userId: caller.id,
        organizationId: caller.organizationId,
        promptLocale: expected,
      });
      expect(call?.[2]).toEqual({
        ...configurationA,
        textModelRouting: [],
        imageModelRouting: [],
      });
    }
  );

  it('lets the next independent request see the changed administrator configuration', async () => {
    runtime.afterCapture.mockImplementationOnce(() =>
      saveConfiguration(configurationB)
    );
    const request = input();
    const first = await execute(request);
    const second = await execute(request);
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(sequenceResultSchema.parse(first.result)[0]?.analysisModel).toBe(
      configurationA.defaultAnalysis
    );
    expect(sequenceResultSchema.parse(second.result)[0]?.analysisModel).toBe(
      configurationB.defaultAnalysis
    );
    const calls = runtime.trigger.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[2]).toEqual({
      ...configurationA,
      textModelRouting: [],
      imageModelRouting: [],
    });
    expect(calls[1]?.[2]).toEqual({
      ...configurationB,
      textModelRouting: [],
      imageModelRouting: [],
    });
    expect(runtime.capture).toHaveBeenCalledTimes(2);
  });

  it('retains explicit model choices while using the trusted captured helper configuration', async () => {
    runtime.afterCapture.mockImplementationOnce(() =>
      saveConfiguration(configurationB)
    );
    const request = input({
      analysisModels: [configurationB.defaultAnalysis],
      imageModels: [configurationB.defaultImage],
    });
    const outcome = await execute(request, 'en');
    expect(outcome.error).toBeUndefined();
    expect(sequenceResultSchema.parse(outcome.result)[0]?.analysisModel).toBe(
      configurationB.defaultAnalysis
    );
    expect(runtime.trigger.mock.calls[0]?.[1].imageModels).toEqual([
      configurationB.defaultImage,
    ]);
    expect(runtime.trigger.mock.calls[0]?.[2]).toEqual({
      ...configurationA,
      textModelRouting: [],
      imageModelRouting: [],
    });
  });

  it.each([
    { analysisModels: null },
    { analysisModels: ['unintegrated/model'] },
    { imageModels: null },
  ])('keeps invalid input out of the shared create core', async (invalid) => {
    const before = await database.db
      .select({ id: sequences.id })
      .from(sequences);
    const outcome = await execute(input(invalid));
    expect(outcome.error).toBeInstanceOf(z.ZodError);
    expect(runtime.capture).toHaveBeenCalledOnce();
    expect(runtime.trigger).not.toHaveBeenCalled();
    expect(
      await database.db.select({ id: sequences.id }).from(sequences)
    ).toEqual(before);
  });

  it('keeps authentication before configuration capture and input validation', async () => {
    const outcome = await execute({ script: null }, 'en', '');
    expect(outcome.error).toBeInstanceOf(AuthenticationError);
    expect(runtime.capture).not.toHaveBeenCalled();
    expect(runtime.trigger).not.toHaveBeenCalled();
  });
});

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
