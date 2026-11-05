import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { systemAdminMiddleware } from '@/platform/middleware.fn';
import { loadTextModelRoutingSnapshot } from '@/platform/server/db/scoped';
import {
  saveChannelTextModelSchema,
  saveTextChannelSchema,
  syncTextChannelModelsSchema,
  toTextModelCatalog,
} from './text-channels';

export const getAdminTextChannelsFn = createServerFn({ method: 'GET' })
  .middleware([systemAdminMiddleware])
  .handler(async ({ context }) => context.adminScopedDb.textChannels.get());

export const saveTextChannelFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(saveTextChannelSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.textChannels.saveChannel(data)
  );

export const saveChannelTextModelFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(saveChannelTextModelSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.textChannels.saveModel(data)
  );

export const syncTextChannelModelsFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(syncTextChannelModelsSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.textChannels.syncModels(data)
  );

export const getTextModelCatalogFn = createServerFn({ method: 'GET' }).handler(
  async () => toTextModelCatalog(await loadTextModelRoutingSnapshot())
);
