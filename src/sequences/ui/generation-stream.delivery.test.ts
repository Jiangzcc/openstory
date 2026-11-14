import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sequenceKeys } from './use-sequences';
import {
  beginGenerationLaunch,
  finishGenerationLaunch,
} from './generation-stream.launch';
import {
  deliverGenerationCacheEvent,
  generationContextFromCache,
} from './generation-stream.delivery';

const clients: QueryClient[] = [];
function setup(workflowRunId: string | null = 'run-B') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  // Synthetic query fixture: this seam reads only the workflow pointer.
  client.setQueryData(sequenceKeys.detail('sequence'), { workflowRunId });
  return { client, invalidate: vi.spyOn(client, 'invalidateQueries') };
}
const signal = (workflowRunId: string, name = 'generation.failed') => ({
  event: name,
  data: {
    message: 'failure',
    sequenceId: 'sequence',
    workflowOwner: { workflowRunId },
  },
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('generation cache delivery ownership', () => {
  it('uses the latest pointer from QueryClient, without waiting for a render', () => {
    const { client } = setup('run-A');
    client.setQueryData(sequenceKeys.detail('sequence'), {
      workflowRunId: 'run-B',
    });
    expect(generationContextFromCache(client, 'sequence').workflowRunId).toBe(
      'run-B'
    );
  });
  it('reconciles a mismatched terminal through detail only', () => {
    const { client, invalidate } = setup();
    deliverGenerationCacheEvent(client, 'sequence', signal('run-A'));
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(
      { queryKey: sequenceKeys.detail('sequence') },
      { cancelRefetch: false }
    );
  });
  it('discovers a new owner started by another tab from its phase event', () => {
    const { client, invalidate } = setup('run-A');
    deliverGenerationCacheEvent(
      client,
      'sequence',
      signal('run-B', 'generation.phase:start')
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it('retains the existing run-end invalidations for a matching root', () => {
    const { client, invalidate } = setup();
    deliverGenerationCacheEvent(client, 'sequence', signal('run-B'));
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: sequenceKeys.detail('sequence'),
    });
  });
  it('retains independent batch cache refreshes without adopting its lifecycle', () => {
    const { client, invalidate } = setup();
    deliverGenerationCacheEvent(client, 'sequence', {
      event: 'generation.failed',
      data: { message: 'independent batch failure' },
    });
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
  });
  it('blocks root cache side effects for both subscriptions during a local launch', () => {
    const { client, invalidate } = setup('run-A');
    beginGenerationLaunch(client, 'sequence', 'run-A');
    deliverGenerationCacheEvent(client, 'sequence', signal('run-A'));
    deliverGenerationCacheEvent(client, 'sequence', signal('run-B'));
    expect(invalidate).not.toHaveBeenCalled();
    expect(
      generationContextFromCache(client, 'sequence').launchToken
    ).not.toBeNull();
  });
  it('preserves independent batch refreshes during the same pending window', () => {
    const { client, invalidate } = setup();
    beginGenerationLaunch(client, 'sequence', 'run-B');
    deliverGenerationCacheEvent(client, 'sequence', {
      event: 'generation.failed',
      data: { message: 'independent batch failure' },
    });
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
  });
  it('keeps ordinary data refreshes during a pending launch', () => {
    const { client, invalidate } = setup();
    beginGenerationLaunch(client, 'sequence', 'run-B');
    deliverGenerationCacheEvent(client, 'sequence', {
      event: 'generation.updated',
      data: {},
    });
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
  });
  it('resumes verified B only after the request token is finished', () => {
    const { client, invalidate } = setup('run-A');
    const token = beginGenerationLaunch(client, 'sequence', 'run-A');
    client.setQueryData(sequenceKeys.detail('sequence'), {
      workflowRunId: 'run-B',
    });
    finishGenerationLaunch(client, 'sequence', token);
    deliverGenerationCacheEvent(client, 'sequence', signal('run-B'));
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
    expect(
      generationContextFromCache(client, 'sequence').launchToken
    ).toBeNull();
  });
  it('does not suppress a different sequence while this one is pending', () => {
    const { client, invalidate } = setup();
    beginGenerationLaunch(client, 'other-sequence', 'run-A');
    deliverGenerationCacheEvent(client, 'sequence', signal('run-B'));
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
  });
});
