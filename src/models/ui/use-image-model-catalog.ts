import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { imageModelCatalogQueryOptions } from '../image-model-catalog.queries';
import { mergeImageModelCatalog } from '../image-model-catalog';

export function useImageModelCatalog() {
  const { data } = useSuspenseQuery(imageModelCatalogQueryOptions);
  const models = useMemo(() => mergeImageModelCatalog(data), [data]);
  return { models };
}
