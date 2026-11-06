import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { IMAGE_MODELS } from './models';
import type { TextToImageModel } from './models';
import { imageModelIdSchema } from './image-model-schema';
import {
  regenerateShotSchema,
  generateVariantSchema,
} from '@/shots/server/shot.schemas';

describe('shared image model input schema', () => {
  it('keeps the output type as the explicit built-in and configured identity union', () => {
    expectTypeOf<
      z.output<typeof imageModelIdSchema>
    >().toEqualTypeOf<TextToImageModel>();
    for (const id of Object.keys(IMAGE_MODELS))
      expect(imageModelIdSchema.parse(id)).toBe(id);
    expect(imageModelIdSchema.parse('custom-image:qwen')).toBe(
      'custom-image:qwen'
    );
  });

  it('rejects malformed and arbitrary identifiers without replacing them with a default', () => {
    for (const id of [
      '',
      'missing',
      'custom-image:',
      'custom-image:bad key',
      '__proto__',
      'custom-image:' + 'x'.repeat(200),
    ])
      expect(imageModelIdSchema.safeParse(id).success).toBe(false);
  });

  it('remains serializable for OpenAPI and MCP tool input schemas', () => {
    const jsonSchema = z.toJSONSchema(imageModelIdSchema);
    expect(JSON.stringify(jsonSchema)).toContain('custom-image:');
    expect(JSON.stringify(jsonSchema)).toContain('gpt_image_2');
    expect(() => z.toJSONSchema(regenerateShotSchema)).not.toThrow();
    expect(() => z.toJSONSchema(generateVariantSchema)).not.toThrow();
  });

  it('accepts configured identities for shot redraws and variants', () => {
    expect(
      regenerateShotSchema.parse({ model: 'custom-image:qwen-edit' }).model
    ).toBe('custom-image:qwen-edit');
    expect(
      generateVariantSchema.parse({ model: 'custom-image:qwen' }).model
    ).toBe('custom-image:qwen');
    expect(regenerateShotSchema.safeParse({ model: 'unknown' }).success).toBe(
      false
    );
  });
});
