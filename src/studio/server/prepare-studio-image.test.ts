import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micros } from '@/billing/money';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { studioCreateInputSchema } from '@/studio/schema';
import type { StudioCreateInput } from '@/studio/schema';
import { prepareStudioImage } from './prepare-studio-image';

// Synthetic channel configuration; no provider, wallet or storage calls.
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: mocks.load,
}));
const REFERENCE = 'https://example.test/mock-reference.png';
const MASK = 'https://example.test/mock-mask.png';
const EDIT_COST_MICROS = 200_000;
const NATIVE_COUNT = 3;
const STUDIO_COUNT = 2;
type ImageInput = Extract<StudioCreateInput, { activity: 'image' }>;
let configuration: ModelRuntimeConfiguration;

function imageInput(overrides: Partial<ImageInput> = {}): ImageInput {
  const input = studioCreateInputSchema.parse({
    activity: 'image',
    imageModel: 'custom-image:qwen',
    prompt: 'Synthetic Studio preparation',
    aspectRatio: '1:1',
    ...overrides,
  });
  if (input.activity !== 'image') throw new Error('Expected image fixture');
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  configuration = {
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    ),
  };
  mocks.load.mockResolvedValue(configuration);
});

describe('Studio image preparation', () => {
  it('leaves video preparation and configuration loading to the video owner', async () => {
    const input = studioCreateInputSchema.parse({
      activity: 'video',
      videoModel: 'seedance_v2',
      prompt: 'Synthetic video',
      aspectRatio: '16:9',
      duration: 5,
    });
    expect(await prepareStudioImage(input)).toBeUndefined();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('keeps an unbound builtin input and its captured configuration', async () => {
    const input = imageInput({ imageModel: 'gpt_image_2' });
    const result = await prepareStudioImage(input);
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(result?.modelConfiguration).toBe(configuration);
    expect(result?.configured).toBeUndefined();
    expect(result?.endpointId).toBeUndefined();
    expect(result?.modelName).toBeUndefined();
    expect(result?.input).toBe(input);
  });

  it('keeps the original builtin capability refusal', async () => {
    await expect(
      prepareStudioImage(
        imageInput({
          imageModel: 'hidream_i1',
          referenceImages: [REFERENCE],
        })
      )
    ).rejects.toThrow('does not take reference images');
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('refuses an unavailable custom route without using a builtin route', async () => {
    mocks.load.mockResolvedValue({ ...configuration, imageModelRouting: [] });
    await expect(prepareStudioImage(imageInput())).rejects.toThrow(
      'unavailable'
    );
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('prepares endpoint, exact quote and effective size from one captured image configuration', async () => {
    const input = imageInput({ aspectRatio: '16:9' });
    const result = await prepareStudioImage(input);
    expect(result?.endpointId).toBe('mock-generate');
    expect(result?.modelName).toBe('Configured Qwen');
    expect(result?.configured).toMatchObject({
      imageCount: 1,
      costMicros: micros(100_000),
      parameters: { size: '1024x576' },
      imageSource: 'platform',
    });
    expect(result?.configured?.modelConfiguration).toBe(
      result?.modelConfiguration
    );
    expect(result?.input.channelParameters).toEqual(
      result?.configured?.parameters
    );
    expect(input.channelParameters).toBeUndefined();
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('selects the edit endpoint and preserves mask/reference inputs and explicit parameters', async () => {
    const input = imageInput({
      referenceImages: [REFERENCE],
      maskImageUrl: MASK,
      channelParameters: { size: '1536x1024' },
    });
    const original = structuredClone(input);
    const result = await prepareStudioImage(input);
    expect(result?.endpointId).toBe('mock-edit');
    expect(result?.configured?.costMicros).toBe(micros(EDIT_COST_MICROS));
    expect(result?.input).toEqual(original);
    expect(input).toEqual(original);
    expect(result?.input).not.toBe(input);
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('uses the configured route when an administrator binds a builtin', async () => {
    const channels = imageConfigurationFixture();
    const model = channels.models[0];
    if (!model) throw new Error('Missing synthetic image binding');
    model.id = 'hidream_i1';
    configuration.imageModelRouting = createImageModelRoutingSnapshot(channels);
    const result = await prepareStudioImage(
      imageInput({
        imageModel: 'hidream_i1',
        referenceImages: [REFERENCE],
        maskImageUrl: MASK,
      })
    );
    expect(result?.endpointId).toBe('mock-edit');
    expect(result?.input.imageModel).toBe('hidream_i1');
    expect(result?.configured?.costMicros).toBe(micros(EDIT_COST_MICROS));
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('keeps native output count separate from the number of Studio rows', async () => {
    const channels = imageConfigurationFixture();
    const model = channels.models[0];
    if (!model) throw new Error('Missing synthetic image binding');
    model.parameters.push({
      key: 'n',
      label: 'Outputs',
      type: 'integer',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: false,
      minimum: 1,
      maximum: NATIVE_COUNT,
    });
    configuration.imageModelRouting = createImageModelRoutingSnapshot(channels);
    const result = await prepareStudioImage(
      imageInput({
        count: STUDIO_COUNT,
        channelParameters: { n: NATIVE_COUNT },
      })
    );
    expect(result?.input.count).toBe(STUDIO_COUNT);
    expect(result?.input.channelParameters?.n).toBe(NATIVE_COUNT);
    expect(result?.configured?.imageCount).toBe(NATIVE_COUNT);
    expect(result?.configured?.costMicros).toBe(micros(300_000));
  });
});
