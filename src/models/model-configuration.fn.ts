import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { systemAdminMiddleware } from '@/platform/middleware.fn';
import { loadModelConfiguration } from '@/platform/server/db/scoped';
import { modelConfigurationInputSchema } from './model-configuration';

export const getModelConfigurationFn = createServerFn({
  method: 'GET',
}).handler(async () => loadModelConfiguration());

export const getAdminModelConfigurationFn = createServerFn({ method: 'GET' })
  .middleware([systemAdminMiddleware])
  .handler(async ({ context }) =>
    context.adminScopedDb.modelConfiguration.get()
  );

export const saveModelConfigurationFn = createServerFn({ method: 'POST' })
  .middleware([systemAdminMiddleware])
  .validator(zodValidator(modelConfigurationInputSchema))
  .handler(async ({ data, context }) =>
    context.adminScopedDb.modelConfiguration.save(data)
  );
