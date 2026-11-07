import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { organizationCharacterKeys } from '@/cast/ui/use-organization-characters';
import {
  organizationLocationKeys,
  sequenceLocationKeys,
} from '@/cast/ui/location-keys';
import { sequenceCharacterKeys } from '@/cast/ui/use-sequence-characters';
import { sequenceKeys } from '@/sequences/ui/use-sequences';
import { sceneKeys } from '@/shots/ui/use-scenes';
import { shotKeys } from '@/shots/ui/use-shots';
import { parseSelectionFromSearch } from '@/shots/ui/scene-selection';
import type { PageContextItem } from '../page-context';

type ContextMatch = {
  routeId: string;
  params: object;
  search: object;
};

export type PageContextRoute = {
  sequenceId?: string;
  castSequenceId?: string;
  characterId?: string;
  locationId?: string;
  scenes?: string;
  shot?: string;
};

function field(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value))
    return undefined;
  const found: unknown = Reflect.get(value, key);
  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

function findInList(list: unknown, id: string): unknown {
  return Array.isArray(list)
    ? list.find((item: unknown) => field(item, 'id') === id)
    : undefined;
}

function shownCastScope(
  route: PageContextRoute,
  entity: unknown,
  kind: 'character' | 'location'
): string | null | undefined {
  if (route.sequenceId) return route.sequenceId;
  const sequences: unknown =
    typeof entity === 'object' && entity !== null
      ? Reflect.get(entity, 'sequences')
      : undefined;
  if (!Array.isArray(sequences)) return route.castSequenceId ?? null;
  if (route.castSequenceId) {
    if (findInList(sequences, route.castSequenceId))
      return route.castSequenceId;
    return kind === 'character' && sequences.length === 0 ? null : undefined;
  }
  return kind === 'character' ? (field(sequences[0], 'id') ?? null) : null;
}

export function pageContextRouteFromMatches(
  matches: readonly ContextMatch[]
): PageContextRoute {
  const params: Record<string, string> = {};
  const search: Record<string, unknown> = {};
  let sequenceRoute = false;
  let characterRoute = false;
  for (const match of matches) {
    Object.assign(params, match.params);
    Object.assign(search, match.search);
    sequenceRoute ||= match.routeId.startsWith('/_app/sequences/$id');
    characterRoute ||= match.routeId.startsWith('/_app/characters/');
  }
  const sequenceId = sequenceRoute ? params.id : undefined;
  return {
    sequenceId,
    castSequenceId:
      sequenceId ??
      (typeof search.sequence === 'string' ? search.sequence : undefined),
    characterId: params.characterId ?? (characterRoute ? params.id : undefined),
    locationId: params.locationId,
    scenes: typeof search.scenes === 'string' ? search.scenes : undefined,
    shot: typeof search.shot === 'string' ? search.shot : undefined,
  };
}

function characterName(
  queryClient: QueryClient,
  route: PageContextRoute,
  id: string
) {
  const character = queryClient.getQueryData(
    organizationCharacterKeys.detail(id)
  );
  const sequenceId = shownCastScope(route, character, 'character');
  return (
    field(
      sequenceId === undefined
        ? undefined
        : queryClient.getQueryData(
            sequenceCharacterKeys.detail(sequenceId, id)
          ),
      'name'
    ) ??
    field(
      sequenceId
        ? findInList(
            queryClient.getQueryData(sequenceCharacterKeys.list(sequenceId)),
            id
          )
        : undefined,
      'name'
    ) ??
    field(character, 'name') ??
    field(
      findInList(
        queryClient.getQueryData(organizationCharacterKeys.list()),
        id
      ),
      'name'
    )
  );
}

function locationName(
  queryClient: QueryClient,
  route: PageContextRoute,
  id: string
) {
  const location = queryClient.getQueryData(
    organizationLocationKeys.detail(id)
  );
  const sequenceId = shownCastScope(route, location, 'location');
  return (
    field(
      sequenceId === undefined
        ? undefined
        : sequenceId
          ? findInList(
              queryClient.getQueryData(sequenceLocationKeys.list(sequenceId)),
              id
            )
          : queryClient.getQueryData(sequenceLocationKeys.detail(null, id)),
      'name'
    ) ??
    field(location, 'name') ??
    field(
      findInList(queryClient.getQueryData(organizationLocationKeys.list()), id),
      'name'
    )
  );
}

function shotContext(
  shot: unknown,
  id: string,
  translate: TFunction<'assistant'>
): PageContextItem {
  const number =
    typeof shot === 'object' && shot !== null
      ? Reflect.get(shot, 'shotNumber')
      : undefined;
  return {
    kind: 'shot',
    id,
    label:
      typeof number === 'number'
        ? translate('Shot {{number}}', { number })
        : translate('This shot'),
  };
}

function sequenceContext(
  queryClient: QueryClient,
  route: PageContextRoute,
  translate: TFunction<'assistant'>,
  sequenceId: string
): PageContextItem[] {
  const items: PageContextItem[] = [
    {
      kind: 'sequence',
      id: sequenceId,
      label:
        field(
          queryClient.getQueryData(sequenceKeys.detail(sequenceId)),
          'title'
        ) ?? translate('This sequence'),
    },
  ];
  const scenes = queryClient.getQueryData(sceneKeys.list(sequenceId));
  const selection = parseSelectionFromSearch(route);
  const shot = selection.shotId
    ? findInList(
        queryClient.getQueryData(shotKeys.list(sequenceId)),
        selection.shotId
      )
    : undefined;
  const sceneId = selection.shotId
    ? field(shot, 'sceneId')
    : selection.sceneIds[0];
  if (sceneId)
    items.push({
      kind: 'scene',
      id: sceneId,
      label:
        field(findInList(scenes, sceneId), 'title') ?? translate('This scene'),
    });
  if (selection.shotId)
    items.push(shotContext(shot, selection.shotId, translate));
  return items;
}

function pageContextFromCache(
  queryClient: QueryClient,
  route: PageContextRoute,
  translate: TFunction<'assistant'>
): PageContextItem[] {
  const items = route.sequenceId
    ? sequenceContext(queryClient, route, translate, route.sequenceId)
    : [];
  if (route.characterId)
    items.push({
      kind: 'character',
      id: route.characterId,
      label:
        characterName(queryClient, route, route.characterId) ??
        translate('This character'),
    });
  if (route.locationId)
    items.push({
      kind: 'location',
      id: route.locationId,
      label:
        locationName(queryClient, route, route.locationId) ??
        translate('This location'),
    });
  return items;
}

export function createPageContextCacheStore(
  queryClient: QueryClient,
  route: PageContextRoute,
  translate: TFunction<'assistant'>
) {
  let serialized = '';
  let snapshot: PageContextItem[] = [];
  return {
    subscribe: (listener: () => void) =>
      queryClient.getQueryCache().subscribe(listener),
    getSnapshot: () => {
      const items = pageContextFromCache(queryClient, route, translate);
      const next = JSON.stringify(items);
      if (next !== serialized) {
        serialized = next;
        snapshot = items;
      }
      return snapshot;
    },
  };
}
