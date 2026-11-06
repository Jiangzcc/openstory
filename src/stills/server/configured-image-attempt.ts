import { z } from 'zod';
import { micros } from '@/billing/money';

export const IMAGE_ATTEMPT_STATUS = {
  submitted: 'submitted',
  stored: 'stored',
  unknown: 'unknown',
} as const;
export const IMAGE_ATTEMPT_LIMITS = {
  id: 160,
  error: 300,
  resultBytes: 262_144,
  storedUrl: 2048,
  storedPath: 1024,
} as const;

const storedChannelImageSchema = z.strictObject({
  url: z
    .string()
    .min(1)
    .max(IMAGE_ATTEMPT_LIMITS.storedUrl)
    .refine(
      (value) => value.startsWith('/r2/') || /^https?:\/\//.test(value),
      'Expected a stored media URL.'
    ),
  path: z
    .string()
    .min(1)
    .max(IMAGE_ATTEMPT_LIMITS.storedPath)
    .refine(
      (value) =>
        !value.includes(':') &&
        !value.startsWith('/') &&
        !value.split('/').includes('..'),
      'Expected a storage object key.'
    ),
  sheetId: z.string().optional(),
  contentType: z.string().optional(),
});
const imageMetadataSchema = z.object({
  prompt: z.string(),
  model: z.string(),
  endpointId: z.string(),
  dimensions: z.array(
    z.object({ width: z.number().positive(), height: z.number().positive() })
  ),
  file_sizes: z.array(z.number().nonnegative()),
  numImages: z.number().int().positive().optional(),
  seed: z.number().optional(),
  cost: z.number().int().nonnegative().safe().transform(micros),
  requestId: z.string().optional(),
  usedOwnKey: z.literal(false),
  configuredPriceRevision: z.number().int().nonnegative().optional(),
  supplierUsage: z
    .object({
      inputTokens: z.number().nonnegative().optional(),
      outputTokens: z.number().nonnegative().optional(),
      totalTokens: z.number().nonnegative().optional(),
      inputTokensDetails: z
        .object({
          imageTokens: z.number().nonnegative().optional(),
          textTokens: z.number().nonnegative().optional(),
        })
        .optional(),
      outputTokensDetails: z
        .object({
          imageTokens: z.number().nonnegative().optional(),
          textTokens: z.number().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  configuredPricing: z
    .object({
      priceCardId: z.string(),
      unitPriceUsd: z.number().nonnegative(),
      imageCount: z.number().int().positive(),
      requestedCount: z.number().int().positive(),
    })
    .optional(),
});
export const storedChannelGenerationSchema = z.strictObject({
  stored: z.array(storedChannelImageSchema).min(1),
  metadata: imageMetadataSchema,
  via: z.literal('compatible'),
});
export type StoredChannelGeneration = z.infer<
  typeof storedChannelGenerationSchema
>;

export const imageAttemptIdentitySchema = z.strictObject({
  id: z.string().min(1).max(IMAGE_ATTEMPT_LIMITS.id),
  model: z.string().min(1),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ImageAttemptIdentity = z.infer<typeof imageAttemptIdentitySchema>;
export const imageGenerationAttemptSchema = imageAttemptIdentitySchema.extend({
  status: z.enum(IMAGE_ATTEMPT_STATUS),
  result: storedChannelGenerationSchema.optional(),
  error: z.string().max(IMAGE_ATTEMPT_LIMITS.error).optional(),
});
export type ImageGenerationAttempt = z.infer<
  typeof imageGenerationAttemptSchema
>;
