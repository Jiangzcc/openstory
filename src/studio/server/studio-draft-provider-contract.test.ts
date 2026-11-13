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
import { eq } from 'drizzle-orm';
// oxlint-disable-next-line boundaries/no-raw-db -- isolated D1 replaces only the raw handle
import { getDb } from '#db-client';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  credits,
  organization,
  transactions,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { micros } from '@/billing/money';
import { InsufficientCreditsError } from '@/platform/errors';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ResolvedLlmKey } from '@/models/server/db/api-keys';
import type { TextModelRoute } from '@/models/text-channels';
import { resolveLlmKeyForModel } from '@/models/server/llm-key-routing';
import type { OrganizationLlmKeyLookup } from '@/models/server/llm-key-routing';
import { REGION_FALLBACK_MODEL } from '@/models/region-policy';
import { resetGoogleRegionBlock } from '@/models/google-region';
import { draftStudioPrompt } from './studio-prompt-draft';
import { draftStudioPromptForOrganization } from './studio-asset-actions';

const runtime = vi.hoisted(() => ({
  chat: vi.fn(),
  observation: vi.fn(() => []),
  network: vi.fn(async () => {
    throw new Error('Unexpected network in synthetic Studio provider contract');
  }),
  env: {
    OPENROUTER_KEY: 'synthetic-platform-key',
    FAL_KEY: '',
    GEMINI_API_KEY: '',
    E2E_TEST: 'false',
    VITE_APP_URL: 'http://localhost:3996',
  },
}));
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({ getEnv: () => runtime.env }));
// Only chat events, telemetry delivery and realtime are doubles; adapters, retries, key routing and accounting execute for real.
vi.mock('@tanstack/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/ai')>()),
  chat: runtime.chat,
}));
vi.mock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: runtime.observation,
}));
vi.mock('@/platform/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/realtime')>()),
  getBillingChannel: () => ({
    emit: vi.fn(async () => undefined),
    history: async () => [],
  }),
}));

// Fixture factory follows create-studio-asset.test.ts; production entries use the real middleware.
const { createScopedDb } = await import('@/platform/server/db/scoped');

const INITIAL_BALANCE = 100_000_000;
const SELECTED_MODEL = 'google/gemini-3.8-flash';
const route: TextModelRoute = {
  modelId: REGION_FALLBACK_MODEL,
  name: 'Synthetic fallback route',
  channelId: 'synthetic-channel',
  upstreamModel: 'synthetic-upstream-model',
  credentialId: 'synthetic-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://studio-provider.example.invalid/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};
const compatibleKey: ResolvedLlmKey = {
  key: 'synthetic-compatible-key',
  source: 'platform',
  via: 'compatible',
  route,
};
const platformKey: ResolvedLlmKey = {
  key: 'synthetic-platform-key',
  source: 'platform',
  via: 'openrouter',
};
let database: Awaited<ReturnType<typeof createTestDb>>;
const organizationId = generateId();
const userId = generateId();

function stream(text = '"@Image1 moves through the rain."', cost?: number) {
  return (async function* () {
    yield { type: 'TEXT_MESSAGE_CONTENT', delta: text };
    yield {
      type: 'RUN_FINISHED',
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        ...(cost === undefined ? {} : { cost }),
      },
    };
  })();
}

function regionFailure() {
  return (async function* () {
    yield {
      type: 'RUN_ERROR',
      message: 'No endpoints found that support image input',
    };
  })();
}

beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  vi.stubGlobal('fetch', runtime.network);
  await database.db.insert(user).values({
    id: userId,
    name: 'Synthetic draft actor',
    email: 'synthetic-draft@example.invalid',
  });
  await database.db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic draft organization',
    slug: organizationId,
  });
  await database.db
    .insert(credits)
    .values({ organizationId, balance: INITIAL_BALANCE });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await database.close();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  resetGoogleRegionBlock();
  await database.db.delete(transactions);
  await database.db.update(credits).set({ balance: INITIAL_BALANCE });
  runtime.chat.mockImplementation(() => stream());
});
afterEach(() => expect(runtime.network).not.toHaveBeenCalled());

async function organizationDraftContext(withOwnGoogleKey = false) {
  const scopedDb = createScopedDb(organizationId, userId);
  vi.spyOn(scopedDb.textChannels, 'getSnapshot').mockResolvedValue([route]);
  vi.spyOn(scopedDb.modelConfiguration, 'get').mockResolvedValue({
    ...DEFAULT_MODEL_CONFIGURATION,
    studioDraft: SELECTED_MODEL,
  });
  const resolve = vi
    .spyOn(scopedDb.apiKeys, 'resolveLlmKey')
    .mockImplementation((model, snapshot) =>
      resolveLlmKeyForModel(model, snapshot ?? [], {
        organizationKey: async (via): Promise<OrganizationLlmKeyLookup> =>
          withOwnGoogleKey && via === 'google'
            ? { key: 'synthetic-organization-google-key' }
            : {},
        channelSecret: async () => 'synthetic-compatible-key',
      })
    );
  return { scopedDb, resolve };
}

describe('Studio draft through real adapters, region fallback and usage pricing', () => {
  it('uses reported OpenRouter cost and preserves cleaned output', async () => {
    runtime.chat.mockImplementationOnce(() => stream(undefined, 0.0024));
    const result = await draftStudioPrompt({
      model: SELECTED_MODEL,
      promptLocale: 'en',
      activity: 'image',
      references: [],
      llmKey: platformKey,
    });
    expect(result).toMatchObject({
      prompt: 'Image1 moves through the rain.',
      model: SELECTED_MODEL,
      usedOwnKey: false,
      costMicros: micros(2400),
    });
    expect(runtime.chat).toHaveBeenCalledOnce();
  });

  it('prices a configured route from its immutable token rates rather than a provider cost hint', async () => {
    runtime.chat.mockImplementationOnce(() => stream(undefined, 999));
    const result = await draftStudioPrompt({
      model: REGION_FALLBACK_MODEL,
      promptLocale: 'zh-CN',
      activity: 'image',
      references: [],
      llmKey: compatibleKey,
    });
    expect(result.costMicros).toBe(micros(5000));
    expect(runtime.chat.mock.calls[0]?.[0].systemPrompts[0]).toContain(
      '你为 AI 图片生成器'
    );
  });

  it('bills the actual fallback route rates after the model and via changed', async () => {
    runtime.chat
      .mockImplementationOnce(regionFailure)
      .mockImplementationOnce(() => stream());
    const { scopedDb, resolve } = await organizationDraftContext();
    const result = await draftStudioPromptForOrganization(
      scopedDb,
      { activity: 'image', references: [] },
      'en'
    );
    expect(result).toEqual({ prompt: 'Image1 moves through the rain.' });
    expect(resolve.mock.calls.map(([model]) => model)).toEqual([
      SELECTED_MODEL,
      REGION_FALLBACK_MODEL,
    ]);
    expect(runtime.chat).toHaveBeenCalledTimes(2);
    expect(await database.db.select().from(transactions)).toEqual([
      expect.objectContaining({
        organizationId,
        userId,
        amount: -5000,
        metadata: expect.objectContaining({ model: REGION_FALLBACK_MODEL }),
      }),
    ]);
  });

  it('attributes the successful fallback to its real payer when only the initial native key was organization-owned', async () => {
    runtime.chat
      .mockImplementationOnce(regionFailure)
      .mockImplementationOnce(() => stream());
    const { scopedDb } = await organizationDraftContext(true);
    const result = await draftStudioPromptForOrganization(
      scopedDb,
      { activity: 'image', references: [] },
      'zh-CN'
    );
    expect(result.prompt).toBe('Image1 moves through the rain.');
    expect(await database.db.select().from(transactions)).toEqual([
      expect.objectContaining({
        organizationId,
        userId,
        amount: -5000,
        metadata: expect.objectContaining({ model: REGION_FALLBACK_MODEL }),
      }),
    ]);
  });

  it('preflights the actual platform fallback before it can spend after an organization-key attempt', async () => {
    runtime.chat
      .mockImplementationOnce(regionFailure)
      .mockImplementationOnce(() => stream());
    const { scopedDb } = await organizationDraftContext(true);
    await database.db
      .update(credits)
      .set({ balance: 0 })
      .where(eq(credits.organizationId, organizationId));
    await expect(
      draftStudioPromptForOrganization(
        scopedDb,
        { activity: 'image', references: [] },
        'en'
      )
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(runtime.chat).toHaveBeenCalledOnce();
    expect(await database.db.select().from(transactions)).toEqual([]);
  });

  it('preserves organization-key coverage when the native organization key actually answers', async () => {
    const { scopedDb, resolve } = await organizationDraftContext(true);
    const result = await draftStudioPromptForOrganization(
      scopedDb,
      { activity: 'image', references: [] },
      'en'
    );
    expect(result.prompt).toBe('Image1 moves through the rain.');
    expect(await resolve.mock.results[0]?.value).toMatchObject({
      source: 'organization',
      via: 'google',
    });
    expect(runtime.chat).toHaveBeenCalledOnce();
    expect(await database.db.select().from(transactions)).toEqual([]);
    expect(await scopedDb.billing.getBalance()).toBe(micros(INITIAL_BALANCE));
  });

  it('keeps compatible provider failures terminal with no model fallback or debit', async () => {
    runtime.chat.mockImplementationOnce(regionFailure);
    const resolveLlmKey = vi.fn(async () => platformKey);
    await expect(
      draftStudioPrompt({
        model: REGION_FALLBACK_MODEL,
        promptLocale: 'en',
        activity: 'image',
        references: [],
        llmKey: compatibleKey,
        resolveLlmKey,
      })
    ).rejects.toThrow('No endpoints found that support image input');
    expect(runtime.chat).toHaveBeenCalledOnce();
    expect(resolveLlmKey).not.toHaveBeenCalled();
  });
});
