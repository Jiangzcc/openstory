import { QueryClient, QueryObserver, skipToken } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION_LAUNCH,
  beginGenerationLaunch,
  canRestoreGenerationLaunch,
  finishGenerationLaunch,
  generationLaunchKey,
  getGenerationLaunch,
} from './generation-stream.launch';
import type { GenerationLaunchState } from './generation-stream.launch';

const SEQUENCE_ID = 'sequence-a';
const OTHER_SEQUENCE_ID = 'sequence-b';
const PREVIOUS_RUN_ID = 'run-a';
const NEXT_RUN_ID = 'run-b';
const OTHER_RUN_ID = 'run-c';
const queryClients: QueryClient[] = [];
const subscriptions: (() => void)[] = [];
let queryClient: QueryClient;

function createQueryClient(gcTime = Infinity): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime, staleTime: Infinity, retry: false } },
  });
  queryClients.push(client);
  return client;
}

function observeLaunch(client: QueryClient, sequenceId: string) {
  const states: GenerationLaunchState[] = [];
  const observer = new QueryObserver<GenerationLaunchState>(client, {
    queryKey: generationLaunchKey(sequenceId),
    queryFn: skipToken,
    initialData: DEFAULT_GENERATION_LAUNCH,
  });
  subscriptions.push(
    observer.subscribe(({ data }) => {
      if (data) states.push(data);
    })
  );
  return { observer, states };
}

beforeEach(() => {
  queryClient = createQueryClient();
});

afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const client of queryClients.splice(0)) client.clear();
});

describe('generation launch state', () => {
  it('reads the idle default without creating a query or accepting token zero', () => {
    expect(getGenerationLaunch(queryClient, SEQUENCE_ID)).toBe(
      DEFAULT_GENERATION_LAUNCH
    );
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, 0)).toBe(false);
    expect(canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, 0, null)).toBe(
      false
    );
    expect(queryClient.getQueryState(generationLaunchKey(SEQUENCE_ID))).toBe(
      undefined
    );
  });

  it('shares begin and finish synchronously between two disabled observers', () => {
    const first = observeLaunch(queryClient, SEQUENCE_ID);
    const second = observeLaunch(queryClient, SEQUENCE_ID);
    const token = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    const pending = { token, pending: true, previousRunId: PREVIOUS_RUN_ID };
    expect(first.observer.getCurrentResult().data).toEqual(pending);
    expect(second.observer.getCurrentResult().data).toEqual(pending);
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, token)).toBe(true);
    const finished = { ...pending, pending: false };
    expect(first.states).toEqual([pending, finished]);
    expect(second.states).toEqual([pending, finished]);
    expect(first.observer.getCurrentResult().fetchStatus).toBe('idle');
    expect(second.observer.getCurrentResult().fetchStatus).toBe('idle');
    expect(DEFAULT_GENERATION_LAUNCH).toEqual({
      token: 0,
      pending: false,
      previousRunId: null,
    });
  });

  it('ignores a superseded token for both finish and rollback', () => {
    const { states } = observeLaunch(queryClient, SEQUENCE_ID);
    const older = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    const current = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      NEXT_RUN_ID
    );
    const snapshot = getGenerationLaunch(queryClient, SEQUENCE_ID);
    const notificationCount = states.length;
    expect(current).toBeGreaterThan(older);
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, older)).toBe(false);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, older, null)
    ).toBe(false);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, older, NEXT_RUN_ID)
    ).toBe(false);
    expect(getGenerationLaunch(queryClient, SEQUENCE_ID)).toBe(snapshot);
    expect(states).toHaveLength(notificationCount);
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, current)).toBe(
      true
    );
  });

  it.each([PREVIOUS_RUN_ID, null])(
    'allows rollback of the current pending token while the slot is %s',
    (currentRunId) => {
      const token = beginGenerationLaunch(
        queryClient,
        SEQUENCE_ID,
        PREVIOUS_RUN_ID
      );
      const snapshot = getGenerationLaunch(queryClient, SEQUENCE_ID);
      expect(
        canRestoreGenerationLaunch(
          queryClient,
          SEQUENCE_ID,
          token,
          currentRunId
        )
      ).toBe(true);
      expect(getGenerationLaunch(queryClient, SEQUENCE_ID)).toBe(snapshot);
    }
  );

  it('refuses rollback after a different current run has been observed', () => {
    const token = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    const snapshot = getGenerationLaunch(queryClient, SEQUENCE_ID);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, token, OTHER_RUN_ID)
    ).toBe(false);
    expect(getGenerationLaunch(queryClient, SEQUENCE_ID)).toBe(snapshot);
  });

  it('only allows an empty slot when the launch had no previous run', () => {
    const token = beginGenerationLaunch(queryClient, SEQUENCE_ID, null);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, token, null)
    ).toBe(true);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, token, OTHER_RUN_ID)
    ).toBe(false);
  });

  it('finishes once and keeps the token while disabling subsequent rollback', () => {
    const token = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, token)).toBe(true);
    expect(getGenerationLaunch(queryClient, SEQUENCE_ID)).toEqual({
      token,
      pending: false,
      previousRunId: PREVIOUS_RUN_ID,
    });
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, token)).toBe(false);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, token, null)
    ).toBe(false);
    expect(
      canRestoreGenerationLaunch(
        queryClient,
        SEQUENCE_ID,
        token,
        PREVIOUS_RUN_ID
      )
    ).toBe(false);
  });

  it('never reuses a finished token for a later launch', () => {
    const first = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, first)).toBe(true);
    const next = beginGenerationLaunch(queryClient, SEQUENCE_ID, NEXT_RUN_ID);
    expect(next).toBeGreaterThan(first);
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, first)).toBe(false);
    expect(
      canRestoreGenerationLaunch(queryClient, SEQUENCE_ID, first, null)
    ).toBe(false);
    expect(getGenerationLaunch(queryClient, SEQUENCE_ID)).toEqual({
      token: next,
      pending: true,
      previousRunId: NEXT_RUN_ID,
    });
  });

  it('keeps launches and observer notifications isolated by sequence', () => {
    const first = observeLaunch(queryClient, SEQUENCE_ID);
    const second = observeLaunch(queryClient, OTHER_SEQUENCE_ID);
    const firstToken = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    expect(second.observer.getCurrentResult().data).toEqual(
      DEFAULT_GENERATION_LAUNCH
    );
    expect(second.states).toEqual([]);
    const secondToken = beginGenerationLaunch(
      queryClient,
      OTHER_SEQUENCE_ID,
      OTHER_RUN_ID
    );
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, firstToken)).toBe(
      true
    );
    expect(first.observer.getCurrentResult().data?.pending).toBe(false);
    expect(second.observer.getCurrentResult().data).toEqual({
      token: secondToken,
      pending: true,
      previousRunId: OTHER_RUN_ID,
    });
    expect(second.states).toHaveLength(1);
  });

  it('keeps the same sequence isolated between QueryClients', () => {
    const otherClient = createQueryClient();
    const token = beginGenerationLaunch(
      queryClient,
      SEQUENCE_ID,
      PREVIOUS_RUN_ID
    );
    expect(getGenerationLaunch(otherClient, SEQUENCE_ID)).toEqual(
      DEFAULT_GENERATION_LAUNCH
    );
    const otherToken = beginGenerationLaunch(
      otherClient,
      SEQUENCE_ID,
      OTHER_RUN_ID
    );
    expect(finishGenerationLaunch(queryClient, SEQUENCE_ID, token)).toBe(true);
    expect(getGenerationLaunch(otherClient, SEQUENCE_ID)).toEqual({
      token: otherToken,
      pending: true,
      previousRunId: OTHER_RUN_ID,
    });
  });

  it('retains the token when the last observer detaches before another mounts', () => {
    const client = createQueryClient(0);
    const first = observeLaunch(client, SEQUENCE_ID);
    const token = beginGenerationLaunch(client, SEQUENCE_ID, PREVIOUS_RUN_ID);
    expect(finishGenerationLaunch(client, SEQUENCE_ID, token)).toBe(true);
    first.observer.destroy();
    const query = client.getQueryCache().find({
      queryKey: generationLaunchKey(SEQUENCE_ID),
      exact: true,
    });
    expect(query?.gcTime).toBe(Infinity);
    const second = observeLaunch(client, SEQUENCE_ID);
    expect(second.observer.getCurrentResult().data?.token).toBe(token);
    const next = beginGenerationLaunch(client, SEQUENCE_ID, NEXT_RUN_ID);
    expect(next).toBeGreaterThan(token);
    expect(finishGenerationLaunch(client, SEQUENCE_ID, token)).toBe(false);
  });
});
