import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageModelDefinition } from '@/models/image-model-catalog';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import { AspectRatioPills } from '@/ui/settings/aspect-ratio-pills';
import { ConfiguredImageControls } from './configured-image-controls';
import { readStoredStudioImageSettings } from './configured-image-settings';
import { useConfiguredImageControls } from './use-configured-image-controls';

type Controls = ReturnType<typeof useConfiguredImageControls>;
type Input = Parameters<typeof useConfiguredImageControls>[0];
type Step = { input?: Partial<Input>; action?: (controls: Controls) => void };
const mocks = vi.hoisted(() => {
  const models: ImageModelDefinition[] = [];
  return { models, upload: vi.fn() };
});

// Catalog, translation and uploads are mocks; React state and parameter resolution execute.
vi.mock('@/models/ui/use-image-model-catalog', () => ({
  useImageModelCatalog: () => ({ models: mocks.models }),
}));
vi.mock('@/platform/ui/auth/auth-gate-provider', () => ({
  useAuthGate: () => ({ requireAuth: (action: () => void) => action() }),
}));
vi.mock('./use-studio-assets', () => ({
  studioUploadKeys: { all: ['mock-studio-uploads'] },
  useUploadStudioMedia: () => ({ mutateAsync: mocks.upload, isPending: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelId = 'gpt_image_2';
const otherModelId = 'custom-image:other';
const clients: QueryClient[] = [];

function Scenario({
  steps,
  snapshots,
}: {
  steps: Step[];
  snapshots: Controls[];
}) {
  const [index, advance] = useState(0);
  const step = steps[index];
  if (!step) throw new Error('Missing synthetic scenario step.');
  const controls = useConfiguredImageControls({
    modelId,
    aspectRatio: '16:9',
    resolution: '720p',
    referenceCount: 1,
    totalImageCount: 1,
    ...step.input,
  });
  snapshots.push(controls);
  if (index < steps.length - 1) {
    step.action?.(controls);
    advance(index + 1);
  }
  return null;
}

function runScenario(steps: Step[]) {
  const client = new QueryClient();
  clients.push(client);
  const snapshots: Controls[] = [];
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Scenario steps={steps} snapshots={snapshots} />
    </QueryClientProvider>
  );
  return snapshots;
}

beforeEach(() => {
  const model = imageCatalogFixture({ id: modelId });
  model.parameters[0] = {
    key: 'size',
    label: 'Size',
    type: 'string',
    status: 'verified',
    operations: ['generate', 'edit'],
    required: true,
    defaultValue: '1024x1024',
    values: ['1280x720', '1920x1080', '720x1280', '1024x1024'],
  };
  model.parameters.push(
    {
      key: 'n',
      label: 'Count',
      type: 'integer',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      minimum: 1,
      maximum: 16,
      defaultValue: 4,
    },
    {
      key: 'quality',
      label: 'Quality',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      defaultValue: 'high',
    }
  );
  mocks.models = mergeImageModelCatalog([
    model,
    { ...model, id: otherModelId },
  ]);
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  expect(mocks.upload).not.toHaveBeenCalled();
  vi.clearAllMocks();
});

const restoreMask = (controls: Controls) =>
  controls.restore({
    modelId,
    referenceCount: 1,
    maskImageUrl: '/r2/mock-mask.png',
  });

describe('Studio image controls state', () => {
  it('keeps masks blocked when a binding is disabled, then clears them on reset', () => {
    const snapshots = runScenario([
      { action: restoreMask },
      {
        action: () => {
          mocks.models = mergeImageModelCatalog();
        },
      },
      { action: (controls) => controls.reset() },
      {},
    ]);
    expect(snapshots[1]?.issue).toBeNull();
    expect(snapshots[2]?.model?.source).toBe('builtin');
    expect(snapshots[2]?.issue?.key).toBe(
      'Configured image parameters are unavailable for this operation.'
    );
    expect(snapshots[3]?.issue).toBeNull();
    expect(snapshots[3]?.maskInput).toBe('');
  });

  it('restores historical total quantity without resurrecting size or hidden defaults', () => {
    const stored = readStoredStudioImageSettings({
      count: 2,
      channelParameters: { n: 2, size: '1024x1024', quality: 'old-quality' },
      maskImageUrl: '/r2/mock-mask.png',
    });
    const snapshots = runScenario([
      {
        action: (controls) =>
          controls.restore({ ...stored, modelId, referenceCount: 1 }),
      },
      {
        input: {
          totalImageCount: stored.totalImageCount,
          aspectRatio: '16:9',
          resolution: '1080p',
        },
      },
    ]);
    expect(snapshots[1]?.totalImageCount).toBe(4);
    expect(snapshots[1]?.requestCount).toBe(4);
    expect(snapshots[1]?.parameters).toMatchObject({
      n: 1,
      size: '1920x1080',
      quality: 'high',
    });
    expect(snapshots[1]?.requestParameters).toEqual({ n: 1 });
    expect(snapshots[1]?.maskImageUrl).toBe('/r2/mock-mask.png');
    expect(snapshots[1]?.issue).toBeNull();
  });

  it('uses the current catalog defaults after a refresh', () => {
    const snapshots = runScenario([
      {
        action: () => {
          mocks.models = mocks.models.map((model) =>
            model.source === 'configured'
              ? {
                  ...model,
                  configuration: {
                    ...model.configuration,
                    parameters: model.configuration.parameters.map((field) =>
                      field.key === 'quality'
                        ? { ...field, defaultValue: 'low' }
                        : field
                    ),
                  },
                }
              : model
          );
        },
      },
      {},
    ]);
    expect(snapshots[0]?.parameters.quality).toBe('high');
    expect(snapshots[1]?.parameters.quality).toBe('low');
    expect(snapshots[1]?.issue).toBeNull();
  });

  it('keeps masks scoped to their model and clears every model on reset', () => {
    const snapshots = runScenario([
      { action: restoreMask },
      {
        input: { modelId: otherModelId },
        action: (controls) => controls.setMaskImageUrl('/r2/other-mask.png'),
      },
      { action: (controls) => controls.reset() },
      { input: { modelId: otherModelId } },
      {},
    ]);
    expect(snapshots[1]?.maskInput).toBe('');
    expect(snapshots[2]?.maskInput).toBe('/r2/mock-mask.png');
    expect(snapshots[3]?.maskInput).toBe('');
    expect(snapshots[4]?.maskInput).toBe('');
  });

  it('recomputes size and quote when the operation changes', () => {
    const model = imageCatalogFixture({ id: modelId });
    model.parameters = [
      {
        key: 'size',
        label: 'Size',
        type: 'string',
        status: 'verified',
        operations: ['generate'],
        required: true,
        values: ['1280x720'],
        defaultValue: '1280x720',
      },
      {
        key: 'size',
        label: 'Size',
        type: 'string',
        status: 'verified',
        operations: ['edit'],
        required: true,
        values: ['720x720'],
        defaultValue: '720x720',
      },
    ];
    mocks.models = mergeImageModelCatalog([model]);
    const snapshots = runScenario([{ input: { referenceCount: 0 } }, {}]);
    expect(snapshots[0]?.outputOptions.aspectRatios).toEqual(['16:9']);
    expect(snapshots[0]?.parameters.size).toBe('1280x720');
    expect(snapshots[0]?.quote?.unitPriceUsd).toBe(0.1);
    expect(snapshots[1]?.outputOptions.aspectRatios).toEqual(['1:1']);
    expect(snapshots[1]?.parameters.size).toBe('720x720');
    expect(snapshots[1]?.quote?.unitPriceUsd).toBe(0.2);
  });

  it('clears mask validation errors together with the masks', () => {
    const snapshots = runScenario([
      {
        action: (controls) =>
          controls.chooseMaskFile(
            new File(['mock'], 'mock-mask.jpg', { type: 'image/jpeg' })
          ),
      },
      { action: (controls) => controls.reset() },
      {},
    ]);
    expect(snapshots[1]?.issue?.key).toBe('Choose a PNG file for the mask.');
    expect(snapshots[2]?.issue).toBeNull();
    expect(snapshots[2]?.maskInput).toBe('');
  });

  it('removes invalid stored mask feedback when the user corrects the URL', () => {
    const stored = readStoredStudioImageSettings({ maskImageUrl: 7 });
    const snapshots = runScenario([
      {
        action: (controls) =>
          controls.restore({ ...stored, modelId, referenceCount: 1 }),
      },
      {
        action: (controls) =>
          controls.setMaskImageUrl('/r2/corrected-mask.png'),
      },
      {},
    ]);
    expect(snapshots[1]?.issue?.key).toBe('Enter a valid mask image URL.');
    expect(snapshots[2]?.issue).toBeNull();
    expect(snapshots[2]?.maskImageUrl).toBe('/r2/corrected-mask.png');
  });
});

describe('Configured image controls markup', () => {
  it('retains mask upload and URL input without exposing scalar or advanced controls', () => {
    const [controls] = runScenario([{}]);
    if (!controls) throw new Error('Missing synthetic controls.');
    const markup = renderToStaticMarkup(
      <ConfiguredImageControls controls={controls} formId="mock-composer" />
    );
    expect(markup).toContain('Upload PNG mask');
    expect(markup).toContain('name="maskImageUrl"');
    expect(markup).not.toContain('name="size"');
    expect(markup).not.toContain('name="quality"');
    expect(markup).not.toContain('name="n"');
    expect(markup).not.toContain('Image parameters');
  });

  it('does not render an empty advanced section for generation without a mask', () => {
    const [controls] = runScenario([{ input: { referenceCount: 0 } }]);
    if (!controls) throw new Error('Missing synthetic controls.');
    expect(
      renderToStaticMarkup(
        <ConfiguredImageControls controls={controls} formId="mock-composer" />
      )
    ).toBe('');
  });

  it('narrows aspect-ratio pills and shows a fixed ratio as explanatory text', () => {
    const markup = renderToStaticMarkup(
      <AspectRatioPills value="1:1" available={['1:1']} onChange={() => {}} />
    );
    expect(markup).toContain('1:1');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('16:9');
    const choices = renderToStaticMarkup(
      <AspectRatioPills
        value="16:9"
        available={['16:9', '1:1']}
        onChange={() => {}}
      />
    );
    expect(choices).toContain('16:9');
    expect(choices).toContain('1:1');
    expect(choices).not.toContain('9:16');
  });

  it('keeps all original aspect-ratio choices for existing callers', () => {
    const markup = renderToStaticMarkup(
      <AspectRatioPills value="16:9" onChange={() => {}} />
    );
    expect(markup).toContain('16:9');
    expect(markup).toContain('9:16');
    expect(markup).toContain('1:1');
  });
});
