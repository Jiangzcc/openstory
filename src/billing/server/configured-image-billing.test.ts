import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ImageModelRoute } from '@/models/image-channels';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { requireCredits, reserveRunCredits } from './preflight';

const { loadConfiguration } = vi.hoisted(() => ({
  loadConfiguration: vi.fn(),
}));
vi.mock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: loadConfiguration,
}));
import {
  configuredImageRoutingFor,
  configuredImageRoutingForModels,
  prepareConfiguredImageBilling,
} from './configured-image-billing';

const MODEL = 'custom-image:mock';
const route: ImageModelRoute = {
  modelId: MODEL,
  name: 'Mock image',
  channelId: 'mock-channel',
  protocol: 'openai-images',
  baseUrl: 'https://mock.invalid/v1',
  credentialId: 'mock-credential',
  operations: {
    generate: {
      upstreamModel: 'mock-generation',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
    edit: {
      upstreamModel: 'mock-edit',
      status: 'verified',
      minReferenceImages: 1,
      maxReferenceImages: 2,
      mask: 'unsupported',
    },
  },
  parameters: [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      defaultValue: '512x512',
      values: ['512x512', '1024x576'],
    },
  ],
  priceCards: [
    {
      id: 'square',
      operation: 'generate',
      match: { size: '512x512' },
      unitPriceUsd: 0.01,
    },
    {
      id: 'wide',
      operation: 'generate',
      match: { size: '1024x576' },
      unitPriceUsd: 0.02,
    },
    { id: 'edit', operation: 'edit', match: {}, unitPriceUsd: 0.03 },
  ],
};
const configuration: ModelRuntimeConfiguration = {
  ...DEFAULT_MODEL_CONFIGURATION,
  imageModelRouting: [route],
};

beforeEach(() => {
  loadConfiguration.mockReset();
  loadConfiguration.mockResolvedValue(configuration);
});

describe('configured image trigger quote', () => {
  it('keeps built-in model execution on its existing path', async () => {
    expect(
      await prepareConfiguredImageBilling({ model: 'flux_2_max' })
    ).toBeUndefined();
    expect(await configuredImageRoutingFor('flux_2_max')).toBeUndefined();
    expect(loadConfiguration).toHaveBeenCalledTimes(2);
  });
  it('quotes the same verified wide size the execution parser will use', async () => {
    const quote = await prepareConfiguredImageBilling({
      model: MODEL,
      aspectRatio: '16:9',
    });
    expect(quote).toMatchObject({
      costMicros: 20000,
      imageSource: 'platform',
      parameters: { size: '1024x576' },
    });
    expect(quote?.modelConfiguration).toBe(configuration);
  });
  it.each([
    ['720p', '1280x720', 100000],
    ['1080p', '2048x1152', 200000],
  ] as const)(
    'freezes the size and rate for the requested %s tier',
    async (resolution, size, costMicros) => {
      const sizedRoute: ImageModelRoute = {
        ...route,
        parameters: [
          {
            key: 'size',
            label: 'Mock size',
            type: 'string',
            status: 'verified',
            operations: ['generate'],
            required: true,
            defaultValue: '1280x720',
            values: ['1280x720', '2048x1152'],
          },
        ],
        priceCards: [
          {
            id: 'mock-low',
            operation: 'generate',
            match: { size: '1280x720' },
            unitPriceUsd: 0.1,
          },
          {
            id: 'mock-high',
            operation: 'generate',
            match: { size: '2048x1152' },
            unitPriceUsd: 0.2,
          },
        ],
      };
      loadConfiguration.mockResolvedValue({
        ...configuration,
        imageModelRouting: [sizedRoute],
      });
      const quote = await prepareConfiguredImageBilling({
        model: MODEL,
        aspectRatio: '16:9',
        resolution,
      });
      expect(quote).toMatchObject({ costMicros, parameters: { size } });
    }
  );
  it('honors the passed frozen snapshot instead of rereading current rates', async () => {
    loadConfiguration.mockRejectedValue(new Error('must not read live state'));
    const quote = await prepareConfiguredImageBilling({
      model: MODEL,
      aspectRatio: '1:1',
      modelConfiguration: configuration,
    });
    expect(quote?.costMicros).toBe(10000);
    expect(loadConfiguration).not.toHaveBeenCalled();
  });
  it('quotes edits using the final assembled reference count', async () => {
    const quote = await prepareConfiguredImageBilling({
      model: MODEL,
      referenceImageCount: 2,
    });
    expect(quote?.costMicros).toBe(30000);
    await expect(
      prepareConfiguredImageBilling({ model: MODEL, referenceImageCount: 3 })
    ).rejects.toThrow('reference');
  });
  it('rejects disabled history and unsupported aspect ratios before reserving', async () => {
    await expect(
      prepareConfiguredImageBilling({
        model: MODEL,
        modelConfiguration: { ...configuration, imageModelRouting: [] },
      })
    ).rejects.toThrow('unavailable');
    await expect(
      prepareConfiguredImageBilling({ model: MODEL, aspectRatio: '9:16' })
    ).rejects.toThrow('aspect ratio');
  });
});

const BUILTIN_MODEL = 'flux_2_max';
const builtinRoute: ImageModelRoute = { ...route, modelId: BUILTIN_MODEL };
const builtinConfiguration: ModelRuntimeConfiguration = {
  ...configuration,
  imageModelRouting: [builtinRoute],
};

describe('built-in configured image trigger quote', () => {
  it('loads the binding for a built-in model before deciding its billing route', async () => {
    loadConfiguration.mockResolvedValue(builtinConfiguration);
    const quote = await prepareConfiguredImageBilling({
      model: BUILTIN_MODEL,
      aspectRatio: '16:9',
    });
    expect(quote).toMatchObject({
      costMicros: 20000,
      imageSource: 'platform',
      parameters: { size: '1024x576' },
    });
    expect(quote?.modelConfiguration).toBe(builtinConfiguration);
    expect(await configuredImageRoutingFor(BUILTIN_MODEL)).toBe(
      builtinConfiguration.imageModelRouting
    );
  });
  it('retains the trusted snapshot instead of reloading live bindings or prices', async () => {
    loadConfiguration.mockRejectedValue(
      new Error('Mock live lookup must not run')
    );
    const quote = await prepareConfiguredImageBilling({
      model: BUILTIN_MODEL,
      aspectRatio: '1:1',
      modelConfiguration: builtinConfiguration,
    });
    expect(quote?.costMicros).toBe(10000);
    expect(
      await configuredImageRoutingFor(BUILTIN_MODEL, builtinConfiguration)
    ).toBe(builtinConfiguration.imageModelRouting);
    expect(
      await configuredImageRoutingForModels(
        ['nano_banana_2', BUILTIN_MODEL],
        builtinConfiguration
      )
    ).toBe(builtinConfiguration.imageModelRouting);
    expect(loadConfiguration).not.toHaveBeenCalled();
  });
  it('loads one snapshot for mixed models and finds a later built-in binding', async () => {
    loadConfiguration.mockResolvedValue(builtinConfiguration);
    expect(
      await configuredImageRoutingForModels(['nano_banana_2', BUILTIN_MODEL])
    ).toBe(builtinConfiguration.imageModelRouting);
    expect(loadConfiguration).toHaveBeenCalledOnce();
  });
  it('keeps an unbound trusted built-in on its original path', async () => {
    loadConfiguration.mockRejectedValue(
      new Error('Mock live lookup must not run')
    );
    const unbound = { ...configuration, imageModelRouting: [] };
    expect(
      await prepareConfiguredImageBilling({
        model: BUILTIN_MODEL,
        modelConfiguration: unbound,
      })
    ).toBeUndefined();
    expect(
      await configuredImageRoutingForModels([BUILTIN_MODEL], unbound)
    ).toBeUndefined();
    expect(
      await configuredImageRoutingForModels([null, undefined, 'unknown-model'])
    ).toBeUndefined();
    expect(loadConfiguration).not.toHaveBeenCalled();
  });
  it('rejects a bound request without a valid price or parameters', async () => {
    await expect(
      prepareConfiguredImageBilling({
        model: BUILTIN_MODEL,
        modelConfiguration: {
          ...builtinConfiguration,
          imageModelRouting: [{ ...builtinRoute, priceCards: [] }],
        },
      })
    ).rejects.toThrow('No configured image price');
    await expect(
      prepareConfiguredImageBilling({
        model: BUILTIN_MODEL,
        modelConfiguration: builtinConfiguration,
        aspectRatio: '9:16',
      })
    ).rejects.toThrow('aspect ratio');
    await expect(
      prepareConfiguredImageBilling({
        model: BUILTIN_MODEL,
        modelConfiguration: builtinConfiguration,
        referenceImageCount: 3,
      })
    ).rejects.toThrow('reference');
  });
  it('requires platform credits and a reservation despite an unrelated fal key', async () => {
    const quote = await prepareConfiguredImageBilling({
      model: BUILTIN_MODEL,
      modelConfiguration: builtinConfiguration,
    });
    if (!quote) throw new Error('Mock bound quote is required.');
    const db = {
      apiKeys: { hasUsableKey: vi.fn(async () => true) },
      billing: {
        hasEnoughCredits: vi.fn(async () => false),
        createReservation: vi.fn(async () => ({ ok: false as const })),
      },
    };
    await expect(
      requireCredits(db, quote.costMicros, { imageSource: quote.imageSource })
    ).rejects.toThrow('Insufficient credits');
    await expect(
      reserveRunCredits(db, quote.costMicros, {
        imageSource: quote.imageSource,
      })
    ).rejects.toThrow('Insufficient credits');
    expect(db.apiKeys.hasUsableKey).not.toHaveBeenCalled();
    expect(db.billing.hasEnoughCredits).toHaveBeenCalledWith(10000, undefined);
    expect(db.billing.createReservation).toHaveBeenCalledOnce();
  });
});
