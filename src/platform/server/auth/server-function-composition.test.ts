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
// oxlint-disable-next-line boundaries/no-raw-db -- substitute the isolated in-memory DB at the factory boundary
import { getDb } from '#db-client';
import { describeUploadFn } from '@/cast/describe-upload.fn';
import { describeUpload } from '@/cast/server/describe-upload';
import { generateMusicFn } from '@/sequences/sequences.fn';
import { generateMusic } from '@/audio/server/music-edit';
import { generateShotImageFn } from '@/stills/shot-image.fn';
import { generateShotImage } from '@/stills/server/shot-image-generation';
import { regenerateLocationSheetFn } from '@/cast/sequence-locations.fn';
import { regenerateLocationSheet } from '@/cast/server/cast-generation';
import { createGeneratedAssetFn } from '@/models/model-assets.fn';
import { createGeneratedAsset } from '@/models/server/generated-assets';
import { AuthenticationError, NotFoundError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import type { Locale } from '@/platform/i18n/locale';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { LOCALE_COOKIE } from '@/platform/i18n/locale';
import { getAuth } from '@/platform/server/auth/config';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  frames,
  locations,
  member,
  organization,
  sequences,
  shots,
  styles,
  user,
  verification,
} from '@/platform/server/db/schema';

const runtime = vi.hoisted(() => {
  const network = vi.fn(async () => {
    throw new Error(
      'Unexpected network in synthetic web-function composition test'
    );
  });
  vi.stubGlobal('fetch', network);
  return {
    network,
    env: {
      VITE_APP_URL: 'http://localhost:3997',
      BETTER_AUTH_SECRET:
        'synthetic-web-composition-secret-at-least-32-characters',
      ADMIN_EMAILS: '',
      OPENROUTER_KEY: 'synthetic-web-key',
      FAL_KEY: 'synthetic-web-key',
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
vi.mock('@/platform/server/emails/email-service', () => ({
  sendOtpEmail: vi.fn(async () => ({ success: true })),
  sendOrganizationInvitationEmail: vi.fn(async () => ({ success: true })),
}));
// Only the final shared service calls are doubles; middleware and actor construction stay real.
vi.mock('@/cast/server/describe-upload', () => ({ describeUpload: vi.fn() }));
vi.mock('@/models/server/generated-assets', () => ({
  createGeneratedAsset: vi.fn(),
}));
vi.mock('@/audio/server/music-edit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/audio/server/music-edit')>()),
  generateMusic: vi.fn(),
}));
vi.mock('@/stills/server/shot-image-generation', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/stills/server/shot-image-generation')
  >()),
  generateShotImage: vi.fn(),
}));
vi.mock('@/cast/server/cast-generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/cast/server/cast-generation')>()),
  regenerateLocationSheet: vi.fn(),
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
            const id = 'synthetic-web-function-' + ++functionId;
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

const origin = runtime.env.VITE_APP_URL;
const authApp = createServerEntry({
  fetch: (request) => getAuth().handler(request),
});
let database: Awaited<ReturnType<typeof createTestDb>> | undefined;
let caller: Awaited<ReturnType<typeof signIn>>;
let other: Awaited<ReturnType<typeof signIn>>;
let own: Awaited<ReturnType<typeof seedTarget>>;
let sibling: Awaited<ReturnType<typeof seedTarget>>;
let foreign: Awaited<ReturnType<typeof seedTarget>>;
const generatedAssetId = generateId();

function requiredDatabase() {
  if (!database) throw new Error('Composition database has not initialized');
  return database;
}

async function seedTarget(actor: { id: string; organizationId: string }) {
  const db = requiredDatabase().db;
  const styleId = generateId();
  const sequenceId = generateId();
  const shotId = generateId();
  const frameId = generateId();
  const locationDbId = generateId();
  await db.insert(styles).values({
    id: styleId,
    organizationId: actor.organizationId,
    name: 'Synthetic composition style',
    config: {
      mood: 'neutral',
      artStyle: 'cinematic',
      lighting: 'natural',
      colorPalette: ['#000', '#fff'],
      cameraWork: 'static',
      referenceFilms: [],
      colorGrading: 'neutral',
    },
  });
  await db.insert(sequences).values({
    id: sequenceId,
    organizationId: actor.organizationId,
    title: 'Synthetic composition sequence',
    styleId,
    createdBy: actor.id,
  });
  await db.insert(shots).values({ id: shotId, sequenceId, shotNumber: 1 });
  await db.insert(frames).values({ id: frameId, shotId, sequenceId });
  await db.insert(locations).values({
    id: locationDbId,
    organizationId: actor.organizationId,
    legacyName: 'Synthetic location',
  });
  return { sequenceId, shotId, frameId, locationDbId };
}

// Synthetic rows and OTP; the production auth handler signs and sets the session cookie.
async function signIn() {
  const db = requiredDatabase().db;
  const id = generateId();
  const organizationId = generateId();
  const email = 'web-' + id.toLowerCase() + '@example.invalid';
  await db
    .insert(user)
    .values({ id, email, name: 'Synthetic web caller', status: 'active' });
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic web organization',
    slug: organizationId,
  });
  await db.insert(member).values({
    id: generateId(),
    organizationId,
    userId: id,
    role: 'owner',
    createdAt: new Date(),
  });
  await db.insert(verification).values({
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
  typeof describeUploadFn,
  'method' | '__executeServer'
>;
const executionSchema = z.object({
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

type ExecutionOptions = {
  locale?: string;
  context?: Record<string, unknown>;
  sessionCookie?: string;
};

// Enter after RPC decoding; this does not implement the compiler, manifest, serializer or global request middleware.
async function execute(
  fn: ServerFunction,
  data: unknown,
  options: ExecutionOptions = {}
) {
  let execution: unknown;
  const app = createServerEntry({
    fetch: (request) =>
      runWithStartContext(
        {
          request,
          getRouter: () => {
            throw new Error(
              'Router rendering is outside this composition test'
            );
          },
          startOptions: {},
          contextAfterGlobalMiddlewares: {},
          handlerType: 'serverFn',
        },
        async () => {
          execution = await fn.__executeServer({
            method: fn.method,
            data,
            context: options.context,
          });
          return new Response(null, { status: 204 });
        }
      ),
  });
  const cookie = [
    options.sessionCookie ?? caller.cookie,
    ...(options.locale === undefined
      ? []
      : [LOCALE_COOKIE + '=' + options.locale]),
  ]
    .filter(Boolean)
    .join('; ');
  const response = await app.fetch(
    new Request(origin + '/_server/synthetic-web-composition', {
      method: fn.method,
      headers: { cookie, origin },
    })
  );
  expect(response.status, await response.clone().text()).toBe(204);
  return executionSchema.parse(execution);
}

function soleCall<T extends unknown[]>(calls: T[]): T {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (!call) throw new Error('Expected one shared-service call');
  return call;
}

function expectScope(
  scopedDb: Pick<ScopedDb, 'organizationId' | 'userId'>,
  organizationId = caller.organizationId
) {
  expect(scopedDb.organizationId).toBe(organizationId);
  expect(scopedDb.userId).toBe(caller.id);
}

function poisonedContext(promptLocale: string) {
  const context = {
    user: { id: other.id, email: other.email },
    userId: other.id,
    session: {
      user: { id: other.id },
      session: { activeOrganizationId: other.organizationId },
    },
    organizationId: other.organizationId,
    organization: { id: other.organizationId },
    org: other.organizationId,
    locale: promptLocale,
    promptLocale,
    scopedDb: {
      userId: other.id,
      organizationId: other.organizationId,
      syntheticClientDb: true,
    },
    sequence: { id: foreign.sequenceId, organizationId: other.organizationId },
    shot: { id: foreign.shotId, sequenceId: foreign.sequenceId },
  };
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(JSON.stringify(context)));
}

const localeCases = [
  { label: 'Chinese', cookie: 'zh-CN', expected: 'zh-CN' },
  { label: 'English', cookie: 'en', expected: 'en' },
  { label: 'missing', cookie: undefined, expected: 'zh-CN' },
  { label: 'unsupported', cookie: 'fr-FR', expected: 'zh-CN' },
  { label: 'malformed encoding', cookie: '%E0%A4%A', expected: 'zh-CN' },
] satisfies Array<{
  label: string;
  cookie: string | undefined;
  expected: Locale;
}>;
const supportedLocales: Locale[] = ['zh-CN', 'en'];
const uploadData = {
  url: 'https://example.invalid/synthetic.png',
  filename: '小鹿.png',
  subject: 'character',
};

beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  caller = await signIn();
  other = await signIn();
  own = await seedTarget(caller);
  sibling = await seedTarget(caller);
  foreign = await seedTarget(other);
  expect(runtime.network).not.toHaveBeenCalled();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await database?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  runtime.env.ADMIN_EMAILS = '';
  vi.mocked(describeUpload).mockResolvedValue({
    description: 'Synthetic description',
    isCharacterSheet: false,
  });
  vi.mocked(generateMusic).mockResolvedValue({ variantId: null });
  vi.mocked(generateShotImage).mockImplementation(async ({ shot }) => ({
    workflowRunId: 'synthetic-shot-run',
    shotId: shot.id,
    alreadyInFlight: false,
  }));
  vi.mocked(regenerateLocationSheet).mockImplementation(
    async (_db, _actor, _sequence, data) => ({
      locationDbId: data.locationDbId,
      workflowRunId: 'synthetic-location-run',
    })
  );
  vi.mocked(createGeneratedAsset).mockResolvedValue({
    ok: true,
    id: generatedAssetId,
    workflowRunId: 'synthetic-asset-run',
  });
});

afterEach(() => {
  expect(runtime.network).not.toHaveBeenCalled();
});

describe('web server-function composition: explicit upload actor (O)', () => {
  it.each(localeCases)(
    'uses the $label Cookie and strips body/decoded-context identity injection',
    async ({ cookie, expected }) => {
      const attack = poisonedContext(expected === 'en' ? 'zh-CN' : 'en');
      const result = await execute(
        describeUploadFn,
        { ...uploadData, ...attack, context: attack },
        {
          locale: cookie,
          context: attack,
        }
      );
      expect(result.error).toBeUndefined();
      expect(describeUpload).toHaveBeenCalledExactlyOnceWith({
        ...uploadData,
        promptLocale: expected,
        userId: caller.id,
        scopedDb: expect.objectContaining({
          organizationId: caller.organizationId,
          userId: caller.id,
        }),
      });
      expect(result.result).toEqual({
        description: 'Synthetic description',
        isCharacterSheet: false,
      });
    }
  );

  it.each([
    { field: 'filename', value: '' },
    { field: 'subject', value: 'forged-subject' },
  ])(
    'runs the real handler validator for invalid $field',
    async ({ field, value }) => {
      const result = await execute(describeUploadFn, {
        ...uploadData,
        [field]: value,
      });
      expect(result.error).toBeInstanceOf(z.ZodError);
      expect(describeUpload).not.toHaveBeenCalled();
    }
  );

  it.each(['missing', 'tampered'])(
    'refuses a $s session despite a forged context',
    async (kind) => {
      const tokenCookie = caller.cookie
        .split('; ')
        .find((part) => part.includes('session_token='));
      if (!tokenCookie)
        throw new Error('Expected the auth handler session cookie');
      const sessionCookie =
        kind === 'missing'
          ? ''
          : tokenCookie.split('=')[0] + '=synthetic-invalid-signature';
      const result = await execute(describeUploadFn, uploadData, {
        sessionCookie,
        context: poisonedContext('en'),
      });
      expect(result.error).toBeInstanceOf(AuthenticationError);
      expect(describeUpload).not.toHaveBeenCalled();
    }
  );
});

describe('web server-function composition: sequence actor extension (S)', () => {
  it.each(supportedLocales)(
    'passes the real sequence and %s actor to music',
    async (locale) => {
      const data = {
        sequenceId: own.sequenceId,
        prompt: '保留这段音乐说明',
        duration: 7,
      };
      const result = await execute(
        generateMusicFn,
        { ...data, ...poisonedContext('invalid') },
        {
          locale,
          context: poisonedContext('invalid'),
        }
      );
      expect(result.error).toBeUndefined();
      const [db, actor, sequence, validated] = soleCall(
        vi.mocked(generateMusic).mock.calls
      );
      expectScope(db);
      expect(actor).toEqual({ userId: caller.id, promptLocale: locale });
      expect(sequence).toMatchObject({
        id: own.sequenceId,
        organizationId: caller.organizationId,
      });
      expect(validated).toEqual(data);
      expect(result.result).toEqual({ variantId: null });
    }
  );

  it.each(['foreign', 'missing'])(
    'refuses a $s sequence before music',
    async (target) => {
      runtime.env.ADMIN_EMAILS = other.email;
      const result = await execute(
        generateMusicFn,
        {
          sequenceId: target === 'foreign' ? foreign.sequenceId : generateId(),
          ...poisonedContext('en'),
        },
        { context: poisonedContext('en') }
      );
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error).toMatchObject({ message: 'Sequence not found' });
      expect(generateMusic).not.toHaveBeenCalled();
    }
  );

  it('validates the middleware sequence id before loading it', async () => {
    const result = await execute(generateMusicFn, { sequenceId: 'not-a-ulid' });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(generateMusic).not.toHaveBeenCalled();
  });

  it('validates duration in the .fn after sequence middleware', async () => {
    const result = await execute(generateMusicFn, {
      sequenceId: own.sequenceId,
      duration: 601,
    });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(generateMusic).not.toHaveBeenCalled();
  });

  it.each(supportedLocales)(
    'keeps web system-admin cross-organization music with %s',
    async (locale) => {
      runtime.env.ADMIN_EMAILS = caller.email;
      const result = await execute(
        generateMusicFn,
        { sequenceId: foreign.sequenceId },
        {
          locale,
          context: poisonedContext('invalid'),
        }
      );
      expect(result.error).toBeUndefined();
      const [db, actor, sequence] = soleCall(
        vi.mocked(generateMusic).mock.calls
      );
      expectScope(db, other.organizationId);
      expect(actor).toEqual({ userId: caller.id, promptLocale: locale });
      expect(sequence).toMatchObject({
        id: foreign.sequenceId,
        organizationId: other.organizationId,
      });
      expect(await db.sequences.getById(foreign.sequenceId)).toMatchObject({
        id: foreign.sequenceId,
      });
      expect(await db.sequences.getById(own.sequenceId)).toBeNull();
    }
  );
});

describe('web server-function composition: shot actor extension (H)', () => {
  it.each(supportedLocales)(
    'loads a real shot/anchor and forwards %s to image generation',
    async (locale) => {
      const data = {
        sequenceId: own.sequenceId,
        shotId: own.shotId,
        prompt: '原始图像描述，keep dialogue.',
      };
      const result = await execute(
        generateShotImageFn,
        { ...data, ...poisonedContext('invalid') },
        {
          locale,
          context: poisonedContext('invalid'),
        }
      );
      expect(result.error).toBeUndefined();
      const [context, validated] = soleCall(
        vi.mocked(generateShotImage).mock.calls
      );
      expectScope(context.scopedDb);
      expect(context.user.id).toBe(caller.id);
      expect(context.organizationId).toBe(caller.organizationId);
      expect(context.promptLocale).toBe(locale);
      expect(context.sequence).toMatchObject({
        id: own.sequenceId,
        organizationId: caller.organizationId,
      });
      expect(context.shot).toMatchObject({
        id: own.shotId,
        sequenceId: own.sequenceId,
      });
      expect(context.frame).toMatchObject({
        id: own.frameId,
        shotId: own.shotId,
      });
      expect(validated).toEqual(data);
      expect(result.result).toEqual({
        workflowRunId: 'synthetic-shot-run',
        shotId: own.shotId,
        alreadyInFlight: false,
      });
    }
  );

  it.each(['foreign sequence', 'foreign shot', 'same-org other sequence'])(
    'rejects $s before image generation',
    async (target) => {
      const sequenceId =
        target === 'foreign sequence' ? foreign.sequenceId : own.sequenceId;
      const shotId =
        target === 'same-org other sequence' ? sibling.shotId : foreign.shotId;
      const result = await execute(
        generateShotImageFn,
        { sequenceId, shotId },
        { context: poisonedContext('en') }
      );
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error).toMatchObject({
        message:
          target === 'foreign sequence'
            ? 'Sequence not found'
            : 'Shot not found in this sequence',
      });
      expect(generateShotImage).not.toHaveBeenCalled();
    }
  );

  it('runs the shot-id middleware validator', async () => {
    const result = await execute(generateShotImageFn, {
      sequenceId: own.sequenceId,
      shotId: 'not-a-ulid',
    });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(generateShotImage).not.toHaveBeenCalled();
  });

  it('runs the .fn image validator after loading the target', async () => {
    const result = await execute(generateShotImageFn, {
      sequenceId: own.sequenceId,
      shotId: own.shotId,
      prompt: 7,
    });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(generateShotImage).not.toHaveBeenCalled();
  });

  it.each(supportedLocales)(
    'keeps web system-admin cross-organization shot access with %s',
    async (locale) => {
      runtime.env.ADMIN_EMAILS = caller.email;
      const result = await execute(
        generateShotImageFn,
        { sequenceId: foreign.sequenceId, shotId: foreign.shotId },
        {
          locale,
          context: poisonedContext('invalid'),
        }
      );
      expect(result.error).toBeUndefined();
      const [context] = soleCall(vi.mocked(generateShotImage).mock.calls);
      expectScope(context.scopedDb, other.organizationId);
      expect(context.user.id).toBe(caller.id);
      expect(context.organizationId).toBe(other.organizationId);
      expect(context.promptLocale).toBe(locale);
      expect(context.sequence).toMatchObject({
        id: foreign.sequenceId,
        organizationId: other.organizationId,
      });
      expect(context.shot).toMatchObject({
        id: foreign.shotId,
        sequenceId: foreign.sequenceId,
      });
      expect(context.frame).toMatchObject({
        id: foreign.frameId,
        shotId: foreign.shotId,
      });
    }
  );

  it('still refuses a shot from a different sequence for a web system admin', async () => {
    runtime.env.ADMIN_EMAILS = caller.email;
    const result = await execute(generateShotImageFn, {
      sequenceId: own.sequenceId,
      shotId: sibling.shotId,
    });
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(result.error).toMatchObject({
      message: 'Shot not found in this sequence',
    });
    expect(generateShotImage).not.toHaveBeenCalled();
  });
});

describe('web server-function composition: nullable cast actor (C)', () => {
  it.each(supportedLocales)(
    'preserves sequenceId=null, real organization and %s',
    async (locale) => {
      const data = { sequenceId: null, locationDbId: own.locationDbId };
      const result = await execute(
        regenerateLocationSheetFn,
        { ...data, ...poisonedContext('invalid') },
        {
          locale,
          context: poisonedContext('invalid'),
        }
      );
      expect(result.error).toBeUndefined();
      const [db, actor, sequence, validated] = soleCall(
        vi.mocked(regenerateLocationSheet).mock.calls
      );
      expectScope(db);
      expect(actor).toEqual({ userId: caller.id, promptLocale: locale });
      expect(sequence).toBeNull();
      expect(validated).toEqual(data);
      expect(result.result).toEqual({
        locationDbId: own.locationDbId,
        workflowRunId: 'synthetic-location-run',
      });
    }
  );

  it('uses the real non-null cast sequence', async () => {
    const data = { sequenceId: own.sequenceId, locationDbId: own.locationDbId };
    const result = await execute(regenerateLocationSheetFn, data, {
      locale: 'en',
      context: poisonedContext('invalid'),
    });
    expect(result.error).toBeUndefined();
    const [db, actor, sequence, validated] = soleCall(
      vi.mocked(regenerateLocationSheet).mock.calls
    );
    expectScope(db);
    expect(actor).toEqual({ userId: caller.id, promptLocale: 'en' });
    expect(sequence).toMatchObject({
      id: own.sequenceId,
      organizationId: caller.organizationId,
    });
    expect(validated).toEqual(data);
  });

  it('refuses another organization sequence before the location service', async () => {
    const result = await execute(
      regenerateLocationSheetFn,
      { sequenceId: foreign.sequenceId, locationDbId: foreign.locationDbId },
      {
        context: poisonedContext('en'),
      }
    );
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(regenerateLocationSheet).not.toHaveBeenCalled();
  });

  it('keeps the web system-admin cast exception with a re-scoped database', async () => {
    runtime.env.ADMIN_EMAILS = caller.email;
    const result = await execute(
      regenerateLocationSheetFn,
      { sequenceId: foreign.sequenceId, locationDbId: foreign.locationDbId },
      {
        locale: 'en',
        context: poisonedContext('invalid'),
      }
    );
    expect(result.error).toBeUndefined();
    const [db, actor, sequence] = soleCall(
      vi.mocked(regenerateLocationSheet).mock.calls
    );
    expectScope(db, other.organizationId);
    expect(actor).toEqual({ userId: caller.id, promptLocale: 'en' });
    expect(sequence).toMatchObject({
      id: foreign.sequenceId,
      organizationId: other.organizationId,
    });
  });

  it('does not silently default an omitted sequenceId to null', async () => {
    const result = await execute(regenerateLocationSheetFn, {
      locationDbId: own.locationDbId,
    });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(regenerateLocationSheet).not.toHaveBeenCalled();
  });

  it('runs the location .fn validator after nullable cast middleware', async () => {
    const result = await execute(regenerateLocationSheetFn, {
      sequenceId: null,
      locationDbId: 'not-a-ulid',
    });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(regenerateLocationSheet).not.toHaveBeenCalled();
  });
});

describe('web server-function composition: identity carried by scopedDb', () => {
  it.each(localeCases)(
    'passes $label locale and real scopedDb identity to generated assets',
    async ({ cookie, expected }) => {
      const attack = poisonedContext(expected === 'en' ? 'zh-CN' : 'en');
      const data = {
        endpointId: 'synthetic/model',
        activity: 'image',
        modelName: 'Synthetic model',
        input: { prompt: '用户原文 preserved', locale: 'provider-owned-value' },
      };
      const result = await execute(
        createGeneratedAssetFn,
        { ...data, ...attack, context: attack },
        { locale: cookie, context: attack }
      );
      expect(result.error).toBeUndefined();
      const [db, validated, locale] = soleCall(
        vi.mocked(createGeneratedAsset).mock.calls
      );
      expectScope(db);
      expect(locale).toBe(expected);
      expect(validated).toEqual(data);
      expect(await db.sequences.getById(own.sequenceId)).toMatchObject({
        id: own.sequenceId,
      });
      expect(await db.sequences.getById(foreign.sequenceId)).toBeNull();
      expect(result.result).toEqual({
        ok: true,
        id: generatedAssetId,
        workflowRunId: 'synthetic-asset-run',
      });
    }
  );

  it('runs the generated-asset .fn Zod validator before the shared service', async () => {
    const result = await execute(createGeneratedAssetFn, {
      endpointId: 'synthetic/model',
      activity: 'forged-activity',
      modelName: 'Synthetic model',
      input: {},
    });
    expect(result.error).toBeInstanceOf(z.ZodError);
    expect(createGeneratedAsset).not.toHaveBeenCalled();
  });
});
