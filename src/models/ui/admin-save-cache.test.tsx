import {
  QueryClientProvider,
  MutationObserver,
  QueryObserver,
  useMutation,
} from '@tanstack/react-query';
import type {
  MutationObserverOptions,
  QueryClient,
} from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asStub } from '@/test/as-stub';
import { AuthenticationError } from '@/platform/errors';
import {
  AuthCacheGeneration,
  AUTH_SESSION_QUERY_KEY,
} from '@/platform/ui/auth/auth-cache-generation';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';

// All HTTP, auth/session rows and saved configurations are mock fixtures.
// Real hook callbacks, QueryClient/MutationObserver and auth cache-clearing code execute.
const mocks = vi.hoisted(() => ({
  currentClient: vi.fn<() => QueryClient>(),
  getAdminTextChannelsFn: vi.fn(),
  getTextModelCatalogFn: vi.fn(),
  saveTextChannelFn: vi.fn(),
  saveChannelTextModelFn: vi.fn(),
  syncTextChannelModelsFn: vi.fn(),
  getModelConfigurationFn: vi.fn(),
  getAdminModelConfigurationFn: vi.fn(),
  saveModelConfigurationFn: vi.fn(),
  notify: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useMutation: vi.fn(actual.useMutation) };
});
vi.mock('@/ui/query-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ui/query-client')>()),
  getQueryClient: () => mocks.currentClient(),
}));
vi.mock('@/models/text-channels.fn', () => mocks);
vi.mock('@/models/model-configuration.fn', () => mocks);
vi.mock('@/billing/ui/notify-insufficient-credits', () => ({
  notifyInsufficientCredits: mocks.notify,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));
import { makeQueryClient } from '@/ui/query-client';
import { authClient } from '@/platform/ui/auth/client';
import { useAdminTextChannels } from './use-admin-text-channels';
import { useAdminModelConfiguration } from './use-admin-model-configuration';

const ADMIN_DEFAULT_KEY = ['model-configuration', 'admin'];
const ADMIN_CHANNEL_KEY = ['admin', 'text-channels'];
const channelSnapshot = {
  revision: 3,
  channels: [
    {
      id: 'mock-channel',
      name: 'Mock channel',
      baseUrl: 'https://private.example/v1',
      protocol: 'openai-chat-completions',
      enabled: false,
      credentialId: 'mock-private-reference',
      keyHint: 'mock-hint',
      hasKey: true,
    },
  ],
  models: [],
};
const defaultConfiguration = { ...DEFAULT_MODEL_CONFIGURATION };
const channelInput = {
  revision: 2,
  id: 'mock-channel',
  name: 'Mock channel',
  baseUrl: 'https://private.example/v1',
  protocol: 'openai-chat-completions',
  enabled: false,
  apiKey: '',
};
const modelInput = {
  revision: 2,
  id: 'custom:mock',
  name: 'Mock model',
  channelId: 'mock-channel',
  upstreamModel: 'mock/upstream',
  enabled: false,
  vision: false,
  structuredOutput: true,
  tools: false,
  contextWindow: 8000,
  maxOutputTokens: 1000,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
};
const cases = [
  {
    name: 'channel save',
    kind: 'channels',
    index: 1,
    save: mocks.saveTextChannelFn,
    input: channelInput,
    result: channelSnapshot,
    key: ADMIN_CHANNEL_KEY,
  },
  {
    name: 'binding save',
    kind: 'channels',
    index: 2,
    save: mocks.saveChannelTextModelFn,
    input: modelInput,
    result: channelSnapshot,
    key: ADMIN_CHANNEL_KEY,
  },
  {
    name: 'default model save',
    kind: 'defaults',
    index: 0,
    save: mocks.saveModelConfigurationFn,
    input: defaultConfiguration,
    result: defaultConfiguration,
    key: ADMIN_DEFAULT_KEY,
  },
];
type SaveCase = (typeof cases)[number];
const clients: QueryClient[] = [];
const subscriptions: (() => void)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((fulfill, refuse) => {
    resolve = fulfill;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
function seedSession(
  client: QueryClient,
  userId = 'mock-admin',
  sessionId = 'mock-session'
) {
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: userId },
    session: { id: sessionId, activeOrganizationId: 'mock-org-A' },
  });
}
function setup() {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  mocks.currentClient.mockReturnValue(client);
  clients.push(client);
  seedSession(client);
  client.setQueryData(ADMIN_CHANNEL_KEY, { ...channelSnapshot, revision: 2 });
  client.setQueryData(ADMIN_DEFAULT_KEY, defaultConfiguration);
  client.setQueryData(['model-configuration'], defaultConfiguration);
  client.setQueryData(['text-model-catalog'], []);
  return client;
}
function ChannelProbe() {
  useAdminTextChannels();
  return null;
}
function DefaultProbe() {
  useAdminModelConfiguration();
  return null;
}
function optionsFor(testCase: SaveCase, client: QueryClient) {
  vi.mocked(useMutation).mockClear();
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {testCase.kind === 'defaults' ? <DefaultProbe /> : <ChannelProbe />}
    </QueryClientProvider>
  );
  const options = vi.mocked(useMutation).mock.calls[testCase.index]?.[0];
  expect(options).toBeDefined();
  return asStub<
    MutationObserverOptions<unknown, Error, unknown, AuthCacheGeneration>
  >(options);
}
function mockHttp(url: unknown) {
  const response = new Response(
    JSON.stringify({ success: true, id: 'mock-org-B' }),
    { headers: { 'content-type': 'application/json' } }
  );
  Object.defineProperty(response, 'url', {
    value: new URL(String(url), 'https://fixture.example').href,
  });
  return Promise.resolve(response);
}
async function changeIdentity(client: QueryClient, transition: string) {
  if (transition === 'organization') {
    await authClient.organization.setActive({
      organizationId: 'mock-org-B',
      fetchOptions: { customFetchImpl: mockHttp },
    });
    seedSession(client);
    return;
  }
  await authClient.signOut({ fetchOptions: { customFetchImpl: mockHttp } });
  if (transition === 'logout') return;
  await authClient.signIn.emailOtp({
    email: 'mock@example.test',
    otp: '000000',
    fetchOptions: { customFetchImpl: mockHttp },
  });
  if (transition === 'same-account') seedSession(client);
  else seedSession(client, 'mock-ordinary', 'mock-ordinary-session');
}
function observeCurrentAccount(client: QueryClient) {
  const read = vi.fn(async () => 'mock-current-data');
  client.setQueryData(['mock-current-account-resource'], 'mock-current-data');
  const observer = new QueryObserver(client, {
    queryKey: ['mock-current-account-resource'],
    queryFn: read,
    staleTime: Infinity,
  });
  subscriptions.push(observer.subscribe(() => {}));
  return read;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminTextChannelsFn.mockResolvedValue(channelSnapshot);
  mocks.getTextModelCatalogFn.mockResolvedValue([]);
  mocks.getAdminModelConfigurationFn.mockResolvedValue(defaultConfiguration);
});
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

async function verifyDelayedSave(testCase: SaveCase, transition: string) {
  const client = setup();
  const started = deferred<void>();
  const response = deferred<unknown>();
  testCase.save.mockImplementationOnce(() => {
    started.resolve();
    return response.promise;
  });
  const observer = new MutationObserver(client, optionsFor(testCase, client));
  const pending = observer.mutate(testCase.input);
  await started.promise;
  await changeIdentity(client, transition);
  const read = observeCurrentAccount(client);
  const write = vi.spyOn(client, 'setQueryData');
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  response.resolve(testCase.result);
  await pending;
  expect(client.getQueryData(testCase.key)).toBeUndefined();
  expect(client.getQueryData(['model-configuration'])).toBeUndefined();
  expect(write).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(testCase.save).toHaveBeenCalledOnce();
}

async function verifyCurrentSave(testCase: SaveCase) {
  const client = setup();
  testCase.save.mockResolvedValueOnce(testCase.result);
  const observer = new MutationObserver(client, optionsFor(testCase, client));
  await observer.mutate(testCase.input);
  expect(client.getQueryData(testCase.key)).toEqual(testCase.result);
  if (testCase.kind === 'defaults')
    expect(client.getQueryData(['model-configuration'])).toEqual(
      defaultConfiguration
    );
  expect(mocks.success).toHaveBeenCalledOnce();
  expect(testCase.save).toHaveBeenCalledWith({ data: testCase.input });
}

async function verifyDelayedAuthFailure(testCase: SaveCase) {
  const client = setup();
  const started = deferred<void>();
  const response = deferred<unknown>();
  testCase.save.mockImplementationOnce(() => {
    started.resolve();
    return response.promise;
  });
  const observer = new MutationObserver(client, optionsFor(testCase, client));
  const outcome = observer
    .mutate(testCase.input)
    .catch((error: unknown) => error);
  await started.promise;
  await changeIdentity(client, 'other-account');
  const current = client.getQueryData(AUTH_SESSION_QUERY_KEY);
  const error = new AuthenticationError('Mock old session expired');
  response.reject(error);
  expect(await outcome).toBe(error);
  expect(client.getQueryData(AUTH_SESSION_QUERY_KEY)).toEqual(current);
}

describe.each(cases)('$name authentication lifecycle', (testCase) => {
  it.each(['logout', 'other-account', 'same-account', 'organization'])(
    'ignores a delayed save after %s without writes, refetches or success feedback',
    (transition) => verifyDelayedSave(testCase, transition)
  );
  it('applies a result in the same generation and shares defaults with the public cache', () =>
    verifyCurrentSave(testCase));
  it('does not let a delayed old 401 clear the new account session', () =>
    verifyDelayedAuthFailure(testCase));
});
