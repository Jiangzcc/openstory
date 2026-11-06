import type {
  ImageModelCatalogEntry,
  ImageChannelsConfiguration,
} from '../image-channels';

export function imageCatalogFixture(
  overrides: Partial<ImageModelCatalogEntry> = {}
): ImageModelCatalogEntry {
  return {
    id: 'custom-image:qwen',
    name: 'Configured Qwen',
    available: true,
    operations: {
      generate: {
        status: 'verified',
        minReferenceImages: 0,
        maxReferenceImages: 0,
        mask: 'unsupported',
      },
      edit: {
        status: 'verified',
        minReferenceImages: 1,
        maxReferenceImages: 8,
        mask: 'verified',
      },
    },
    parameters: [
      {
        key: 'size',
        label: 'Size',
        type: 'string',
        status: 'verified',
        operations: ['generate', 'edit'],
        required: false,
        defaultValue: '1024x1024',
        values: ['512x512', '1024x576', '576x1024', '1024x1024', '1536x1024'],
      },
    ],
    priceCards: [
      { id: 'generate', operation: 'generate', match: {}, unitPriceUsd: 0.1 },
      { id: 'edit', operation: 'edit', match: {}, unitPriceUsd: 0.2 },
    ],
    ...overrides,
  };
}

export function imageConfigurationFixture(): ImageChannelsConfiguration {
  const catalog = imageCatalogFixture();
  return {
    revision: 1,
    channels: [
      {
        id: 'image-channel',
        name: 'Image channel',
        baseUrl: 'https://example.com/v1',
        protocol: 'openai-images',
        enabled: true,
        credentialId: '01K00000000000000000000000',
        keyHint: 'mock-key',
        hasKey: true,
      },
    ],
    models: [
      {
        id: catalog.id,
        name: catalog.name,
        channelId: 'image-channel',
        enabled: true,
        operations: {
          generate: {
            upstreamModel: 'mock-generate',
            status: 'verified',
            minReferenceImages: 0,
            maxReferenceImages: 0,
            mask: 'unsupported',
          },
          edit: {
            upstreamModel: 'mock-edit',
            status: 'verified',
            minReferenceImages: 1,
            maxReferenceImages: 8,
            mask: 'verified',
          },
        },
        parameters: catalog.parameters,
        priceCards: catalog.priceCards,
      },
    ],
  };
}
