import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '@/platform/i18n/locale';
import { asStub } from '@/test/as-stub';
import type { AssistantCaller } from './assistant-chat';
import type { OpenStoryMcpContext } from '@/platform/server/mcp/tool-context';

// Mock transport, auth gates, DB and MCP execution; invoke the real entry callbacks.
type EntryContext = Pick<
  AssistantCaller,
  'promptLocale' | 'user' | 'organizationId' | 'scopedDb'
>;
type RouteHandler = (input: {
  request: Request;
  context: EntryContext;
}) => Promise<Response>;
type FunctionHandler = (input: {
  context: EntryContext;
  data: { name: string; arguments: Record<string, unknown> };
}) => Promise<unknown>;
type FnHarness = {
  middlewares: unknown[];
  run: FunctionHandler;
};

const requestGate = { name: 'mock-organization-request-gate' };
const functionGate = { name: 'mock-organization-function-gate' };
const getRequest = vi.fn<() => Request>();
const chat = vi.fn<(caller: AssistantCaller) => Promise<Response>>();
const join = vi.fn<(caller: AssistantCaller) => Response>();
const hydrate = vi.fn<(caller: AssistantCaller) => Promise<Response>>();
const toolContext = vi.fn<(caller: AssistantCaller) => OpenStoryMcpContext>();
const execute = vi.fn();

function createFnHarness() {
  const middlewares: unknown[] = [];
  return {
    middleware(values: unknown[]) {
      middlewares.push(...values);
      return this;
    },
    validator() {
      return this;
    },
    handler(run: FunctionHandler): FnHarness {
      return { middlewares, run };
    },
  };
}

vi.doMock('@tanstack/react-start', () => ({ createServerFn: createFnHarness }));
vi.doMock('@tanstack/react-start/server', () => ({ getRequest }));
vi.doMock('@/platform/middleware.fn', () => ({
  authWithOrganizationRequestMiddleware: requestGate,
  authWithOrganizationMiddleware: functionGate,
}));
vi.doMock('./assistant-chat', () => ({
  handleAssistantChat: chat,
  handleAssistantJoin: join,
  handleAssistantHydrate: hydrate,
  toolContext,
}));
vi.doMock('./durability', () => ({ deleteStreamLogs: vi.fn() }));
vi.doMock('@/platform/server/mcp/server', () => ({
  MCP_TOOLS: [{ name: 'openstory.get_sequence_status', execute }],
}));
vi.doMock('@/platform/server/mcp/ui/sequence-card', () => ({
  SEQUENCE_CARD_HTML: '<p>Mock view</p>',
}));

const { Route } = await import('@/routes/api/assistant/chat');
const { callMcpReadToolFn } = await import('../assistant.fn');
const handlers = z
  .object({
    POST: z.custom<RouteHandler>((value) => typeof value === 'function'),
    GET: z.custom<RouteHandler>((value) => typeof value === 'function'),
  })
  .parse(Route.options.server?.handlers);
const readTool = asStub<FnHarness>(callMcpReadToolFn);

function context(promptLocale: AssistantCaller['promptLocale']): EntryContext {
  return asStub<EntryContext>({
    promptLocale,
    user: { id: 'mock-user', name: 'Mock writer' },
    organizationId: 'mock-organization',
    scopedDb: {
      assistant: { organizationName: async () => 'Mock organization' },
    },
  });
}

function request(path: string, method: 'GET' | 'POST', cookie: string) {
  return new Request(`https://assistant.invalid${path}`, {
    method,
    headers: { cookie },
    ...(method === 'POST' ? { body: 'mock AG-UI body' } : {}),
  });
}

beforeEach(() => vi.clearAllMocks());

it('keeps both entry points behind the existing organization gates', () => {
  expect(Route.options.server?.middleware).toEqual([requestGate]);
  expect(readTool.middlewares).toEqual([functionGate]);
});

it.each(SUPPORTED_LOCALES)(
  'passes captured %s and the original POST request to the streaming handler',
  async (promptLocale) => {
    const captured = context(promptLocale);
    const value = request(
      '/api/assistant/chat',
      'POST',
      `openstory_locale=${promptLocale === 'en' ? 'zh-CN' : 'en'}`
    );
    const stream = new Response('mock stream', {
      headers: { 'content-type': 'text/event-stream' },
    });
    chat.mockResolvedValueOnce(stream);
    expect(await handlers.POST({ request: value, context: captured })).toBe(
      stream
    );
    expect(chat).toHaveBeenCalledExactlyOnceWith({
      ...captured,
      organizationName: 'Mock organization',
      origin: 'https://assistant.invalid',
      request: value,
    });
    expect(chat.mock.calls[0]?.[0].request).toBe(value);
    expect(await value.text()).toBe('mock AG-UI body');
  }
);

it.each(SUPPORTED_LOCALES)(
  'preserves captured %s and GET join/hydrate routing',
  async (promptLocale) => {
    const captured = context(promptLocale);
    for (const query of ['runId=mock-run&offset=-1', 'threadId=mock-thread']) {
      const value = request(
        `/api/assistant/chat?${query}`,
        'GET',
        'session=mock'
      );
      const response = new Response('mock stored chat');
      join.mockReturnValue(response);
      hydrate.mockResolvedValue(response);
      expect(await handlers.GET({ request: value, context: captured })).toBe(
        response
      );
      const target = query.startsWith('runId=') ? join : hydrate;
      expect(target).toHaveBeenLastCalledWith({
        ...captured,
        organizationName: 'Mock organization',
        origin: 'https://assistant.invalid',
        request: value,
      });
      expect(target.mock.calls.at(-1)?.[0].request).toBe(value);
    }
  }
);

it.each(SUPPORTED_LOCALES)(
  'passes captured %s from the read-tool server function without changing its envelope',
  async (promptLocale) => {
    const captured = context(promptLocale);
    const value = request('/_server/mock-read-tool', 'POST', 'session=mock');
    getRequest.mockReturnValueOnce(value);
    const mcpContext = asStub<OpenStoryMcpContext>({ origin: 'mock-context' });
    toolContext.mockReturnValueOnce(mcpContext);
    const envelope = {
      content: [],
      structuredContent: { status: 'mock-ready' },
    };
    execute.mockResolvedValueOnce(envelope);
    expect(
      await readTool.run({
        context: captured,
        data: { name: 'openstory.get_sequence_status', arguments: {} },
      })
    ).toEqual(envelope);
    expect(toolContext).toHaveBeenCalledExactlyOnceWith({
      ...captured,
      organizationName: 'Mock organization',
      origin: 'https://assistant.invalid',
      request: value,
    });
    expect(toolContext.mock.calls[0]?.[0].request).toBe(value);
    expect(execute).toHaveBeenCalledWith(
      {},
      { context: mcpContext, emitCustomEvent: expect.any(Function) }
    );
  }
);
