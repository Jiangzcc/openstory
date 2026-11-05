import { useQuery } from '@tanstack/react-query';
import { DEFAULT_MODEL_CONFIGURATION } from '../model-configuration';
import { modelConfigurationQueryOptions } from '../model-configuration.queries';

export function useModelDefaults() {
  const query = useQuery(modelConfigurationQueryOptions);
  return {
    configuration: query.data ?? DEFAULT_MODEL_CONFIGURATION,
    isReady: query.data !== undefined,
    error: query.error,
  };
}
