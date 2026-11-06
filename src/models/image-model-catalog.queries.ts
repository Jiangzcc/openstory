import { queryOptions } from '@tanstack/react-query';
import { getImageModelCatalogFn } from './image-model-catalog.fn';

const IMAGE_MODEL_CATALOG_QUERY_KEY = ['image-model-catalog'] as const;
export const imageModelCatalogQueryOptions = queryOptions({
  queryKey: IMAGE_MODEL_CATALOG_QUERY_KEY,
  queryFn: () => getImageModelCatalogFn(),
});
