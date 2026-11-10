import { z } from 'zod';
import { imageUnitPriceFitsWallet } from '@/billing/configured-image-price-policy';
import {
  IMAGE_PARAMETER_LIMITS,
  imageChannelParameterValuesSchema,
  imageOperationSchema,
} from './image-channel-parameters';
import type {
  ImageChannelParameterValues,
  ImageOperation,
} from './image-channel-parameters';

export const IMAGE_PRICE_LIMITS = {
  cards: 200,
  id: 200,
  maximumUsd: 1_000_000,
  maximumMatchParameters: 16,
  currencyLength: 3,
} as const;
const priceSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(IMAGE_PRICE_LIMITS.maximumUsd);
export const imageChannelPriceCardSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .min(IMAGE_PARAMETER_LIMITS.requiredLength)
    .max(IMAGE_PRICE_LIMITS.id)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  operation: imageOperationSchema,
  match: imageChannelParameterValuesSchema.refine(
    (values) =>
      Object.keys(values).length <= IMAGE_PRICE_LIMITS.maximumMatchParameters,
    'Too many price match fields.'
  ),
  unitPriceUsd: priceSchema,
  supplierCost: z
    .strictObject({
      currency: z
        .string()
        .length(IMAGE_PRICE_LIMITS.currencyLength)
        .regex(/^[A-Z]{3}$/),
      unitPrice: priceSchema,
    })
    .optional(),
});
export type ImageChannelPriceCard = z.infer<typeof imageChannelPriceCardSchema>;
function hasUniquePriceMatches(cards: ImageChannelPriceCard[]): boolean {
  const identities = cards.map((card) =>
    JSON.stringify([
      card.operation,
      Object.entries(card.match).sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    ])
  );
  return new Set(identities).size === cards.length;
}

export const imageChannelPriceCardsSchema = z
  .array(imageChannelPriceCardSchema)
  .max(IMAGE_PRICE_LIMITS.cards)
  .refine(
    (cards) => new Set(cards.map((card) => card.id)).size === cards.length,
    'Price card identifiers must be unique.'
  )
  .refine(
    hasUniquePriceMatches,
    'Price cards must not duplicate an operation and parameter match.'
  );
export type ConfiguredImagePriceQuote = {
  priceCardId: string;
  unitPriceUsd: number;
  imageCount: number;
  totalUsd: number;
};

export function quoteConfiguredImagePrice(
  priceCards: readonly ImageChannelPriceCard[],
  operation: ImageOperation,
  parameters: ImageChannelParameterValues,
  imageCount: number
): ConfiguredImagePriceQuote {
  const count = z
    .number()
    .int()
    .min(1)
    .max(IMAGE_PARAMETER_LIMITS.maximumImages)
    .parse(imageCount);
  const matches = priceCards.filter(
    (card) =>
      card.operation === operation &&
      Object.entries(card.match).every(
        ([key, value]) =>
          Object.hasOwn(parameters, key) && parameters[key] === value
      )
  );
  const specificity = Math.max(
    ...matches.map((card) => Object.keys(card.match).length)
  );
  const best = matches.filter(
    (card) => Object.keys(card.match).length === specificity
  );
  if (best.length === 0)
    throw new Error('No configured image price matches these parameters.');
  if (best.length !== 1)
    throw new Error(
      'Configured image price is ambiguous for these parameters.'
    );
  const card = best[0];
  if (!card) throw new Error('Configured image price is unavailable.');
  const unitPriceUsd = priceSchema.parse(card.unitPriceUsd);
  if (!imageUnitPriceFitsWallet(unitPriceUsd))
    throw new Error('The configured price is outside wallet precision.');
  const totalUsd = unitPriceUsd * count;
  if (!Number.isFinite(totalUsd))
    throw new Error('Configured image price exceeds the supported range.');
  return { priceCardId: card.id, unitPriceUsd, imageCount: count, totalUsd };
}
