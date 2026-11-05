import { queryOptions } from '@tanstack/react-query';
import {
  getAdminTextChannelsFn,
  getTextModelCatalogFn,
} from './text-channels.fn';

const ADMIN_TEXT_CHANNELS_QUERY_KEY = ['admin', 'text-channels'] as const;
const TEXT_MODEL_CATALOG_QUERY_KEY = ['text-model-catalog'] as const;

export const adminTextChannelsQueryOptions = queryOptions({
  queryKey: ADMIN_TEXT_CHANNELS_QUERY_KEY,
  queryFn: () => getAdminTextChannelsFn(),
  throwOnError: true,
});

export const textModelCatalogQueryOptions = queryOptions({
  queryKey: TEXT_MODEL_CATALOG_QUERY_KEY,
  queryFn: () => getTextModelCatalogFn(),
  throwOnError: true,
});
