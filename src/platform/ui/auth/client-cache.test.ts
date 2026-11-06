import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthCacheGeneration,
  AUTH_SESSION_QUERY_KEY,
} from './auth-cache-generation';

// HTTP is mocked. The actual Better Auth client and cache success hook execute.
const client = new QueryClient();
vi.doMock('@/ui/query-client', () => ({ getQueryClient: () => client }));
const { authClient, authData } = await import('./client');
function mockFetch(status = 200) {
  return vi.fn(async (url: unknown) => {
    const response = new Response(
      JSON.stringify(
        status === 200
          ? { success: true, id: 'mock-org-B' }
          : { code: 'MOCK_DENIED', message: 'Mock refusal' }
      ),
      { status, headers: { 'content-type': 'application/json' } }
    );
    Object.defineProperty(response, 'url', {
      value: new URL(String(url), 'https://fixture.example').href,
    });
    return response;
  });
}
function seed() {
  client.setQueryData(AUTH_SESSION_QUERY_KEY, {
    user: { id: 'mock-admin' },
    session: { id: 'mock-session' },
  });
  client.setQueryData(['admin', 'text-channels'], {
    channels: ['mock-private-channel'],
  });
  client.setQueryData(['model-configuration', 'admin'], {
    version: 'mock-version',
  });
}
beforeEach(seed);
afterEach(() => client.clear());

describe('authentication cache lifecycle', () => {
  it('expires the old generation and removes admin caches on sign-out', async () => {
    const generation = new AuthCacheGeneration(client);
    const fetch = mockFetch();
    await authClient.signOut({ fetchOptions: { customFetchImpl: fetch } });
    expect(generation.isCurrent()).toBe(false);
    expect(client.getQueryData(AUTH_SESSION_QUERY_KEY)).toBeNull();
    expect(client.getQueryData(['admin', 'text-channels'])).toBeUndefined();
    expect(
      client.getQueryData(['model-configuration', 'admin'])
    ).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('expires the old generation on a successful OTP login, including the same account', async () => {
    const generation = new AuthCacheGeneration(client);
    const fetch = mockFetch();
    await authClient.signIn.emailOtp({
      email: 'admin@example.test',
      otp: '000000',
      fetchOptions: { customFetchImpl: fetch },
    });
    seed();
    expect(generation.isCurrent()).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('expires the old generation on an organization switch', async () => {
    const generation = new AuthCacheGeneration(client);
    await authData(
      authClient.organization.setActive({
        organizationId: 'mock-org-B',
        fetchOptions: { customFetchImpl: mockFetch() },
      })
    );
    expect(generation.isCurrent()).toBe(false);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
  it('retains the generation and caches when the organization switch is refused', async () => {
    const generation = new AuthCacheGeneration(client);
    await expect(
      authData(
        authClient.organization.setActive({
          organizationId: 'mock-org-B',
          fetchOptions: { customFetchImpl: mockFetch(403) },
        })
      )
    ).rejects.toThrow('Mock refusal');
    expect(generation.isCurrent()).toBe(true);
    expect(client.getQueryData(['admin', 'text-channels'])).toBeDefined();
  });
});
