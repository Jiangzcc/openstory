import type {
  ChannelImageModel,
  ImageChannelsConfiguration,
} from '../image-channels';
import { imageConfigurationFixture } from './image-model-fixture';

// Synthetic catalogs for workflow-size regressions; no network or real credentials.
export function imageRoutingCapacityFixture(
  modelCount: number,
  distinctPrices = false
): ImageChannelsConfiguration {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  const generate = model?.operations.generate;
  if (!model || !generate) throw new Error('Missing mock generation binding.');
  configuration.models = Array.from(
    { length: modelCount },
    (_, index): ChannelImageModel => ({
      ...structuredClone(model),
      id: `custom-image:capacity-${index}`,
      name: 'Mock capacity ' + index,
      operations: { generate: { ...generate, upstreamModel: 'mock-' + index } },
      parameters: [
        {
          key: 'quality',
          label: 'Quality',
          type: 'string',
          status: 'verified',
          operations: ['generate'],
          required: true,
          defaultValue: 'q-0',
          values: Array.from({ length: 100 }, (_, value) => 'q-' + value),
        },
      ],
      priceCards: Array.from({ length: 100 }, (_, value) => ({
        id: 'price-' + value,
        operation: 'generate',
        match: { quality: 'q-' + value },
        unitPriceUsd: distinctPrices ? index + value + 1 : 0.1,
      })),
    })
  );
  return configuration;
}

export function largeImageParameterFixture(): ImageChannelsConfiguration {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock image model.');
  model.parameters = ['choice_a', 'choice_b'].map((key) => ({
    key,
    label: key,
    type: 'string',
    status: 'verified',
    operations: ['generate'],
    required: false,
    values: Array.from(
      { length: 100 },
      (_, index) => String(index).padStart(3, '0') + 'x'.repeat(1533)
    ),
  }));
  return configuration;
}
