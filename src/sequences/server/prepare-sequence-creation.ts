import { loadModelRuntimeConfiguration } from '@/platform/server/db/scoped';
import { parseConfiguredSequenceInput } from './configured-sequence-input';

export async function prepareSequenceCreation(input: unknown) {
  const modelConfiguration = await loadModelRuntimeConfiguration();
  return {
    input: parseConfiguredSequenceInput(input, modelConfiguration),
    modelConfiguration,
  };
}
