/**
 * What the page says about itself (#2155), read off the router: the route
 * params name the sequence, character or location, the search params name
 * the selected scene or shot. Nothing is registered by pages, so a page
 * cannot forget to, and the chips update the moment the URL does. Labels
 * come from what the page already loaded into the query cache; an id whose
 * row is not cached yet is still sent, with a plain label.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useMatches } from '@tanstack/react-router';
import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageContextItem } from '../page-context';
import {
  createPageContextCacheStore,
  pageContextRouteFromMatches,
} from './page-context-from-cache';

export function usePageContext(): PageContextItem[] {
  const matches = useMatches();
  const queryClient = useQueryClient();
  const { t } = useTranslation('assistant');
  const route = pageContextRouteFromMatches(matches);
  const { sequenceId, castSequenceId, characterId, locationId, scenes, shot } =
    route;
  const store = useMemo(
    () =>
      createPageContextCacheStore(
        queryClient,
        { sequenceId, castSequenceId, characterId, locationId, scenes, shot },
        t
      ),
    [
      queryClient,
      sequenceId,
      castSequenceId,
      characterId,
      locationId,
      scenes,
      shot,
      t,
    ]
  );
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}
