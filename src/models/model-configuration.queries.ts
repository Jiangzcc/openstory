import { queryOptions } from '@tanstack/react-query';
import { getModelConfigurationFn } from './model-configuration.fn';

export const MODEL_CONFIGURATION_QUERY_KEY = ['model-configuration'] as const;

export const modelConfigurationQueryOptions = queryOptions({
  queryKey: MODEL_CONFIGURATION_QUERY_KEY,
  queryFn: () => getModelConfigurationFn(),
  throwOnError: true,
});
