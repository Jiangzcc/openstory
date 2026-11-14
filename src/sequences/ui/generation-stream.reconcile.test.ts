import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readSequence } = vi.hoisted(() => ({ readSequence: vi.fn() }));
vi.mock('@/sequences/sequences.fn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sequences/sequences.fn')>()),
  getSequenceFn: readSequence,
}));

import { sequenceKeys } from './use-sequences';
import {
  beginGenerationLaunch,
  getGenerationLaunch,
} from './generation-stream.launch';
import { reconcileGenerationLaunch } from './generation-stream.reconcile';

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  // Synthetic query fixture; no server, provider or database is contacted.
  client.setQueryData(sequenceKeys.detail('sequence'), {
    workflowRunId: 'run-A',
  });
  const token = beginGenerationLaunch(client, 'sequence', 'run-A');
  return { client, token };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  readSequence.mockReset();
});

describe('generation launch confirms an actual owner read', () => {
  it('fetches and confirms with zero active observers', async () => {
    const { client, token } = setup();
    readSequence.mockResolvedValue({ workflowRunId: 'run-B' });
    expect(await reconcileGenerationLaunch(client, 'sequence', token)).toBe(
      true
    );
    expect(readSequence).toHaveBeenCalledWith({
      data: { sequenceId: 'sequence' },
    });
    expect(client.getQueryData(sequenceKeys.detail('sequence'))).toEqual({
      workflowRunId: 'run-B',
    });
    expect(getGenerationLaunch(client, 'sequence').pending).toBe(false);
  });
  it('keeps pending when the confirming read rejects', async () => {
    const { client, token } = setup();
    readSequence.mockRejectedValue(new Error('offline'));
    expect(await reconcileGenerationLaunch(client, 'sequence', token)).toBe(
      false
    );
    expect(getGenerationLaunch(client, 'sequence').pending).toBe(true);
    expect(client.getQueryData(sequenceKeys.detail('sequence'))).toEqual({
      workflowRunId: 'run-A',
    });
  });
  it('recovers from a later real query success after a read failure', async () => {
    const { client, token } = setup();
    readSequence.mockRejectedValue(new Error('offline'));
    await reconcileGenerationLaunch(client, 'sequence', token);
    await client.fetchQuery({
      queryKey: sequenceKeys.detail('sequence'),
      queryFn: async () => ({ workflowRunId: 'run-C' }),
      staleTime: 0,
    });
    expect(getGenerationLaunch(client, 'sequence').pending).toBe(false);
    expect(client.getQueryData(sequenceKeys.detail('sequence'))).toEqual({
      workflowRunId: 'run-C',
    });
  });
  it('does not mistake an optimistic cache write for a successful read', async () => {
    const { client, token } = setup();
    readSequence.mockRejectedValue(new Error('offline'));
    await reconcileGenerationLaunch(client, 'sequence', token);
    client.setQueryData(sequenceKeys.detail('sequence'), {
      workflowRunId: 'run-C',
    });
    expect(getGenerationLaunch(client, 'sequence').pending).toBe(true);
  });
  it('accepts the actually read owner C when the created instance did not keep its slot', async () => {
    const { client, token } = setup();
    readSequence.mockResolvedValue({ workflowRunId: 'run-C' });
    await reconcileGenerationLaunch(client, 'sequence', token);
    expect(client.getQueryData(sequenceKeys.detail('sequence'))).toEqual({
      workflowRunId: 'run-C',
    });
    expect(getGenerationLaunch(client, 'sequence').pending).toBe(false);
  });
  it('does not close a newer launch when an older confirmation finishes', async () => {
    const { client, token } = setup();
    const pendingRead = deferred<{ workflowRunId: string }>();
    const readStarted = deferred<void>();
    readSequence.mockImplementation(() => {
      readStarted.resolve();
      return pendingRead.promise;
    });
    const result = reconcileGenerationLaunch(client, 'sequence', token);
    await readStarted.promise;
    const newToken = beginGenerationLaunch(client, 'sequence', 'run-A');
    pendingRead.resolve({ workflowRunId: 'run-B' });
    expect(await result).toBe(false);
    expect(getGenerationLaunch(client, 'sequence')).toMatchObject({
      token: newToken,
      pending: true,
    });
  });
  it('cancels a pre-confirmation read rather than adopting its older snapshot', async () => {
    const { client, token } = setup();
    const oldRead = deferred<{ workflowRunId: string }>();
    const oldResult = client.fetchQuery({
      queryKey: sequenceKeys.detail('sequence'),
      queryFn: () => oldRead.promise,
    });
    void oldResult.catch(() => undefined);
    readSequence.mockResolvedValue({ workflowRunId: 'run-B' });
    await reconcileGenerationLaunch(client, 'sequence', token);
    oldRead.resolve({ workflowRunId: 'run-A' });
    await oldResult;
    expect(readSequence).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(sequenceKeys.detail('sequence'))).toEqual({
      workflowRunId: 'run-B',
    });
  });
  it('does not reconcile an already superseded request', async () => {
    const { client, token } = setup();
    beginGenerationLaunch(client, 'sequence', 'run-A');
    expect(await reconcileGenerationLaunch(client, 'sequence', token)).toBe(
      false
    );
    expect(readSequence).not.toHaveBeenCalled();
  });
  it('confirms via the existing observer when its later refetch succeeds', async () => {
    const { client, token } = setup();
    readSequence.mockRejectedValue(new Error('offline'));
    await reconcileGenerationLaunch(client, 'sequence', token);
    const observer = new QueryObserver(client, {
      queryKey: sequenceKeys.detail('sequence'),
      queryFn: async () => ({ workflowRunId: 'run-B' }),
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    expect(getGenerationLaunch(client, 'sequence').pending).toBe(false);
    unsubscribe();
  });
});

describe('generation owner cancellation barrier', () => {
  it('does not confirm a resolved retryer whose old cache success is still queued', async () => {
    const { client, token } = setup();
    const oldRead = deferred<{ workflowRunId: string }>();
    const oldResult = client.fetchQuery({
      queryKey: sequenceKeys.detail('sequence'),
      queryFn: () => oldRead.promise,
      staleTime: 0,
    });
    oldRead.resolve({ workflowRunId: 'run-A' });
    await Promise.resolve();
    readSequence.mockResolvedValue({ workflowRunId: 'run-B' });
    const confirmed = await reconcileGenerationLaunch(
      client,
      'sequence',
      token
    );
    await oldResult;
    expect(readSequence).toHaveBeenCalledTimes(1);
    expect(confirmed).toBe(true);
    expect(client.getQueryData(sequenceKeys.detail('sequence'))).toEqual({
      workflowRunId: 'run-B',
    });
  });
});
