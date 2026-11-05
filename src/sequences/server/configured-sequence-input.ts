import { z } from 'zod';
import type { ModelConfiguration } from '@/models/model-configuration';
import { createSequenceSchema } from './sequence.schemas';

export function parseConfiguredSequenceInput(
  input: unknown,
  configuration: ModelConfiguration
) {
  const supplied = z.record(z.string(), z.unknown()).parse(input);
  const explicit = Object.fromEntries(
    Object.entries(supplied).filter(([, value]) => value !== undefined)
  );
  return createSequenceSchema.parse({
    analysisModels: [configuration.defaultAnalysis],
    imageModel: configuration.defaultImage,
    imageModels: [configuration.defaultImage],
    videoModel: configuration.defaultVideo,
    videoModels: [configuration.defaultVideo],
    musicModel: configuration.defaultMusic,
    ...explicit,
  });
}
