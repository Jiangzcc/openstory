import type { Query, QueryClient } from '@tanstack/react-query';
import type { getSessionFn } from '@/platform/session.fn';

type AuthSession = Awaited<ReturnType<typeof getSessionFn>>;
export const AUTH_SESSION_QUERY_KEY = ['session'] as const;

export class AuthCacheGeneration {
  private readonly sessionQuery: Query | undefined;
  private readonly userId: string | undefined;
  private readonly sessionId: string | undefined;

  constructor(private readonly queryClient: QueryClient) {
    this.sessionQuery = queryClient.getQueryCache().find({
      queryKey: AUTH_SESSION_QUERY_KEY,
      exact: true,
    });
    const session = queryClient.getQueryData<AuthSession>(
      AUTH_SESSION_QUERY_KEY
    );
    this.userId = session?.user.id;
    this.sessionId = session?.session.id;
  }

  isCurrent(): boolean {
    const session = this.queryClient.getQueryData<AuthSession>(
      AUTH_SESSION_QUERY_KEY
    );
    const query = this.queryClient.getQueryCache().find({
      queryKey: AUTH_SESSION_QUERY_KEY,
      exact: true,
    });
    // Clearing the cache replaces the session Query, even when the same user signs in again.
    return (
      this.sessionQuery !== undefined &&
      this.sessionQuery === query &&
      this.userId !== undefined &&
      this.sessionId !== undefined &&
      session?.user.id === this.userId &&
      session.session.id === this.sessionId
    );
  }
}
