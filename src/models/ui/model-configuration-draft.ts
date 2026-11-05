import type {
  createModelConfigurationSchema,
  ModelConfiguration,
} from '@/models/model-configuration';

type ModelConfigurationDraftUpdate = (
  current: Readonly<ModelConfiguration>
) => ModelConfiguration;

export function createModelConfigurationDraftUpdate(
  key: keyof ModelConfiguration,
  value: string | null,
  schema: ReturnType<typeof createModelConfigurationSchema>
): ModelConfigurationDraftUpdate | null {
  const result = schema.shape[key].safeParse(value);
  if (!result.success) return null;
  return (current) => ({ ...current, [key]: result.data });
}
