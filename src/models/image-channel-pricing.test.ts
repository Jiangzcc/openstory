import { expect, it } from 'vitest';
import type { ImageChannelPriceCard } from './image-channel-pricing';
import {
  imageChannelPriceCardSchema,
  imageChannelPriceCardsSchema,
  quoteConfiguredImagePrice,
} from './image-channel-pricing';

// Synthetic prices, unrelated to any supplier invoice.
const base: ImageChannelPriceCard = {
  id: 'base',
  operation: 'generate',
  match: {},
  unitPriceUsd: 0.04,
};

it('prices actual image count with an explicit wildcard card', () => {
  expect(quoteConfiguredImagePrice([base], 'generate', {}, 3)).toEqual({
    priceCardId: 'base',
    unitPriceUsd: 0.04,
    imageCount: 3,
    totalUsd: 0.12,
  });
});

it('uses exact scalar auto/size/quality matches and the most specific card', () => {
  const auto: ImageChannelPriceCard = {
    ...base,
    id: 'auto',
    match: { size: 'auto' },
    unitPriceUsd: 0.06,
  };
  const high: ImageChannelPriceCard = {
    ...base,
    id: 'high',
    match: { size: 'auto', quality: 'high' },
    unitPriceUsd: 0.1,
  };
  expect(
    quoteConfiguredImagePrice(
      [base, auto, high],
      'generate',
      { size: 'auto', quality: 'high' },
      2
    ).totalUsd
  ).toBe(0.2);
  expect(
    quoteConfiguredImagePrice(
      [base, auto, high],
      'generate',
      { size: '1024x1024' },
      1
    ).priceCardId
  ).toBe('base');
});

it('rejects missing prices, another operation and equal-specificity ambiguity', () => {
  expect(() => quoteConfiguredImagePrice([], 'generate', {}, 1)).toThrow(
    'No configured'
  );
  expect(() => quoteConfiguredImagePrice([base], 'edit', {}, 1)).toThrow(
    'No configured'
  );
  expect(() =>
    quoteConfiguredImagePrice(
      [{ ...base, match: { size: 'auto' } }],
      'generate',
      {},
      1
    )
  ).toThrow();
  expect(() =>
    quoteConfiguredImagePrice(
      [base, { ...base, id: 'second' }],
      'generate',
      {},
      1
    )
  ).toThrow('ambiguous');
});

it.each([0, -1, 1.5, 17, NaN, Infinity])(
  'rejects invalid returned image count %s',
  (count) => {
    expect(() =>
      quoteConfiguredImagePrice([base], 'generate', {}, count)
    ).toThrow();
  }
);

it('keeps explicit zero prices separate from missing rates and ignores supplier cost in sales billing', () => {
  const free = {
    ...base,
    unitPriceUsd: 0,
    supplierCost: { currency: 'CNY', unitPrice: 99 },
  };
  expect(quoteConfiguredImagePrice([free], 'generate', {}, 1).totalUsd).toBe(0);
  expect(imageChannelPriceCardSchema.safeParse(free).success).toBe(true);
});

it.each([-1, NaN, Infinity, 1000001])(
  'rejects unsafe configured rate %s',
  (rate) => {
    expect(
      imageChannelPriceCardSchema.safeParse({ ...base, unitPriceUsd: rate })
        .success
    ).toBe(false);
  }
);

it('rejects object price conditions and duplicate identifiers', () => {
  expect(
    imageChannelPriceCardSchema.safeParse({
      ...base,
      match: { size: { value: 'auto' } },
    }).success
  ).toBe(false);
  expect(imageChannelPriceCardsSchema.safeParse([base, base]).success).toBe(
    false
  );
});

it('rejects duplicate price matches with different IDs and property order', () => {
  expect(
    imageChannelPriceCardsSchema.safeParse([
      { ...base, match: { size: 'auto', quality: 'high' } },
      { ...base, id: 'duplicate', match: { quality: 'high', size: 'auto' } },
    ]).success
  ).toBe(false);
});
