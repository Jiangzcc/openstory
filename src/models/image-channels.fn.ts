import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { systemAdminMiddleware } from '@/platform/middleware.fn';
import {
  saveImageChannelSchema,
  saveChannelImageModelSchema,
  syncImageChannelModelsSchema,
} from './image-channels';

export const getAdminImageChannelsFn = createServerFn({ method: 'GET' })
  .middleware([systemAdminMiddleware])
  .handler(async ({ context }) => context.adminScopedDb.imageChannels.get());

export const saveImageChannelFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(saveImageChannelSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.imageChannels.saveChannel(data)
  );

export const saveChannelImageModelFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(saveChannelImageModelSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.imageChannels.saveModel(data)
  );

export const syncImageChannelModelsFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(syncImageChannelModelsSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.imageChannels.syncModels(data)
  );
