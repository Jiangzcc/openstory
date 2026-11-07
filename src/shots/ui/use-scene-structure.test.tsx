import { renderToStaticMarkup } from 'react-dom/server';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateId } from '@/platform/id';
import { dbSceneId } from '@/shots/scene-id';
import { makeQueryClient } from '@/ui/query-client';
import type { SceneWithScript } from './use-scenes';

const deleteShotFn = vi.fn();
const updateSceneFn = vi.fn();
vi.doMock('@/shots/shots.fn', () => ({ deleteShotFn }));
vi.doMock('@/shots/scenes.fn', () => ({ updateSceneFn }));
const { useSoftDeleteShot, useUpdateScene } =
  await import('./use-scene-structure');
const { shotKeys } = await import('./use-shots');
const { sceneKeys } = await import('./use-scenes');

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  let mutation: ReturnType<typeof useSoftDeleteShot> | undefined;
  function Probe() {
    // oxlint-disable-next-line react/globals -- hands mutateAsync from a one-shot SSR probe to the test; never used for rendering.
    mutation = useSoftDeleteShot('sequence-a');
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  if (!mutation) throw new Error('hook did not run');
  const key = shotKeys.list('sequence-a');
  client.setQueryData(key, [{ id: 'deleted' }, { id: 'kept' }]);
  client.setQueryData(shotKeys.list('sequence-b'), [{ id: 'deleted' }]);
  return { client, key, mutation };
}

const deleted = {
  success: true,
  sequenceId: 'sequence-a',
  deletedAt: new Date(),
};

describe('useSoftDeleteShot list cache', () => {
  it('removes only the deleted shot from its own sequence once the delete succeeds', async () => {
    deleteShotFn.mockResolvedValue(deleted);
    const { client, key, mutation } = setup();
    await mutation.mutateAsync({ shotId: 'deleted' });
    expect(client.getQueryData(key)).toEqual([{ id: 'kept' }]);
    expect(client.getQueryData(shotKeys.list('sequence-b'))).toEqual([
      { id: 'deleted' },
    ]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('keeps the list when the delete fails', async () => {
    deleteShotFn.mockRejectedValue(new Error('delete failed'));
    const { client, key, mutation } = setup();
    await expect(mutation.mutateAsync({ shotId: 'deleted' })).rejects.toThrow(
      'delete failed'
    );
    expect(client.getQueryData(key)).toEqual([
      { id: 'deleted' },
      { id: 'kept' },
    ]);
  });

  it('does not let a fetch started before the delete restore the shot', async () => {
    deleteShotFn.mockResolvedValue(deleted);
    const { client, key, mutation } = setup();
    let finish: ((rows: { id: string }[]) => void) | undefined;
    const staleFetch = client
      .fetchQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<{ id: string }[]>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => undefined);
    await mutation.mutateAsync({ shotId: 'deleted' });
    if (!finish) throw new Error('fetch did not start');
    finish([{ id: 'deleted' }, { id: 'kept' }]);
    await staleFetch;
    expect(client.getQueryData(key)).toEqual([{ id: 'kept' }]);
  });
});

const sequenceId = generateId();
const otherSequenceId = generateId();

function sceneFixture(title: string): SceneWithScript {
  return {
    id: dbSceneId(generateId()),
    sequenceId,
    orderIndex: 0,
    selectedScriptVersionId: generateId(),
    deletedAt: null,
    createdAt: new Date('2026-11-07T00:00:00Z'),
    updatedAt: new Date('2026-11-07T00:00:00Z'),
    title,
    location: null,
    timeOfDay: null,
    storyBeat: null,
    continuity: null,
    script: { extract: 'INT. STATION - NIGHT', dialogue: [] },
  };
}

function setupSceneUpdate(rows: SceneWithScript[] | undefined) {
  const client = makeQueryClient();
  clients.push(client);
  let mutation: ReturnType<typeof useUpdateScene> | undefined;
  function Probe() {
    // oxlint-disable-next-line react/globals -- captures a hook handle without rendering a component under test.
    mutation = useUpdateScene(sequenceId);
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  if (!mutation) throw new Error('hook did not run');
  const key = sceneKeys.list(sequenceId);
  if (rows) client.setQueryData(key, rows);
  return { client, key, mutation };
}

describe('useUpdateScene list cache', () => {
  it('shows the confirmed narrative while refetches are pending and preserves its script', async () => {
    const original = sceneFixture('Original');
    const untouched = sceneFixture('Other scene');
    const updated = {
      ...original,
      title: 'Opening',
      selectedScriptVersionId: generateId(),
    };
    updateSceneFn.mockResolvedValue(updated);
    const { client, key, mutation } = setupSceneUpdate([original, untouched]);
    const otherKey = sceneKeys.list(otherSequenceId);
    client.setQueryData(otherKey, [original]);
    const pendingReads: Array<(rows: SceneWithScript[]) => void> = [];
    const refetch = vi.fn(
      () =>
        new Promise<SceneWithScript[]>((resolve) => pendingReads.push(resolve))
    );
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: refetch,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await mutation.mutateAsync({ sceneId: original.id, title: 'Opening' });

      expect(refetch).toHaveBeenCalled();
      expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
      expect(client.getQueryData(key)).toEqual([updated, untouched]);
      expect(client.getQueryData(otherKey)).toEqual([original]);
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    } finally {
      unsubscribe();
      pendingReads.forEach((resolve) => resolve([original, untouched]));
    }
  });

  it('keeps a confirmed script together with its version when the cached script is older', async () => {
    const original = sceneFixture('Original');
    const updated = {
      ...original,
      title: 'Opening',
      selectedScriptVersionId: generateId(),
      script: { extract: 'INT. UPDATED STATION - DAY', dialogue: [] },
    };
    updateSceneFn.mockResolvedValue(updated);
    const { client, key, mutation } = setupSceneUpdate([original]);

    await mutation.mutateAsync({ sceneId: original.id, title: 'Opening' });

    expect(client.getQueryData(key)).toEqual([updated]);
  });

  it('keeps the original scene when saving fails', async () => {
    const original = sceneFixture('Original');
    updateSceneFn.mockRejectedValue(new Error('save failed'));
    const { client, key, mutation } = setupSceneUpdate([original]);

    await expect(
      mutation.mutateAsync({ sceneId: original.id, title: 'Opening' })
    ).rejects.toThrow('save failed');

    expect(client.getQueryData(key)).toEqual([original]);
  });

  it('does not create an incomplete list when the scene list is uncached', async () => {
    const updated = sceneFixture('Opening');
    updateSceneFn.mockResolvedValue(updated);
    const { client, key, mutation } = setupSceneUpdate(undefined);

    await mutation.mutateAsync({ sceneId: updated.id, title: 'Opening' });

    expect(client.getQueryData(key)).toBeUndefined();
  });
});
