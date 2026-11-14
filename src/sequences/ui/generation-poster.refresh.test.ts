import { QueryCache, QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { Sequence } from '@/platform/server/db/schema';

const { readSequence } = vi.hoisted(() => ({ readSequence: vi.fn() }));
vi.mock('@/sequences/sequences.fn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sequences/sequences.fn')>()),
  getSequenceFn: readSequence,
}));

import { refreshGenerationPoster } from './generation-poster.refresh';
import {
  beginGenerationLaunch,
  finishGenerationLaunch,
  generationLaunchKey,
  getGenerationLaunch,
} from './generation-stream.launch';
import { sequenceKeys } from './use-sequences';

const SEQUENCE = 'synthetic-sequence';
const OTHER_SEQUENCE = 'synthetic-other-sequence';
const RUN_A = 'synthetic-run-A';
const RUN_B = 'synthetic-run-B';
type PosterSequence = Pick<
  Sequence,
  'id' | 'workflowRunId' | 'posterUrl' | 'status'
>;
const clients: QueryClient[] = [];

// Synthetic detail snapshots; all server-function reads are explicitly mocked.
function snapshot(workflowRunId: string | null = RUN_B): PosterSequence {
  return {
    id: SEQUENCE,
    workflowRunId,
    posterUrl: `/r2/${workflowRunId ?? 'no-owner'}.png`,
    status: 'completed',
  };
}

function setup(data?: PosterSequence) {
  const onError = vi.fn();
  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  if (data) client.setQueryData(sequenceKeys.detail(SEQUENCE), data);
  return { client, onError };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function nextRead() {
  const started = deferred<void>();
  const result = deferred<PosterSequence>();
  readSequence.mockImplementationOnce(() => {
    started.resolve();
    return result.promise;
  });
  return { ...result, started: started.promise };
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  readSequence.mockReset();
  vi.restoreAllMocks();
});

it('fetches authoritative cold detail with zero observers', async () => {
  const { client } = setup();
  readSequence.mockResolvedValue(snapshot());
  await refreshGenerationPoster(client, SEQUENCE);
  expect(readSequence).toHaveBeenCalledExactlyOnceWith({
    data: { sequenceId: SEQUENCE },
  });
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
  expect(
    client
      .getQueryCache()
      .find({ queryKey: sequenceKeys.detail(SEQUENCE) })
      ?.getObserversCount()
  ).toBe(0);
});

it('refreshes warm detail even if it was configured permanently fresh', async () => {
  const { client } = setup(snapshot(RUN_A));
  client.setQueryDefaults(sequenceKeys.detail(SEQUENCE), {
    staleTime: Infinity,
  });
  readSequence.mockResolvedValue(snapshot());
  await refreshGenerationPoster(client, SEQUENCE);
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
  expect(readSequence).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  'cancels an older detail read with cached data=%s',
  async (warm) => {
    const { client } = setup(warm ? snapshot(RUN_A) : undefined);
    const oldRead = deferred<PosterSequence>();
    const oldResult = client
      .fetchQuery({
        queryKey: sequenceKeys.detail(SEQUENCE),
        queryFn: () => oldRead.promise,
      })
      .catch(() => undefined);
    readSequence.mockResolvedValue(snapshot());
    await refreshGenerationPoster(client, SEQUENCE);
    oldRead.resolve(snapshot(RUN_A));
    await oldResult;
    expect(readSequence).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
      snapshot()
    );
  }
);

it('crosses the cancellation barrier after an old retryer resolved before its cache success', async () => {
  const { client } = setup(snapshot(RUN_A));
  const oldRead = deferred<PosterSequence>();
  const oldResult = client.fetchQuery({
    queryKey: sequenceKeys.detail(SEQUENCE),
    queryFn: () => oldRead.promise,
  });
  oldRead.resolve(snapshot(RUN_A));
  await Promise.resolve();
  readSequence.mockResolvedValue(snapshot());
  await refreshGenerationPoster(client, SEQUENCE);
  await oldResult;
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('preserves B while both an obsolete A read and the authoritative refresh are pending', async () => {
  const { client } = setup(snapshot());
  const obsolete = deferred<PosterSequence>();
  const obsoleteResult = client
    .fetchQuery({
      queryKey: sequenceKeys.detail(SEQUENCE),
      queryFn: () => obsolete.promise,
    })
    .catch(() => undefined);
  const fresh = nextRead();
  const result = refreshGenerationPoster(client, SEQUENCE);
  await fresh.started;
  obsolete.resolve(snapshot(RUN_A));
  await obsoleteResult;
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
  fresh.resolve(snapshot());
  await result;
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('coalesces synchronous subscriber signals into one actual read', async () => {
  const { client } = setup();
  const read = nextRead();
  const first = refreshGenerationPoster(client, SEQUENCE);
  const second = refreshGenerationPoster(client, SEQUENCE);
  expect(second).toBe(first);
  await read.started;
  read.resolve(snapshot());
  await first;
  expect(readSequence).toHaveBeenCalledTimes(1);
});

it('starts a trailing read for signals received after the first read began', async () => {
  const { client } = setup(snapshot(RUN_A));
  const firstRead = nextRead();
  const trailingRead = nextRead();
  const result = refreshGenerationPoster(client, SEQUENCE);
  await firstRead.started;
  expect(refreshGenerationPoster(client, SEQUENCE)).toBe(result);
  expect(refreshGenerationPoster(client, SEQUENCE)).toBe(result);
  firstRead.resolve(snapshot(RUN_A));
  await trailingRead.started;
  trailingRead.resolve(snapshot());
  await result;
  expect(readSequence).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('refreshes an unrelated confirmed owner returned by the server', async () => {
  const { client } = setup(snapshot(RUN_A));
  const authoritative = snapshot('synthetic-run-C');
  readSequence.mockResolvedValue(authoritative);
  await refreshGenerationPoster(client, SEQUENCE);
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    authoritative
  );
  expect(getGenerationLaunch(client, SEQUENCE).pending).toBe(false);
});

it.each(['completed', 'failed'] as const)(
  'keeps a terminal %s run terminal',
  async (status) => {
    const terminal = { ...snapshot(), status };
    const { client } = setup(terminal);
    readSequence.mockResolvedValue(terminal);
    await refreshGenerationPoster(client, SEQUENCE);
    expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
      terminal
    );
  }
);

it('refreshes detail with a null owner without manufacturing ownership', async () => {
  const { client } = setup(snapshot(null));
  readSequence.mockResolvedValue(snapshot(null));
  await refreshGenerationPoster(client, SEQUENCE);
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot(null)
  );
});

it('defers through pending launch and manual cache writes until registry completion', async () => {
  const { client } = setup(snapshot(RUN_A));
  const token = beginGenerationLaunch(client, SEQUENCE, RUN_A);
  readSequence.mockResolvedValue(snapshot());
  const result = refreshGenerationPoster(client, SEQUENCE);
  client.setQueryData(sequenceKeys.detail(SEQUENCE), snapshot());
  await Promise.resolve();
  expect(readSequence).not.toHaveBeenCalled();
  expect(getGenerationLaunch(client, SEQUENCE)).toMatchObject({
    token,
    pending: true,
  });
  finishGenerationLaunch(client, SEQUENCE, token);
  await result;
  expect(readSequence).toHaveBeenCalledTimes(1);
});

it('waits for the current pending token when a former launch finishes late', async () => {
  const { client } = setup(snapshot(RUN_A));
  const former = beginGenerationLaunch(client, SEQUENCE, RUN_A);
  const result = refreshGenerationPoster(client, SEQUENCE);
  const current = beginGenerationLaunch(client, SEQUENCE, RUN_A);
  readSequence.mockResolvedValue(snapshot());
  expect(finishGenerationLaunch(client, SEQUENCE, former)).toBe(false);
  expect(readSequence).not.toHaveBeenCalled();
  finishGenerationLaunch(client, SEQUENCE, current);
  await result;
  expect(getGenerationLaunch(client, SEQUENCE).token).toBe(current);
  expect(readSequence).toHaveBeenCalledTimes(1);
});

it('rechecks pending launch after awaiting cancellation', async () => {
  const { client } = setup(snapshot(RUN_A));
  const cancelled = deferred<void>();
  const release = deferred<void>();
  const cancelQueries = client.cancelQueries.bind(client);
  vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async (filters) => {
    await cancelQueries(filters);
    cancelled.resolve();
    await release.promise;
  });
  const result = refreshGenerationPoster(client, SEQUENCE);
  await cancelled.promise;
  const token = beginGenerationLaunch(client, SEQUENCE, RUN_A);
  release.resolve();
  await Promise.resolve();
  expect(readSequence).not.toHaveBeenCalled();
  readSequence.mockResolvedValue(snapshot());
  finishGenerationLaunch(client, SEQUENCE, token);
  await result;
  expect(readSequence).toHaveBeenCalledTimes(1);
});

it('cancels a poster read when a launch begins and resumes only after it finishes', async () => {
  const { client } = setup(snapshot(RUN_A));
  const oldRead = nextRead();
  const result = refreshGenerationPoster(client, SEQUENCE);
  await oldRead.started;
  const token = beginGenerationLaunch(client, SEQUENCE, RUN_A);
  await client.cancelQueries({
    queryKey: sequenceKeys.detail(SEQUENCE),
    exact: true,
  });
  expect(readSequence).toHaveBeenCalledTimes(1);
  expect(getGenerationLaunch(client, SEQUENCE).pending).toBe(true);
  readSequence.mockResolvedValue(snapshot());
  finishGenerationLaunch(client, SEQUENCE, token);
  await result;
  oldRead.resolve(snapshot(RUN_A));
  await oldRead.promise;
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('retains a warm refresh through pre-launch cancellation and a refused launch', async () => {
  const { client } = setup(snapshot(RUN_A));
  const cancelledRead = nextRead();
  const result = refreshGenerationPoster(client, SEQUENCE);
  await cancelledRead.started;
  readSequence.mockResolvedValue(snapshot());
  await client.cancelQueries({
    queryKey: sequenceKeys.detail(SEQUENCE),
    exact: true,
  });
  const token = beginGenerationLaunch(client, SEQUENCE, RUN_A);
  finishGenerationLaunch(client, SEQUENCE, token);
  await result;
  cancelledRead.resolve(snapshot(RUN_A));
  await cancelledRead.promise;
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
  expect(getGenerationLaunch(client, SEQUENCE).pending).toBe(false);
  expect(readSequence.mock.calls.length).toBeGreaterThan(1);
});

it('does not create detail after an entirely cold refresh is immediately cleared', async () => {
  const { client } = setup();
  readSequence.mockResolvedValue(snapshot());
  const result = refreshGenerationPoster(client, SEQUENCE);
  client.clear();
  await result;
  expect(readSequence).not.toHaveBeenCalled();
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toBeUndefined();
});

it('surfaces a failed read through QueryCache onError and rejects to its caller', async () => {
  const previous = snapshot(RUN_A);
  const { client, onError } = setup(previous);
  const error = new Error('synthetic detail read failure');
  readSequence.mockRejectedValueOnce(error);
  await expect(refreshGenerationPoster(client, SEQUENCE)).rejects.toBe(error);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error, expect.anything());
  expect(client.getQueryState(sequenceKeys.detail(SEQUENCE))?.error).toBe(
    error
  );
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(previous);
  readSequence.mockResolvedValue(snapshot());
  await refreshGenerationPoster(client, SEQUENCE);
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('retains a trailing signal even when the read in progress fails', async () => {
  const { client, onError } = setup(snapshot(RUN_A));
  const firstRead = nextRead();
  const trailingRead = nextRead();
  const error = new Error('synthetic interrupted read');
  const result = refreshGenerationPoster(client, SEQUENCE);
  const rejected = expect(result).rejects.toBe(error);
  await firstRead.started;
  refreshGenerationPoster(client, SEQUENCE);
  firstRead.reject(error);
  await trailingRead.started;
  trailingRead.resolve(snapshot());
  await rejected;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('cleans a deferred subscription when its pending registry is removed', async () => {
  const { client } = setup(snapshot(RUN_A));
  beginGenerationLaunch(client, SEQUENCE, RUN_A);
  const result = refreshGenerationPoster(client, SEQUENCE);
  client.removeQueries({
    queryKey: generationLaunchKey(SEQUENCE),
    exact: true,
  });
  await result;
  expect(readSequence).not.toHaveBeenCalled();
  readSequence.mockResolvedValue(snapshot());
  await refreshGenerationPoster(client, SEQUENCE);
  expect(readSequence).toHaveBeenCalledTimes(1);
});

it('does not resurrect removed detail after a delayed read completes', async () => {
  const { client } = setup();
  const read = nextRead();
  const result = refreshGenerationPoster(client, SEQUENCE);
  await read.started;
  client.removeQueries({
    queryKey: sequenceKeys.detail(SEQUENCE),
    exact: true,
  });
  await result;
  read.resolve(snapshot());
  await read.promise;
  expect(client.getQueryData(sequenceKeys.detail(SEQUENCE))).toBeUndefined();
});

it('isolates identical sequence refreshes between QueryClients', async () => {
  const first = setup().client;
  const second = setup().client;
  const readA = nextRead();
  const readB = nextRead();
  const resultA = refreshGenerationPoster(first, SEQUENCE);
  await readA.started;
  const resultB = refreshGenerationPoster(second, SEQUENCE);
  await readB.started;
  readB.resolve(snapshot());
  await resultB;
  readA.resolve(snapshot(RUN_A));
  await resultA;
  expect(first.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot(RUN_A)
  );
  expect(second.getQueryData(sequenceKeys.detail(SEQUENCE))).toEqual(
    snapshot()
  );
});

it('keeps pending launches and detail refreshes isolated by exact sequence key', async () => {
  const { client } = setup(snapshot(RUN_A));
  beginGenerationLaunch(client, SEQUENCE, RUN_A);
  const sliceKey = [...sequenceKeys.detail(OTHER_SEQUENCE), 'generation-slice'];
  const slice = deferred<string>();
  const sliceResult = client.fetchQuery({
    queryKey: sliceKey,
    queryFn: () => slice.promise,
  });
  readSequence.mockResolvedValue({ ...snapshot(), id: OTHER_SEQUENCE });
  await refreshGenerationPoster(client, OTHER_SEQUENCE);
  slice.resolve('unchanged-slice');
  await expect(sliceResult).resolves.toBe('unchanged-slice');
  expect(getGenerationLaunch(client, SEQUENCE).pending).toBe(true);
  expect(readSequence).toHaveBeenCalledExactlyOnceWith({
    data: { sequenceId: OTHER_SEQUENCE },
  });
});
