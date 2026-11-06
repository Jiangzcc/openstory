import { describe, expect, it } from 'vitest';
import { imageConfigurationFixture } from './__tests__/image-model-fixture';
import {
  createImageModelRoutingSnapshot,
  imageChannelsConfigurationSchema,
} from './image-channels';
import { imageRoutingCapacityFixture } from './__tests__/image-routing-capacity-fixture';
import { DEFAULT_MODEL_CONFIGURATION } from './model-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
} from './model-runtime-configuration';
import {
  packWorkflowImageModelRouting,
  unpackWorkflowImageModelRouting,
  WORKFLOW_IMAGE_ROUTING_MAX_BYTES,
  WORKFLOW_IMAGE_ROUTING_SIZE_ERROR,
  workflowImageRoutingSnapshotBytes,
} from './workflow-image-model-routing';

describe('workflow image routing snapshots', () => {
  it('preserves exact bindings, parameters and USD prices across parent/child encoding', () => {
    const configuration = imageConfigurationFixture();
    const routing = createImageModelRoutingSnapshot(configuration);
    const packed = packModelRuntimeConfiguration({
      ...DEFAULT_MODEL_CONFIGURATION,
      imageModelRouting: routing,
    });
    expect(unpackModelRuntimeConfiguration(packed).imageModelRouting).toEqual(
      routing
    );
    const card = configuration.models[0]?.priceCards[0];
    if (!card) throw new Error('Missing mock price card.');
    card.unitPriceUsd = 99;
    expect(
      unpackModelRuntimeConfiguration(packed).imageModelRouting?.[0]
        ?.priceCards[0]?.unitPriceUsd
    ).toBe(0.1);
  });

  it('deduplicates channel details and rejects unknown snapshot versions', () => {
    const routing = createImageModelRoutingSnapshot(
      imageConfigurationFixture()
    );
    const packed = packWorkflowImageModelRouting([...routing, ...routing]);
    expect(packed.channels).toHaveLength(1);
    expect(packed.models).toHaveLength(2);
    expect(() =>
      unpackWorkflowImageModelRouting({ ...packed, version: 999 })
    ).toThrow('Invalid workflow image');
  });

  it('retains legacy payload behavior without image routing', () => {
    expect(
      unpackModelRuntimeConfiguration(DEFAULT_MODEL_CONFIGURATION)
    ).toEqual(DEFAULT_MODEL_CONFIGURATION);
    expect(
      packModelRuntimeConfiguration(DEFAULT_MODEL_CONFIGURATION)
    ).not.toHaveProperty('imageModelRouting');
  });
});

it('roundtrips built-in and custom bindings in version 2 without duplicating channels', () => {
  const configuration = imageConfigurationFixture();
  const custom = configuration.models[0];
  if (!custom) throw new Error('Missing mock model.');
  configuration.models.push({
    ...structuredClone(custom),
    id: 'gpt_image_2',
    name: 'Bound built-in mock',
  });
  const routing = createImageModelRoutingSnapshot(configuration);
  const packed = packWorkflowImageModelRouting(routing);
  expect(packed.version).toBe(2);
  expect(packed.channels).toHaveLength(1);
  expect(packed.models.map((model) => model.modelId)).toEqual([
    custom.id,
    'gpt_image_2',
  ]);
  expect(unpackWorkflowImageModelRouting(packed)).toEqual(routing);
});

it('reads stored custom-only version 1 and pre-codec array payloads', () => {
  const routing = createImageModelRoutingSnapshot(imageConfigurationFixture());
  const route = routing[0];
  if (!route) throw new Error('Missing mock route.');
  const {
    channelId,
    protocol,
    baseUrl,
    credentialId,
    description: _description,
    ...model
  } = route;
  expect(
    unpackWorkflowImageModelRouting({
      version: 1,
      channels: [{ channelId, protocol, baseUrl, credentialId }],
      models: [{ ...model, channelIndex: 0 }],
    })
  ).toEqual(routing);
  expect(unpackWorkflowImageModelRouting(routing)).toEqual(routing);
});

it('keeps captured built-in capabilities and bindings separate from later configuration edits', () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model?.operations.edit) throw new Error('Missing mock edit binding.');
  model.id = 'hidream_i1';
  const routing = createImageModelRoutingSnapshot(configuration);
  const packed = packWorkflowImageModelRouting(routing);
  model.operations.edit.upstreamModel = 'mock-rebound';
  model.operations.edit.status = 'unsupported';
  model.priceCards = [];
  expect(routing[0]?.operations.edit).toMatchObject({
    upstreamModel: 'mock-edit',
    status: 'verified',
  });
  expect(unpackWorkflowImageModelRouting(packed)[0]).toMatchObject({
    modelId: 'hidream_i1',
    operations: { edit: { upstreamModel: 'mock-edit', status: 'verified' } },
    priceCards: [{ unitPriceUsd: 0.1 }, { unitPriceUsd: 0.2 }],
  });
});

it('rejects invalid channel references rather than dropping built-in bindings', () => {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing mock model.');
  model.id = 'gpt_image_2';
  const routing = packWorkflowImageModelRouting(
    createImageModelRoutingSnapshot(configuration)
  );
  expect(() =>
    unpackWorkflowImageModelRouting({ ...routing, channels: [] })
  ).toThrow('Invalid workflow image');
});

it('deduplicates repeated parameter and price sets before the workflow payload grows past its budget', () => {
  const configuration = imageChannelsConfigurationSchema.parse(
    imageRoutingCapacityFixture(120)
  );
  const routing = createImageModelRoutingSnapshot(configuration);
  const packed = packWorkflowImageModelRouting(routing);
  expect(
    new TextEncoder().encode(JSON.stringify(configuration)).byteLength
  ).toBeGreaterThan(1024 * 1024);
  expect(packed.models).toHaveLength(120);
  expect(packed.parameterSets).toHaveLength(1);
  expect(packed.priceCardSets).toHaveLength(1);
  expect(workflowImageRoutingSnapshotBytes(routing)).toBeLessThan(
    WORKFLOW_IMAGE_ROUTING_MAX_BYTES
  );
  expect(unpackWorkflowImageModelRouting(packed)).toEqual(routing);
});

it('rejects distinct price dictionaries that exceed the reserved workflow snapshot budget', () => {
  const routing = createImageModelRoutingSnapshot(
    imageChannelsConfigurationSchema.parse(
      imageRoutingCapacityFixture(40, true)
    )
  );
  expect(workflowImageRoutingSnapshotBytes(routing)).toBeGreaterThan(
    WORKFLOW_IMAGE_ROUTING_MAX_BYTES
  );
  expect(() => packWorkflowImageModelRouting(routing)).toThrow(
    WORKFLOW_IMAGE_ROUTING_SIZE_ERROR
  );
});

it('rejects missing parameter or price dictionaries and invalid compact references', () => {
  const routing = packWorkflowImageModelRouting(
    createImageModelRoutingSnapshot(imageConfigurationFixture())
  );
  expect(() =>
    unpackWorkflowImageModelRouting({ ...routing, parameterSets: [] })
  ).toThrow('Invalid workflow image');
  expect(() =>
    unpackWorkflowImageModelRouting({ ...routing, priceCardSets: [] })
  ).toThrow('Invalid workflow image');
  const model = routing.models[0];
  if (!model) throw new Error('Missing mock compact image model.');
  expect(() =>
    unpackWorkflowImageModelRouting({
      ...routing,
      models: [{ ...model, channelIndex: -1 }],
    })
  ).toThrow('Invalid workflow image');
});
