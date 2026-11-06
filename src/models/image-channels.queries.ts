import { queryOptions } from '@tanstack/react-query';
import { getAdminImageChannelsFn } from './image-channels.fn';

const ADMIN_IMAGE_CHANNELS_QUERY_KEY = ['admin', 'image-channels'] as const;

export const adminImageChannelsQueryOptions = queryOptions({
  queryKey: ADMIN_IMAGE_CHANNELS_QUERY_KEY,
  queryFn: () => getAdminImageChannelsFn(),
  throwOnError: true,
});
export { imageModelCatalogQueryOptions } from './image-model-catalog.queries';
