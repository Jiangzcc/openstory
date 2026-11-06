import { z } from 'zod';
import { typedEntries } from '@/platform/typed-object';
import { IMAGE_MODELS } from './models';
import { isConfiguredImageModelId } from './image-channels';

const builtinImageModelSchema = z.enum(
  typedEntries(IMAGE_MODELS).map(([key]) => key)
);
const configuredImageModelSchema = z
  .templateLiteral(['custom-image:', z.string()])
  .refine(isConfiguredImageModelId, 'Invalid image model');

export const imageModelIdSchema = z.union([
  builtinImageModelSchema,
  configuredImageModelSchema,
]);
