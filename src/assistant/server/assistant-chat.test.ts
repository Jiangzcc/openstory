import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatMiddleware, ChatMiddlewareContext } from '@tanstack/ai';
import { micros } from '@/billing/money';
import { estimateLLMCost } from '@/billing/cost-estimation';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type {
  TextModelRoute,
  TextModelRoutingSnapshot,
} from '@/models/text-channels';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';
import type { AssistantCaller } from './assistant-chat';
import type { PageContextItem } from '../page-context';

const CUSTOM_ROUTE: TextModelRoute = {
  modelId: 'custom:request-model',
  name: 'Request model',
  channelId: 'test-channel',
  upstreamModel: 'upstream-model',
  credentialId: 'test-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://models.example/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};

const COST = micros(140);
const usage = { promptTokens: 40, completionTokens: 10, totalTokens: 50 };
const mockCost = vi.fn(() => COST);
const mockCreateAdapter = vi.fn(() => ({ name: 'mock-adapter' }));
const mockError = vi.fn();
type CapturedChat = {
  middleware: ChatMiddleware[];
  modelOptions: unknown;
  systemPrompts: string[];
};
const mockChat = vi.fn((_options: CapturedChat) => (async function* () {})());
const pageContext: PageContextItem[] = [];
const params = {
  threadId: generateId(),
  runId: generateId(),
  messages: [{ role: 'user', content: 'Help me write.' }],
  forwardedProps: { model: CUSTOM_ROUTE.modelId, pageContext },
};
vi.doMock('@tanstack/ai', async () => ({
  ...(await vi.importActual('@tanstack/ai')),
  chat: mockChat,
  chatParamsFromRequest: async () => params,
  toServerSentEventsResponse: () => new Response('mock stream'),
}));
vi.doMock('@tanstack/ai-persistence', () => ({
  withPersistence: () => ({ name: 'mock-persistence' }),
}));
vi.doMock('@/models/server/create-adapter', () => ({
  createAdapter: mockCreateAdapter,
}));
vi.doMock('@/models/server/llm-client', () => ({ llmCostFromUsage: mockCost }));
vi.doMock('@/platform/server/compliance/generation-gate', () => ({
  requireGenerationAllowed: vi.fn(),
}));
vi.doMock('@/platform/server/request-country', () => ({
  getRequestCountry: () => 'CN',
}));
vi.doMock('@/platform/server/observability/ai-otel', () => ({
  aiObservabilityMiddleware: () => [],
}));
vi.doMock('@/platform/logger', async () => ({
  ...(await vi.importActual('@/platform/logger')),
  getLogger: () => ({ error: mockError }),
}));
vi.doMock('./assistant-tools', () => ({ assistantTools: () => [] }));
vi.doMock('./db/assistant', () => ({ threadTitleFrom: () => 'New chat' }));
vi.doMock('./durability', () => ({
  heldStreamLog: vi.fn(),
  sealStreamLog: vi.fn(),
}));
const { handleAssistantChat } = await import('./assistant-chat');

function caller(snapshot: TextModelRoutingSnapshot) {
  const llmKey = {
    key: 'mock-server-secret',
    source: 'platform',
    via: 'compatible',
    route: CUSTOM_ROUTE,
  };
  const resolveLlmKey = vi.fn(async () => llmKey);
  const deductCredits = vi.fn();
  const hasEnoughCredits = vi.fn(async () => true);
  const hasUsableKey = vi.fn(async (_provider: string) => false);
  const ensureThread = vi.fn(async () => ({ id: params.threadId }));
  const context = asStub<AssistantCaller>({
    user: { id: 'u', name: 'Writer' },
    teamId: 't',
    teamName: 'Test team',
    origin: 'https://example.test',
    request: new Request('https://example.test/assistant', { method: 'POST' }),
    scopedDb: {
      modelConfiguration: { get: async () => DEFAULT_MODEL_CONFIGURATION },
      textChannels: { getSnapshot: vi.fn(async () => snapshot) },
      apiKeys: { resolveLlmKey, hasUsableKey },
      billing: { deductCredits, hasEnoughCredits },
      assistant: {
        ensureThread,
        closeOpenRuns: async () => [],
        persistence: () => ({}),
      },
    },
  });
  return {
    context,
    llmKey,
    resolveLlmKey,
    deductCredits,
    ensureThread,
    hasEnoughCredits,
    hasUsableKey,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  params.forwardedProps.pageContext = [];
});

it('uses one routing snapshot and no OpenRouter native search options', async () => {
  const snapshot = [CUSTOM_ROUTE];
  const c = caller(snapshot);
  const response = await handleAssistantChat(c.context);
  expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
    CUSTOM_ROUTE.modelId,
    snapshot
  );
  expect(c.context.scopedDb.textChannels.getSnapshot).toHaveBeenCalledOnce();
  expect(mockCreateAdapter).toHaveBeenCalledExactlyOnceWith(
    CUSTOM_ROUTE.modelId,
    c.llmKey
  );
  expect(mockChat.mock.calls[0]?.[0]?.modelOptions).toEqual({
    max_tokens: CUSTOM_ROUTE.maxOutputTokens,
    stream_options: { include_usage: true },
  });
  expect(await response.text()).not.toContain(c.llmKey.key);
});

it('passes full key info to usage billing without putting it in charge metadata', async () => {
  const c = caller([CUSTOM_ROUTE]);
  await handleAssistantChat(c.context);
  const billing = mockChat.mock.calls[0]?.[0]?.middleware.find(
    (item) => item.name === 'assistant-billing'
  );
  await billing?.onUsage?.(asStub<ChatMiddlewareContext>({}), usage);
  expect(mockCost).toHaveBeenCalledExactlyOnceWith(
    usage,
    CUSTOM_ROUTE.modelId,
    c.llmKey
  );
  expect(c.deductCredits).toHaveBeenCalledWith(
    COST,
    expect.objectContaining({
      metadata: {
        model: CUSTOM_ROUTE.modelId,
        runId: params.runId,
        iteration: 1,
      },
    })
  );
  expect(JSON.stringify(c.deductCredits.mock.calls)).not.toContain(
    c.llmKey.key
  );
});

it.each([{ snapshot: [] }, { snapshot: [{ ...CUSTOM_ROUTE, tools: false }] }])(
  'refuses missing or tool-incapable custom routes before creating a thread',
  async ({ snapshot }) => {
    const c = caller(snapshot);
    await expect(handleAssistantChat(c.context)).rejects.toThrow();
    expect(c.ensureThread).not.toHaveBeenCalled();
    expect(c.resolveLlmKey).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  }
);

it('does not log raw custom provider errors or secrets', async () => {
  const c = caller([CUSTOM_ROUTE]);
  await handleAssistantChat(c.context);
  const errors = mockChat.mock.calls[0]?.[0]?.middleware.find(
    (item) => item.name === 'assistant-model-error'
  );
  await errors?.onModelError?.(
    asStub<ChatMiddlewareContext>({}),
    asStub({
      message: c.llmKey.key,
      rawEvent: { authorization: c.llmKey.key },
    })
  );
  expect(mockError).toHaveBeenCalled();
  expect(JSON.stringify(mockError.mock.calls)).not.toContain(c.llmKey.key);
});

it('requires vision before attaching page images to a custom assistant model', async () => {
  params.forwardedProps.pageContext = [
    {
      kind: 'shot',
      id: 'shot-1',
      label: 'Shot 1',
      image: '/r2/team/still.png',
    },
  ];
  const c = caller([{ ...CUSTOM_ROUTE, vision: false }]);
  await expect(handleAssistantChat(c.context)).rejects.toThrow(
    'support vision'
  );
  expect(c.resolveLlmKey).not.toHaveBeenCalled();
  expect(mockChat).not.toHaveBeenCalled();
});

it('refuses an unaffordable platform turn before creating a thread or calling a model', async () => {
  const c = caller([CUSTOM_ROUTE]);
  c.hasEnoughCredits.mockResolvedValue(false);
  await expect(handleAssistantChat(c.context)).rejects.toMatchObject({
    code: 'INSUFFICIENT_CREDITS',
    statusCode: 402,
    message: 'Add credits to chat with the assistant.',
  });
  expect(c.hasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    estimateLLMCost(2),
    undefined
  );
  expect(c.ensureThread).not.toHaveBeenCalled();
  expect(mockCreateAdapter).not.toHaveBeenCalled();
  expect(mockChat).not.toHaveBeenCalled();
  expect(c.deductCredits).not.toHaveBeenCalled();
});

it.each(['openrouter', 'fal'])(
  'does not let an unrelated %s team key bypass a platform channel credit check',
  async (provider) => {
    const c = caller([CUSTOM_ROUTE]);
    c.hasEnoughCredits.mockResolvedValue(false);
    c.hasUsableKey.mockImplementation(
      async (candidate) => candidate === provider
    );
    await expect(handleAssistantChat(c.context)).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });
    expect(c.hasUsableKey).not.toHaveBeenCalled();
    expect(c.ensureThread).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  }
);

it('retains no-credit and no-platform-charge behavior for an actual team key', async () => {
  const c = caller([CUSTOM_ROUTE]);
  c.llmKey.source = 'team';
  c.hasEnoughCredits.mockResolvedValue(false);
  await handleAssistantChat(c.context);
  expect(c.hasEnoughCredits).not.toHaveBeenCalled();
  expect(c.hasUsableKey).not.toHaveBeenCalled();
  const billing = mockChat.mock.calls[0]?.[0]?.middleware.find(
    (item) => item.name === 'assistant-billing'
  );
  await billing?.onUsage?.(asStub<ChatMiddlewareContext>({}), usage);
  expect(c.deductCredits).not.toHaveBeenCalled();
});

it('validates the merged transcript after the persistence middleware', async () => {
  const c = caller([{ ...CUSTOM_ROUTE, vision: false }]);
  await handleAssistantChat(c.context);
  const middleware = mockChat.mock.calls[0]?.[0]?.middleware ?? [];
  const persistence = middleware.findIndex(
    (item) => item.name === 'mock-persistence'
  );
  const validation = middleware.findIndex(
    (item) => item.name === 'assistant-vision-validation'
  );
  expect(persistence).toBeGreaterThanOrEqual(0);
  expect(validation).toBeGreaterThan(persistence);
});
