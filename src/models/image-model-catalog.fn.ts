import { createServerFn } from '@tanstack/react-start';
import { loadImageModelCatalog } from '@/platform/server/db/scoped';

export const getImageModelCatalogFn = createServerFn({ method: 'GET' }).handler(
  async () => loadImageModelCatalog()
);
