import { describe, expect, it } from 'vitest';
import { imageCatalogFixture } from './__tests__/image-model-fixture';
import { resolveConfiguredImageParameters } from './configured-image-request';

describe('configured image parameter resolution', () => {
  it('quotes and generates the same verified size for an aspect ratio', () => {
    const definitions = imageCatalogFixture().parameters;
    expect(
      resolveConfiguredImageParameters(definitions, 'generate', {
        aspectRatio: '16:9',
      })
    ).toEqual({ size: '1024x576' });
    expect(
      resolveConfiguredImageParameters(definitions, 'edit', {
        aspectRatio: '9:16',
      })
    ).toEqual({ size: '576x1024' });
  });

  it('honors an explicit parameter selection and refuses unknown native multi-image requests', () => {
    const definitions = imageCatalogFixture().parameters;
    expect(
      resolveConfiguredImageParameters(definitions, 'generate', {
        aspectRatio: '16:9',
        parameters: { size: '512x512' },
      })
    ).toEqual({ size: '512x512' });
    expect(() =>
      resolveConfiguredImageParameters(definitions, 'generate', {
        imageCount: 2,
      })
    ).toThrow('native image count');
  });

  it('does not silently substitute a square for a requested landscape', () => {
    const definitions = imageCatalogFixture().parameters.map((parameter) => ({
      ...parameter,
      values: ['512x512'],
      defaultValue: '512x512',
    }));
    expect(() =>
      resolveConfiguredImageParameters(definitions, 'generate', {
        aspectRatio: '16:9',
      })
    ).toThrow('aspect ratio');
    const automatic = definitions.map((parameter) => ({
      ...parameter,
      values: ['auto'],
      defaultValue: 'auto',
    }));
    expect(
      resolveConfiguredImageParameters(automatic, 'generate', {
        aspectRatio: '16:9',
      })
    ).toEqual({ size: 'auto' });
  });
});

it('refuses a fixed size that cannot fit the decode budget before quoting', () => {
  const definitions = imageCatalogFixture().parameters.map((parameter) => ({
    ...parameter,
    values: ['4096x4096'],
    defaultValue: '4096x4096',
  }));
  expect(() =>
    resolveConfiguredImageParameters(definitions, 'generate')
  ).toThrow('supported resource limits');
});
