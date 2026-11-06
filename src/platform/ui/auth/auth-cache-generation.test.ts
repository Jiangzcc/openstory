import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it } from 'vitest';
import {
  AuthCacheGeneration,
  AUTH_SESSION_QUERY_KEY,
} from './auth-cache-generation';

// Minimal mock sessions; no auth API or database is used.
const clients: QueryClient[] = [];
function makeClient(userId = 'mock-admin', sessionId = 'mock-session') {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: userId },
    session: { id: sessionId },
  });
  return client;
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

it('retains the generation during a same-session refresh without creating a query or request', () => {
  const client = makeClient();
  const count = client.getQueryCache().getAll().length;
  const generation = new AuthCacheGeneration(client);
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: 'mock-admin', name: 'Updated' },
    session: { id: 'mock-session' },
  });
  expect(generation.isCurrent()).toBe(true);
  expect(client.getQueryCache().getAll()).toHaveLength(count);
});
it('expires when clear recreates the cache, even for identical user and session ids', () => {
  const client = makeClient();
  const generation = new AuthCacheGeneration(client);
  client.clear();
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: 'mock-admin' },
    session: { id: 'mock-session' },
  });
  expect(generation.isCurrent()).toBe(false);
  expect(new AuthCacheGeneration(client).isCurrent()).toBe(true);
});
it.each([
  { user: { id: 'mock-other' }, session: { id: 'mock-session' } },
  { user: { id: 'mock-admin' }, session: { id: 'mock-new-session' } },
  null,
])(
  'expires when the principal/session changes without a clear: %j',
  (session) => {
    const client = makeClient();
    const generation = new AuthCacheGeneration(client);
    client.setQueryData(AUTH_SESSION_QUERY_KEY, session);
    expect(generation.isCurrent()).toBe(false);
  }
);
it('refuses an absent session and never treats a later login as its generation', () => {
  const client = new QueryClient();
  clients.push(client);
  const generation = new AuthCacheGeneration(client);
  expect(generation.isCurrent()).toBe(false);
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: 'mock-admin' },
    session: { id: 'mock-session' },
  });
  expect(generation.isCurrent()).toBe(false);
});
it('isolates generations between separate clients, including SSR requests', () => {
  const first = makeClient();
  const second = makeClient();
  const firstGeneration = new AuthCacheGeneration(first);
  const secondGeneration = new AuthCacheGeneration(second);
  first.clear();
  expect(firstGeneration.isCurrent()).toBe(false);
  expect(secondGeneration.isCurrent()).toBe(true);
});
