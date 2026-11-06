import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type { ImageModelRoutingSnapshot } from '@/models/image-channels';
import {
  generateConfiguredImage,
  configuredImageGenerationQuote,
} from './configured-image-generation';
import { usdToMicros } from '@/billing/money';
import type { CompatibleImageResult } from './compatible-image-client';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), references: vi.fn() }));
vi.mock('./compatible-image-client', () => ({
  generateCompatibleImages: mocks.generate,
}));
vi.mock('./configured-image-references', () => ({
  configuredImageReferenceFiles: mocks.references,
}));

function mockResult(
  overrides: Partial<CompatibleImageResult> = {}
): CompatibleImageResult {
  return {
    images: [
      {
        dataUrl: 'data:image/png;base64,bW9jaw==',
        width: 1024,
        height: 576,
        mimeType: 'image/png',
        byteLength: 4,
      },
    ],
    requestedCount: 1,
    actualCount: 1,
    returnedCount: 1,
    status: 'complete',
    mismatches: [],
    reported: {},
    ...overrides,
  };
}
function mockCredentials(routing: ImageModelRoutingSnapshot) {
  return {
    userId: 'mock-user',
    organizationId: 'mock-organization',
    imageModelRouting: routing,
    resolveImageChannelKey: vi.fn(async () => 'mock-image-secret'),
    resolveKey: vi.fn(),
    resolveOptionalKey: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.references.mockResolvedValue([]);
  mocks.generate.mockResolvedValue(mockResult());
});

describe('configured image execution', () => {
  it.each(['custom-image:qwen', 'gpt_image_2'] as const)(
    'uses the exact frozen platform binding and price for %s without organization keys',
    async (model) => {
      const configuration = imageConfigurationFixture();
      const binding = configuration.models[0];
      if (!binding) throw new Error('Missing mock image binding.');
      binding.id = model;
      const routing = createImageModelRoutingSnapshot(configuration);
      const credentials = mockCredentials(routing);
      const result = await generateConfiguredImage(
        {
          model,
          prompt: 'Mock prompt',
          imageSize: 'landscape_16_9',
        },
        { credentials, configuredAttemptId: 'mock-attempt' }
      );
      expect(mocks.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          upstreamModel: 'mock-generate',
          parameters: { size: '1024x576' },
          apiKey: 'mock-image-secret',
        })
      );
      expect(credentials.resolveKey).not.toHaveBeenCalled();
      expect(credentials.resolveOptionalKey).not.toHaveBeenCalled();
      expect(result.via).toBe('compatible');
      expect(result.metadata.model).toBe(model);
      expect(result.metadata.cost).toBe(100_000);
      expect(result.metadata.usedOwnKey).toBe(false);
      expect(JSON.stringify(result)).not.toContain('mock-image-secret');
    }
  );

  it('refuses an unavailable reference combination before invoking the supplier', async () => {
    const routing = createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    );
    await expect(
      generateConfiguredImage(
        {
          model: 'custom-image:qwen',
          prompt: 'Mock prompt',
          referenceImageUrls: Array.from(
            { length: 9 },
            () => 'https://example.com/mock.png'
          ),
        },
        {
          credentials: mockCredentials(routing),
          configuredAttemptId: 'mock-attempt',
        }
      )
    ).rejects.toThrow('reference image count');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('charges the actual stored output count for a partial native response', async () => {
    const configuration = imageConfigurationFixture();
    const model = configuration.models[0];
    if (!model) throw new Error('Missing mock image model.');
    model.parameters.push({
      key: 'n',
      label: 'Count',
      type: 'integer',
      status: 'verified',
      operations: ['generate'],
      required: false,
      minimum: 1,
      maximum: 3,
      defaultValue: 1,
    });
    mocks.generate.mockResolvedValue(
      mockResult({
        requestedCount: 2,
        status: 'partial',
        mismatches: [
          { parameter: 'n', requested: 2, actual: 1, basis: 'count' },
        ],
      })
    );
    const result = await generateConfiguredImage(
      {
        model: 'custom-image:qwen',
        prompt: 'Mock prompt',
        channelParameters: { n: 2 },
      },
      {
        credentials: mockCredentials(
          createImageModelRoutingSnapshot(configuration)
        ),
        configuredAttemptId: 'mock-attempt',
      }
    );
    expect(result.metadata.cost).toBe(100_000);
    expect(result.metadata.configuredPricing).toMatchObject({
      imageCount: 1,
      requestedCount: 2,
    });
  });

  it('rejects a promised parameter mismatch without a second generation', async () => {
    const routing = createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    );
    mocks.generate.mockResolvedValue(
      mockResult({
        mismatches: [
          {
            parameter: 'size',
            requested: '1024x576',
            actual: '512x512',
            basis: 'bytes',
          },
        ],
      })
    );
    await expect(
      generateConfiguredImage(
        { model: 'custom-image:qwen', prompt: 'Mock prompt' },
        {
          credentials: mockCredentials(routing),
          configuredAttemptId: 'mock-attempt',
        }
      )
    ).rejects.toThrow('did not honor parameter');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});

it('executes a captured built-in edit after its live upstream, price and channel are changed or disabled', async () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  const channel = configuration.channels[0];
  if (!model?.operations.edit || !channel)
    throw new Error('Missing mock binding.');
  model.id = 'gpt_image_2';
  const routing = createImageModelRoutingSnapshot(configuration);
  const credentials = mockCredentials(routing);
  const credentialId = channel.credentialId;
  model.operations.edit.upstreamModel = 'mock-rebound-edit';
  model.priceCards = [
    { id: 'new-price', operation: 'edit', match: {}, unitPriceUsd: 9 },
  ];
  model.enabled = false;
  channel.enabled = false;
  channel.baseUrl = 'https://rebound.example.com/v1';
  channel.credentialId = '01K00000000000000000000001';
  const reference = new File(['mock-reference'], 'mock.png', {
    type: 'image/png',
  });
  mocks.references.mockResolvedValue([reference]);
  const result = await generateConfiguredImage(
    {
      model: 'gpt_image_2',
      prompt: 'Mock edit',
      imageSize: 'landscape_16_9',
      referenceImageUrls: ['/r2/mock/reference.png'],
    },
    { credentials, configuredAttemptId: 'mock-edit-attempt' }
  );
  expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      baseUrl: 'https://example.com/v1',
      upstreamModel: 'mock-edit',
      operation: 'edit',
      references: [reference],
    })
  );
  expect(credentials.resolveImageChannelKey).toHaveBeenCalledExactlyOnceWith(
    credentialId
  );
  expect(result.via).toBe('compatible');
  expect(result.metadata).toMatchObject({
    model: 'gpt_image_2',
    endpointId: 'mock-edit',
    cost: usdToMicros(0.2),
    configuredPricing: { priceCardId: 'edit', unitPriceUsd: 0.2 },
  });
});

function legacyParameterFixture() {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing Mock image model.');
  model.parameters.push(
    {
      key: 'seed',
      label: 'Seed',
      type: 'integer',
      status: 'verified',
      operations: ['generate'],
      required: false,
      defaultValue: 7,
    },
    {
      key: 'output_format',
      label: 'Format',
      type: 'string',
      status: 'verified',
      operations: ['generate'],
      required: false,
      defaultValue: 'webp',
      values: ['png', 'webp'],
    }
  );
  model.priceCards = [
    {
      id: 'png-price',
      operation: 'generate',
      match: { output_format: 'png' },
      unitPriceUsd: 0.3,
    },
    {
      id: 'webp-price',
      operation: 'generate',
      match: { output_format: 'webp' },
      unitPriceUsd: 0.1,
    },
    { id: 'edit-price', operation: 'edit', match: {}, unitPriceUsd: 0.2 },
  ];
  return { configuration, model };
}

it('uses verified legacy seed and format for the quote, request and returned metadata', async () => {
  const { configuration } = legacyParameterFixture();
  const routing = createImageModelRoutingSnapshot(configuration);
  const params = {
    model: 'custom-image:qwen' as const,
    prompt: 'Mock legacy parameters',
    seed: 4242,
    outputFormat: 'png' as const,
  };
  const quote = configuredImageGenerationQuote(params, routing);
  const result = await generateConfiguredImage(params, {
    credentials: mockCredentials(routing),
    configuredAttemptId: 'mock-tracked-attempt',
  });
  expect(quote).toMatchObject({
    parameters: { seed: 4242, output_format: 'png' },
    priceCardId: 'png-price',
    costMicros: usdToMicros(0.3),
  });
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({ parameters: quote.parameters })
  );
  expect(result.parameters).toMatchObject({
    seed: 4242,
    outputFormat: 'png',
    channelParameters: quote.parameters,
  });
  expect(result.metadata).toMatchObject({
    seed: 4242,
    cost: quote.costMicros,
    configuredPricing: { priceCardId: quote.priceCardId },
  });
});

it('records explicit channel parameter overrides rather than legacy values', async () => {
  const { configuration } = legacyParameterFixture();
  const routing = createImageModelRoutingSnapshot(configuration);
  const result = await generateConfiguredImage(
    {
      model: 'custom-image:qwen',
      prompt: 'Mock override',
      seed: 4242,
      outputFormat: 'png',
      channelParameters: { seed: 9, output_format: 'webp' },
    },
    {
      credentials: mockCredentials(routing),
      configuredAttemptId: 'mock-tracked-attempt',
    }
  );
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      parameters: expect.objectContaining({ seed: 9, output_format: 'webp' }),
    })
  );
  expect(result.parameters).toMatchObject({ seed: 9, outputFormat: 'webp' });
  expect(result.metadata).toMatchObject({ seed: 9, cost: usdToMicros(0.1) });
});

it.each(['unverified', 'unsupported'] as const)(
  'never sends legacy parameters declared %s',
  async (status) => {
    const { configuration, model } = legacyParameterFixture();
    for (const parameter of model.parameters)
      if (parameter.key !== 'size') parameter.status = status;
    model.priceCards = [
      { id: 'base', operation: 'generate', match: {}, unitPriceUsd: 0.1 },
    ];
    const routing = createImageModelRoutingSnapshot(configuration);
    const result = await generateConfiguredImage(
      {
        model: 'custom-image:qwen',
        prompt: 'Mock unsupported fields',
        seed: 4242,
        outputFormat: 'png',
      },
      {
        credentials: mockCredentials(routing),
        configuredAttemptId: 'mock-tracked-attempt',
      }
    );
    const sent = mocks.generate.mock.calls[0]?.[0].parameters;
    expect(sent).not.toHaveProperty('seed');
    expect(sent).not.toHaveProperty('output_format');
    expect(result.parameters.seed).toBeUndefined();
    expect(result.parameters.outputFormat).toBeUndefined();
    expect(result.metadata.seed).toBeUndefined();
  }
);

it('does not inherit generate-only legacy parameters on edit', async () => {
  const { configuration } = legacyParameterFixture();
  const routing = createImageModelRoutingSnapshot(configuration);
  const result = await generateConfiguredImage(
    {
      model: 'custom-image:qwen',
      prompt: 'Mock edit',
      referenceImageUrls: ['/r2/mock/ref.png'],
      seed: 4242,
      outputFormat: 'png',
    },
    {
      credentials: mockCredentials(routing),
      configuredAttemptId: 'mock-tracked-attempt',
    }
  );
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'edit',
      parameters: { size: '1024x1024' },
    })
  );
  expect(result.metadata.seed).toBeUndefined();
});

it('refuses a fixed size outside the budget before references, credentials or supplier spend', async () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model.');
  model.parameters = model.parameters.map((parameter) => ({
    ...parameter,
    values: ['4096x4096'],
    defaultValue: '4096x4096',
  }));
  const routing = createImageModelRoutingSnapshot(configuration);
  const credentials = mockCredentials(routing);
  await expect(
    generateConfiguredImage(
      { model: 'custom-image:qwen', prompt: 'Mock oversized request' },
      { credentials, configuredAttemptId: 'mock-oversized-attempt' }
    )
  ).rejects.toThrow('supported resource limits');
  expect(mocks.references).not.toHaveBeenCalled();
  expect(credentials.resolveImageChannelKey).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});

it.each(['generate', 'edit'] as const)(
  'uses the selected resolution for both the %s request and its price',
  async (operation) => {
    const configuration = imageConfigurationFixture();
    const model = configuration.models[0];
    if (!model) throw new Error('Missing mock image model.');
    model.parameters = model.parameters.map((parameter) => ({
      ...parameter,
      values: ['1280x720', '1920x1080'],
      defaultValue: '1280x720',
    }));
    model.priceCards = [
      {
        id: 'draft',
        operation,
        match: { size: '1280x720' },
        unitPriceUsd: 0.1,
      },
      { id: 'hd', operation, match: { size: '1920x1080' }, unitPriceUsd: 0.2 },
    ];
    const routing = createImageModelRoutingSnapshot(configuration);
    const parameters = {
      model: model.id,
      prompt: 'Mock HD output',
      imageSize: 'landscape_16_9' as const,
      resolution: '1080p' as const,
      referenceImageUrls: operation === 'edit' ? ['/r2/mock/ref.png'] : [],
    };
    const quote = configuredImageGenerationQuote(parameters, routing);
    expect(quote.parameters.size).toBe('1920x1080');
    expect(quote.costMicros).toBe(usdToMicros(0.2));
    const result = await generateConfiguredImage(parameters, {
      credentials: mockCredentials(routing),
      configuredAttemptId: 'mock-hd-attempt',
    });
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        operation,
        parameters: { size: '1920x1080' },
      })
    );
    expect(result.metadata.cost).toBe(quote.costMicros);
  }
);
