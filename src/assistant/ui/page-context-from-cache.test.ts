import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { organizationCharacterKeys } from '@/cast/ui/use-organization-characters';
import { sequenceCharacterKeys } from '@/cast/ui/use-sequence-characters';
import {
  organizationLocationKeys,
  sequenceLocationKeys,
} from '@/cast/ui/location-keys';
import { sequenceKeys } from '@/sequences/ui/use-sequences';
import { sceneKeys } from '@/shots/ui/use-scenes';
import { shotKeys } from '@/shots/ui/use-shots';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  createPageContextCacheStore,
  pageContextRouteFromMatches,
} from './page-context-from-cache';
import type { PageContextRoute } from './page-context-from-cache';

function contextStore(
  route: PageContextRoute,
  locale: 'zh-CN' | 'en' = 'zh-CN'
) {
  const queryClient = new QueryClient();
  const i18n = createApplicationI18n(locale);
  return {
    queryClient,
    store: createPageContextCacheStore(
      queryClient,
      route,
      i18n.getFixedT(locale, 'assistant')
    ),
  };
}

describe('assistant page context cache', () => {
  it.each([
    ['zh-CN', ['当前作品', '当前场景', '当前角色', '当前地点'], '当前镜头'],
    [
      'en',
      ['This sequence', 'This scene', 'This character', 'This location'],
      'This shot',
    ],
  ] as const)(
    'localizes only generated fallback labels in %s',
    (locale, expected, shot) => {
      const { store } = contextStore(
        {
          sequenceId: 'sequence',
          scenes: 'scene',
          characterId: 'character',
          locationId: 'location',
        },
        locale
      );
      expect(store.getSnapshot().map((item) => item.label)).toEqual(expected);
      expect(
        contextStore(
          { sequenceId: 'sequence', shot: 'shot' },
          locale
        ).store.getSnapshot()[1]?.label
      ).toBe(shot);
    }
  );

  it('notifies a subscriber as a location arrives and is renamed', () => {
    const { queryClient, store } = contextStore({ locationId: 'location' });
    expect(store.getSnapshot()).toEqual([
      { kind: 'location', id: 'location', label: '当前地点' },
    ]);
    const snapshots: string[] = [];
    const unsubscribe = store.subscribe(() =>
      snapshots.push(store.getSnapshot()[0]?.label ?? '')
    );
    queryClient.setQueryData(sequenceLocationKeys.detail(null, 'location'), {
      id: 'location',
      name: '落云宗',
    });
    queryClient.setQueryData(sequenceLocationKeys.detail(null, 'location'), {
      id: 'location',
      name: '山门',
    });
    expect(snapshots).toContain('落云宗');
    expect(snapshots.at(-1)).toBe('山门');
    unsubscribe();
    queryClient.setQueryData(sequenceLocationKeys.detail(null, 'location'), {
      id: 'location',
      name: '静室',
    });
    expect(snapshots.at(-1)).toBe('山门');
  });

  it('reads the sequence location list and keeps a stable snapshot for unrelated cache changes', () => {
    const { queryClient, store } = contextStore({
      sequenceId: 'sequence',
      castSequenceId: 'sequence',
      locationId: 'location',
    });
    queryClient.setQueryData(organizationLocationKeys.detail('location'), {
      id: 'location',
      name: 'Older name',
    });
    queryClient.setQueryData(sequenceLocationKeys.list('sequence'), [
      { id: 'location', name: '当前地点名' },
    ]);
    const snapshot = store.getSnapshot();
    expect(snapshot.at(-1)?.label).toBe('当前地点名');
    queryClient.setQueryData(['unrelated'], { value: 1 });
    expect(store.getSnapshot()).toBe(snapshot);
    queryClient.setQueryData(sequenceLocationKeys.list('sequence'), [
      { id: 'location', name: '新地点名' },
    ]);
    expect(store.getSnapshot()).not.toBe(snapshot);
    expect(store.getSnapshot().at(-1)?.label).toBe('新地点名');
  });

  it.each([null, 'sequence'] as const)(
    'reads the character detail shown with scope %s',
    (scope) => {
      const { queryClient, store } = contextStore({
        characterId: 'character',
        castSequenceId: scope ?? undefined,
      });
      queryClient.setQueryData(organizationCharacterKeys.detail('character'), {
        id: 'character',
        name: 'Older name',
      });
      queryClient.setQueryData(
        sequenceCharacterKeys.detail(scope, 'character'),
        { id: 'character', name: '韩立' }
      );
      expect(store.getSnapshot()).toEqual([
        { kind: 'character', id: 'character', label: '韩立' },
      ]);
    }
  );

  it('reads sequence characters before the detail is loaded', () => {
    const { queryClient, store } = contextStore({
      characterId: 'character',
      castSequenceId: 'sequence',
    });
    queryClient.setQueryData(sequenceCharacterKeys.list('sequence'), [
      { id: 'character', name: '南宫婉' },
    ]);
    expect(store.getSnapshot()[0]?.label).toBe('南宫婉');
  });

  it('follows the default character sequence instead of an old organization-scope detail', () => {
    const { queryClient, store } = contextStore({ characterId: 'character' });
    queryClient.setQueryData(sequenceCharacterKeys.detail(null, 'character'), {
      id: 'character',
      name: 'Before edit',
    });
    queryClient.setQueryData(organizationCharacterKeys.detail('character'), {
      id: 'character',
      name: 'After edit',
      sequences: [{ id: 'sequence' }],
    });
    queryClient.setQueryData(
      sequenceCharacterKeys.detail('sequence', 'character'),
      { id: 'character', name: 'After edit' }
    );
    expect(store.getSnapshot()[0]?.label).toBe('After edit');
  });

  it('keeps an organization location on its own scope when no sequence is picked', () => {
    const { queryClient, store } = contextStore({ locationId: 'location' });
    queryClient.setQueryData(organizationLocationKeys.detail('location'), {
      id: 'location',
      name: 'Organization name',
      sequences: [{ id: 'sequence' }],
    });
    queryClient.setQueryData(sequenceLocationKeys.detail(null, 'location'), {
      id: 'location',
      name: 'Current page name',
    });
    queryClient.setQueryData(sequenceLocationKeys.list('sequence'), [
      { id: 'location', name: 'Inactive sequence name' },
    ]);
    expect(store.getSnapshot()[0]?.label).toBe('Current page name');
  });

  it.each(['character', 'location'] as const)(
    'ignores an inactive %s scope when the selected sequence is not in its page',
    (kind) => {
      const { queryClient, store } = contextStore({
        characterId: kind === 'character' ? 'character' : undefined,
        locationId: kind === 'location' ? 'location' : undefined,
        castSequenceId: 'missing',
      });
      queryClient.setQueryData(
        kind === 'character'
          ? organizationCharacterKeys.detail('character')
          : organizationLocationKeys.detail('location'),
        { id: kind, name: 'Current name', sequences: [{ id: 'sequence' }] }
      );
      queryClient.setQueryData(
        sequenceCharacterKeys.detail('missing', 'character'),
        { id: 'character', name: 'Old name' }
      );
      queryClient.setQueryData(sequenceLocationKeys.list('missing'), [
        { id: 'location', name: 'Old name' },
      ]);
      expect(store.getSnapshot()[0]?.label).toBe('Current name');
    }
  );

  it('keeps an uncast character on its organization scope despite a missing picked sequence', () => {
    const { queryClient, store } = contextStore({
      characterId: 'character',
      castSequenceId: 'missing',
    });
    queryClient.setQueryData(organizationCharacterKeys.detail('character'), {
      id: 'character',
      name: 'Organization name',
      sequences: [],
    });
    queryClient.setQueryData(sequenceCharacterKeys.detail(null, 'character'), {
      id: 'character',
      name: 'Current page name',
    });
    queryClient.setQueryData(
      sequenceCharacterKeys.detail('missing', 'character'),
      { id: 'character', name: 'Inactive name' }
    );
    expect(store.getSnapshot()[0]?.label).toBe('Current page name');
  });

  it('keeps actual names that match system labels unchanged', () => {
    const { queryClient, store } = contextStore({
      sequenceId: 'sequence',
      characterId: 'character',
      locationId: 'location',
    });
    queryClient.setQueryData(sequenceKeys.detail('sequence'), {
      title: 'Unsaved prompt',
    });
    queryClient.setQueryData(organizationCharacterKeys.detail('character'), {
      name: 'This character',
    });
    queryClient.setQueryData(organizationLocationKeys.detail('location'), {
      name: 'This location',
    });
    expect(store.getSnapshot().map((item) => item.label)).toEqual([
      'Unsaved prompt',
      'This character',
      'This location',
    ]);
  });

  it.each(['zh-CN', 'en'] as const)(
    'reads a selected shot and its scene in %s',
    (locale) => {
      const { queryClient, store } = contextStore(
        { sequenceId: 'sequence', shot: 'shot', scenes: 'other-scene' },
        locale
      );
      queryClient.setQueryData(sequenceKeys.detail('sequence'), {
        title: 'My sequence',
      });
      queryClient.setQueryData(sceneKeys.list('sequence'), [
        { id: 'scene', title: 'This scene' },
      ]);
      queryClient.setQueryData(shotKeys.list('sequence'), [
        { id: 'shot', sceneId: 'scene', shotNumber: 3 },
      ]);
      expect(store.getSnapshot()).toEqual([
        { kind: 'sequence', id: 'sequence', label: 'My sequence' },
        { kind: 'scene', id: 'scene', label: 'This scene' },
        {
          kind: 'shot',
          id: 'shot',
          label: locale === 'zh-CN' ? '镜头 3' : 'Shot 3',
        },
      ]);
    }
  );

  it('does not create queries or run a network request', () => {
    const fetch = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { queryFn: fetch } },
    });
    const i18n = createApplicationI18n('zh-CN');
    const store = createPageContextCacheStore(
      queryClient,
      { locationId: 'location' },
      i18n.getFixedT('zh-CN', 'assistant')
    );
    const unsubscribe = store.subscribe(() => store.getSnapshot());
    expect(store.getSnapshot()[0]?.label).toBe('当前地点');
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('assistant page context routes', () => {
  it('follows nested route and selection changes', () => {
    const parent = {
      routeId: '/_app/sequences/$id',
      params: { id: 'sequence' },
      search: {},
    };
    expect(
      pageContextRouteFromMatches([
        parent,
        {
          routeId: '/_app/sequences/$id/_workspace/characters/$characterId',
          params: { characterId: 'character' },
          search: { shot: 'shot' },
        },
      ])
    ).toMatchObject({
      sequenceId: 'sequence',
      castSequenceId: 'sequence',
      characterId: 'character',
      shot: 'shot',
    });
    expect(
      pageContextRouteFromMatches([
        parent,
        {
          routeId: '/_app/sequences/$id/_workspace/locations/$locationId',
          params: { locationId: 'location' },
          search: { scenes: 'scene' },
        },
      ])
    ).toMatchObject({
      sequenceId: 'sequence',
      castSequenceId: 'sequence',
      locationId: 'location',
      scenes: 'scene',
    });
    expect(
      pageContextRouteFromMatches([
        { routeId: '/_app/images', params: {}, search: {} },
      ])
    ).toEqual({
      sequenceId: undefined,
      castSequenceId: undefined,
      characterId: undefined,
      locationId: undefined,
      scenes: undefined,
      shot: undefined,
    });
  });

  it('uses the picked sequence cache on an organization detail page without adding a sequence chip', () => {
    const route = pageContextRouteFromMatches([
      {
        routeId: '/_app/locations/$locationId',
        params: { locationId: 'location' },
        search: { sequence: 'sequence' },
      },
    ]);
    expect(route.sequenceId).toBeUndefined();
    expect(route.castSequenceId).toBe('sequence');
    const { queryClient, store } = contextStore(route);
    queryClient.setQueryData(sequenceLocationKeys.list('sequence'), [
      { id: 'location', name: 'Picked location' },
    ]);
    expect(store.getSnapshot()).toEqual([
      { kind: 'location', id: 'location', label: 'Picked location' },
    ]);
  });
});
