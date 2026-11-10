import { expect, it } from 'vitest';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import {
  imageChannelPriceCardSchema,
  quoteConfiguredImagePrice,
} from '@/models/image-channel-pricing';
import {
  channelImageModelSchema,
  imageChannelsConfigurationSchema,
  saveChannelImageModelSchema,
} from '@/models/image-channels';
import type { ChannelImageModel } from '@/models/image-channels';
import { imageUnitPriceFitsWallet } from './configured-image-price-policy';

// Synthetic USD prices only; no supplier call or invoice data.
const PRECISION_ERROR = 'The configured price is outside wallet precision.';
const representablePrices = [
  0, -0, 0.000001, 0.000123, 0.07, 1.000001, 999999.999999, 1_000_000,
  8_000_000_000,
];
const unrepresentablePrices = [
  -1,
  -0.000001,
  Number.NaN,
  Infinity,
  -Infinity,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  0.0000003,
  0.0000005,
  0.0000015,
  0.0123456,
  10_000_000_000,
  Number.MAX_SAFE_INTEGER / 1_000_000,
];

function pricedModel(unitPriceUsd: number): ChannelImageModel {
  const [model] = imageConfigurationFixture().models;
  if (!model) throw new Error('Missing synthetic image model fixture.');
  return {
    ...model,
    priceCards: model.priceCards.map((card) => ({ ...card, unitPriceUsd })),
  };
}

it.each(representablePrices)(
  'accepts the exact wallet unit price %s',
  (price) => {
    expect(imageUnitPriceFitsWallet(price)).toBe(true);
  }
);

it.each(unrepresentablePrices)(
  'rejects the inexact or unsafe unit price %s',
  (price) => {
    expect(imageUnitPriceFitsWallet(price)).toBe(false);
  }
);

it.each([0, -0, 0.000001, 1_000_000])(
  'preserves enabled saving and quotes at the sales price boundary %s',
  (unitPriceUsd) => {
    const model = pricedModel(unitPriceUsd);
    expect(
      saveChannelImageModelSchema.safeParse({ ...model, revision: 1 }).success
    ).toBe(true);
    expect(
      quoteConfiguredImagePrice(model.priceCards, 'generate', {}, 2)
    ).toEqual({
      priceCardId: 'generate',
      unitPriceUsd,
      imageCount: 2,
      totalUsd: unitPriceUsd * 2,
    });
  }
);

it('keeps the sales price maximum separate from wallet precision', () => {
  const model = pricedModel(8_000_000_000);
  expect(imageUnitPriceFitsWallet(8_000_000_000)).toBe(true);
  expect(
    imageChannelPriceCardSchema.safeParse(model.priceCards[0]).success
  ).toBe(false);
  expect(
    saveChannelImageModelSchema.safeParse({ ...model, revision: 1 }).success
  ).toBe(false);
  expect(() =>
    quoteConfiguredImagePrice(model.priceCards, 'generate', {}, 1)
  ).toThrow();
});

it.each([0.0000003, 0.0000005, 0.0000015, 0.0123456])(
  'keeps historical rate %s readable, correctable and disableable without allowing spend',
  (unitPriceUsd) => {
    const model = pricedModel(unitPriceUsd);
    const configuration = { ...imageConfigurationFixture(), models: [model] };
    expect(channelImageModelSchema.safeParse(model).success).toBe(true);
    expect(
      imageChannelsConfigurationSchema.safeParse(configuration).success
    ).toBe(true);
    const save = saveChannelImageModelSchema.safeParse({
      ...model,
      revision: 1,
    });
    expect(save.success).toBe(false);
    if (save.success)
      throw new Error('Expected the synthetic price to be rejected.');
    expect(save.error.issues).toContainEqual({
      code: 'custom',
      message: PRECISION_ERROR,
      path: ['priceCards'],
    });
    expect(
      saveChannelImageModelSchema.safeParse({
        ...model,
        revision: 1,
        enabled: false,
      }).success
    ).toBe(true);
    expect(
      saveChannelImageModelSchema.safeParse({
        ...pricedModel(0.000001),
        revision: 1,
      }).success
    ).toBe(true);
    expect(() =>
      quoteConfiguredImagePrice(model.priceCards, 'generate', {}, 2)
    ).toThrow(PRECISION_ERROR);
  }
);

it('does not apply sales wallet precision to supplier cost or currency', () => {
  const model = pricedModel(0.000001);
  const supplierCost = { currency: 'CNY', unitPrice: 0.0000003 };
  model.priceCards = model.priceCards.map((card) => ({
    ...card,
    supplierCost,
  }));
  const saved = saveChannelImageModelSchema.parse({ ...model, revision: 1 });
  expect(saved.priceCards[0]?.supplierCost).toEqual(supplierCost);
  expect(
    quoteConfiguredImagePrice(model.priceCards, 'generate', {}, 2)
  ).toEqual({
    priceCardId: 'generate',
    unitPriceUsd: 0.000001,
    imageCount: 2,
    totalUsd: 0.000002,
  });
});
