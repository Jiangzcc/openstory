import type { ModelConfiguration } from '@/models/model-configuration';
import type { AnalysisModelDefinition } from '@/models/models.config';
import { textModelCatalogFromRouting } from '@/models/text-model-catalog';
import { createTextChannelsReadMethods } from './text-channels';
import { eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import {
  createModelConfigurationSchema,
  resolveModelConfiguration,
} from '@/models/model-configuration';

export const MODEL_CONFIGURATION_KEY =
  'secondary-development:model-configuration:v1';

export function createModelConfigurationReadMethods(db: Database) {
  return {
    async get(
      catalog?: readonly AnalysisModelDefinition[]
    ): Promise<ModelConfiguration> {
      const models =
        catalog ??
        textModelCatalogFromRouting(
          await createTextChannelsReadMethods(db).getSnapshot()
        );
      const [row] = await db
        .select()
        .from(appMetadata)
        .where(eq(appMetadata.key, MODEL_CONFIGURATION_KEY))
        .limit(1);
      if (!row) return resolveModelConfiguration(null);
      const saved: unknown = JSON.parse(row.value);
      return resolveModelConfiguration(saved, models);
    },
  };
}

export function createModelConfigurationAdminMethods(db: Database) {
  return {
    ...createModelConfigurationReadMethods(db),
    async save(input: ModelConfiguration): Promise<ModelConfiguration> {
      const models = textModelCatalogFromRouting(
        await createTextChannelsReadMethods(db).getSnapshot()
      );
      const configuration = createModelConfigurationSchema(models).parse(input);
      const updatedAt = new Date();
      await db
        .insert(appMetadata)
        .values({
          key: MODEL_CONFIGURATION_KEY,
          value: JSON.stringify(configuration),
          updatedAt,
        })
        .onConflictDoUpdate({
          target: appMetadata.key,
          set: { value: JSON.stringify(configuration), updatedAt },
        });
      return configuration;
    },
  };
}
