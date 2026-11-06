import type { ImageModelCatalogEntry } from '@/models/image-channels';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import { createImageChannelsReadMethods } from './image-channels';
import type { ModelConfiguration } from '@/models/model-configuration';
import type { AnalysisModelDefinition } from '@/models/models.config';
import { textModelCatalogFromRouting } from '@/models/text-model-catalog';
import { createTextChannelsReadMethods } from './text-channels';
import { eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import { onPrimary } from '@/platform/server/db/d1-session';
import {
  createModelConfigurationSchema,
  resolveModelConfiguration,
} from '@/models/model-configuration';

export const MODEL_CONFIGURATION_KEY =
  'secondary-development:model-configuration:v1';

export function createModelConfigurationReadMethods(db: Database) {
  return {
    async get(
      catalog?: readonly AnalysisModelDefinition[],
      imageCatalog?: readonly ImageModelCatalogEntry[]
    ): Promise<ModelConfiguration> {
      return onPrimary(async () => {
        const models =
          catalog ??
          textModelCatalogFromRouting(
            await createTextChannelsReadMethods(db).getSnapshot()
          );
        const imageModels = mergeImageModelCatalog(
          imageCatalog ??
            (await createImageChannelsReadMethods(db).getCatalog())
        );
        const [row] = await db
          .select()
          .from(appMetadata)
          .where(eq(appMetadata.key, MODEL_CONFIGURATION_KEY))
          .limit(1);
        if (!row) return resolveModelConfiguration(null);
        const saved: unknown = JSON.parse(row.value);
        return resolveModelConfiguration(saved, models, imageModels);
      });
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
      const imageModels = mergeImageModelCatalog(
        await createImageChannelsReadMethods(db).getCatalog()
      );
      const configuration = createModelConfigurationSchema(
        models,
        false,
        imageModels
      ).parse(input);
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
