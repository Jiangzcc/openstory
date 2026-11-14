import type { QueryClient, QueryCacheNotifyEvent } from '@tanstack/react-query';
import { getSequenceFn } from '@/sequences/sequences.fn';
import { getLogger } from '@/platform/logger';
import { sequenceKeys } from './use-sequences';
import {
  finishGenerationLaunch,
  getGenerationLaunch,
} from './generation-stream.launch';

const logger = getLogger(['openstory', 'generation', 'owner-reconciliation']);
const confirmations = new WeakMap<QueryClient, Map<string, () => void>>();

function isOwnerRead(
  queryClient: QueryClient,
  sequenceId: string,
  event: QueryCacheNotifyEvent
): boolean {
  return (
    event.type === 'updated' &&
    event.action.type === 'success' &&
    event.action.manual !== true &&
    queryClient
      .getQueryCache()
      .find({ queryKey: sequenceKeys.detail(sequenceId), exact: true }) ===
      event.query
  );
}

function watchOwnerConfirmation(
  queryClient: QueryClient,
  sequenceId: string,
  token: number
): () => void {
  const pending =
    confirmations.get(queryClient) ?? new Map<string, () => void>();
  confirmations.set(queryClient, pending);
  pending.get(sequenceId)?.();
  let armed = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    const launch = getGenerationLaunch(queryClient, sequenceId);
    if (!launch.pending || launch.token !== token) return cleanup();
    if (!armed || !isOwnerRead(queryClient, sequenceId, event)) return;
    cleanup();
    finishGenerationLaunch(queryClient, sequenceId, token);
  });
  function cleanup(): void {
    unsubscribe();
    if (pending.get(sequenceId) === cleanup) pending.delete(sequenceId);
  }
  pending.set(sequenceId, cleanup);
  return () => {
    armed = true;
  };
}

export async function reconcileGenerationLaunch(
  queryClient: QueryClient,
  sequenceId: string,
  token: number
): Promise<boolean> {
  const current = getGenerationLaunch(queryClient, sequenceId);
  if (!current.pending || current.token !== token) return false;
  const armConfirmation = watchOwnerConfirmation(
    queryClient,
    sequenceId,
    token
  );
  const queryKey = sequenceKeys.detail(sequenceId);
  try {
    await queryClient.cancelQueries({ queryKey, exact: true });
    const afterCancel = getGenerationLaunch(queryClient, sequenceId);
    if (afterCancel.token !== token) return false;
    if (!afterCancel.pending) return true;
    armConfirmation();
    await queryClient.fetchQuery({
      queryKey,
      queryFn: () => getSequenceFn({ data: { sequenceId } }),
      staleTime: 0,
    });
  } catch (error) {
    logger.warn(
      'Awaiting a successful sequence read to confirm generation ownership',
      { err: error, sequenceId }
    );
    return false;
  }
  const confirmed = getGenerationLaunch(queryClient, sequenceId);
  return confirmed.token === token && !confirmed.pending;
}
