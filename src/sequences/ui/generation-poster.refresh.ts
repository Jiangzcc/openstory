import { isCancelledError, type QueryClient } from '@tanstack/react-query';
import { getSequenceFn } from '@/sequences/sequences.fn';
import {
  generationLaunchKey,
  getGenerationLaunch,
} from './generation-stream.launch';
import { sequenceKeys } from './use-sequences';

type PosterRefresh = {
  client: QueryClient;
  sequenceId: string;
  entries: Map<string, PosterRefresh>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  unsubscribe: () => void;
  dirty: boolean;
  running: boolean;
  fetching: boolean;
  closed: boolean;
  error?: unknown;
};

const refreshes = new WeakMap<QueryClient, Map<string, PosterRefresh>>();

function sameKey(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((part, i) => part === right[i])
  );
}

function pending(state: PosterRefresh): boolean {
  return getGenerationLaunch(state.client, state.sequenceId).pending;
}

function blocked(state: PosterRefresh): boolean {
  return state.closed || pending(state);
}

function closeRefresh(state: PosterRefresh, error?: unknown): void {
  if (state.closed) return;
  state.closed = true;
  state.unsubscribe();
  state.entries.delete(state.sequenceId);
  if (error !== undefined) state.reject(error);
  else state.resolve();
}

async function readPoster(state: PosterRefresh): Promise<void> {
  const queryKey = sequenceKeys.detail(state.sequenceId);
  await state.client.cancelQueries({ queryKey, exact: true });
  if (blocked(state)) return;
  await state.client.invalidateQueries({
    queryKey,
    exact: true,
    refetchType: 'none',
  });
  if (blocked(state)) return;
  const read = { committed: false };
  const unsubscribe = state.client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (
      event.action.manual === true ||
      !sameKey(event.query.queryKey, queryKey)
    )
      return;
    read.committed = true;
  });
  state.dirty = false;
  state.fetching = true;
  try {
    await state.client.fetchQuery({
      queryKey,
      queryFn: () => getSequenceFn({ data: { sequenceId: state.sequenceId } }),
      staleTime: 0,
    });
    if (!read.committed) state.dirty = true;
  } finally {
    unsubscribe();
    state.fetching = false;
  }
}

async function drainRefresh(state: PosterRefresh): Promise<void> {
  while (state.dirty && !blocked(state)) {
    await readPoster(state);
  }
}

function settleRefresh(state: PosterRefresh, error?: unknown): void {
  state.running = false;
  if (state.closed) return;
  if (error !== undefined && !isCancelledError(error)) {
    state.error ??= error;
  }
  if (isCancelledError(error)) state.dirty = true;
  if (!state.dirty) closeRefresh(state, state.error);
  else startRefresh(state);
}

function startRefresh(state: PosterRefresh): void {
  if (state.running || blocked(state)) return;
  state.running = true;
  void drainRefresh(state).then(
    () => settleRefresh(state),
    (error: unknown) => settleRefresh(state, error)
  );
}

function watchLaunch(state: PosterRefresh): () => void {
  const launchKey = generationLaunchKey(state.sequenceId);
  const detailKey = sequenceKeys.detail(state.sequenceId);
  return state.client.getQueryCache().subscribe((event) => {
    const launch = sameKey(event.query.queryKey, launchKey);
    if (
      event.type === 'removed' &&
      (launch || sameKey(event.query.queryKey, detailKey))
    ) {
      closeRefresh(state);
      return;
    }
    if (!launch || event.type !== 'updated') return;
    if (pending(state)) {
      state.dirty = true;
      if (state.fetching) {
        void state.client
          .cancelQueries({ queryKey: detailKey, exact: true })
          .catch((error: unknown) => closeRefresh(state, error));
      }
      return;
    }
    startRefresh(state);
  });
}

function createRefresh(
  client: QueryClient,
  sequenceId: string,
  entries: Map<string, PosterRefresh>
): PosterRefresh {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {
    client,
    sequenceId,
    entries,
    promise,
    resolve,
    reject,
    unsubscribe: () => {},
    dirty: true,
    running: false,
    fetching: false,
    closed: false,
  };
}

export function refreshGenerationPoster(
  queryClient: QueryClient,
  sequenceId: string
): Promise<void> {
  const entries =
    refreshes.get(queryClient) ?? new Map<string, PosterRefresh>();
  refreshes.set(queryClient, entries);
  const existing = entries.get(sequenceId);
  if (existing) {
    existing.dirty = true;
    return existing.promise;
  }
  const state = createRefresh(queryClient, sequenceId, entries);
  entries.set(sequenceId, state);
  state.unsubscribe = watchLaunch(state);
  queryClient.getQueryCache().build(queryClient, {
    queryKey: sequenceKeys.detail(sequenceId),
  });
  startRefresh(state);
  return state.promise;
}
