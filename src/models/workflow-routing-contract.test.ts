import { describe, expect, it } from 'vitest';
import { imageConfigurationFixture } from './__tests__/image-model-fixture';
import {
  IMAGE_PARAMETER_LIMITS,
  imageChannelParametersSchema,
} from './image-channel-parameters';
import type {
  ImageModelRoute,
  ImageModelRoutingSnapshot,
} from './image-channels';
import { createImageModelRoutingSnapshot } from './image-channels';
import { DEFAULT_MODEL_CONFIGURATION } from './model-configuration';
import type {
  ModelRuntimeConfiguration,
  WorkflowModelConfiguration,
} from './model-runtime-configuration';
import {
  packModelRuntimeConfiguration,
  unpackModelRuntimeConfiguration,
} from './model-runtime-configuration';
import type { TextModelRoute } from './text-channels';
import { TEXT_CHANNEL_PROTOCOLS } from './text-channels';
import type { WorkflowImageModelRoutingSnapshot } from './workflow-image-model-routing';
import {
  packWorkflowImageModelRouting,
  WORKFLOW_IMAGE_ROUTING_MAX_BYTES,
  WORKFLOW_IMAGE_ROUTING_SIZE_ERROR,
  workflowImageRoutingSnapshotBytes,
} from './workflow-image-model-routing';
import type { WorkflowTextModelRoutingSnapshot } from './workflow-text-model-routing';
import {
  packWorkflowTextModelRouting,
  unpackWorkflowTextModelRouting,
} from './workflow-text-model-routing';

const IMAGE_WIRE_BUDGET = 256 * 1024;
const LEGACY_IMAGE_VERSION = 1;
const PACKED_IMAGE_VERSION = 2;
const UTF8_PADDING_CHARACTER = '模';
const UTF8_PADDING_BYTES = new TextEncoder().encode(
  UTF8_PADDING_CHARACTER
).byteLength;

// Synthetic codec fixtures only; .invalid endpoints and credentials never reach a provider.
function mockTextRoute(
  overrides: Partial<TextModelRoute> = {}
): TextModelRoute {
  return {
    modelId: 'custom:mock-codec',
    name: 'Mock 同名模型 🧪',
    upstreamModel: 'mock-shared-upstream',
    channelId: 'mock-channel',
    protocol: TEXT_CHANNEL_PROTOCOLS.responses,
    baseUrl: 'https://mock.invalid/v1',
    credentialId: 'mock-credential',
    userAgent: 'MockCodec/1.0 (G02)',
    vision: true,
    structuredOutput: false,
    tools: false,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0.125,
    description: 'Mock request-side description',
    vendor: 'Mock request-side vendor',
    ...overrides,
  };
}

function textExecutionFields(route: TextModelRoute) {
  const { description: _description, vendor: _vendor, ...execution } = route;
  return execution;
}

function mockImageRoute(): ImageModelRoute {
  const [route] = createImageModelRoutingSnapshot(imageConfigurationFixture());
  if (!route) throw new Error('Missing mock image route.');
  return {
    ...route,
    name: 'Mock 图像模型 🧪',
    baseUrl: 'https://mock-image.invalid/v1',
    parameters: [
      ...route.parameters,
      {
        key: 'mock_strength',
        label: 'Mock strength',
        type: 'number',
        status: 'verified',
        operations: ['generate', 'edit'],
        required: false,
        defaultValue: 0,
        minimum: 0,
        maximum: 1,
      },
      {
        key: 'mock_watermark',
        label: 'Mock watermark',
        type: 'boolean',
        status: 'verified',
        operations: ['generate', 'edit'],
        required: false,
        defaultValue: false,
        values: [false, true],
      },
    ],
    priceCards: [
      { id: 'generate', operation: 'generate', match: {}, unitPriceUsd: 0 },
      {
        id: 'edit',
        operation: 'edit',
        match: { mock_strength: 0, mock_watermark: false },
        unitPriceUsd: 0.125,
      },
    ],
  };
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function decodeJsonConfiguration(
  configuration: WorkflowModelConfiguration
): ModelRuntimeConfiguration {
  const queued: WorkflowModelConfiguration = JSON.parse(
    JSON.stringify(configuration)
  );
  return unpackModelRuntimeConfiguration(queued);
}

function mockImageRoutingAtBytes(
  targetBytes: number
): ImageModelRoutingSnapshot {
  const route = mockImageRoute();
  const padding: ImageModelRoute['parameters'][number] = {
    key: 'mock_preset',
    label: 'Mock UTF-8 boundary',
    type: 'string',
    status: 'verified',
    operations: ['generate', 'edit'],
    required: false,
    values: Array.from(
      { length: IMAGE_PARAMETER_LIMITS.values },
      (_, index) => 'mock-' + index + ':模🧪"\\\n'
    ),
  };
  route.parameters.push(padding);
  const extraBytes =
    targetBytes - serializedBytes(packWorkflowImageModelRouting([route]));
  const characterCount = Math.floor(extraBytes / UTF8_PADDING_BYTES);
  const charactersPerValue = Math.floor(
    characterCount / IMAGE_PARAMETER_LIMITS.values
  );
  const remainingCharacters = characterCount % IMAGE_PARAMETER_LIMITS.values;
  padding.values = padding.values?.map(
    (value, index) =>
      value +
      UTF8_PADDING_CHARACTER.repeat(
        charactersPerValue + (index < remainingCharacters ? 1 : 0)
      ) +
      (index === 0 ? 'x'.repeat(extraBytes % UTF8_PADDING_BYTES) : '')
  );
  route.parameters = imageChannelParametersSchema.parse(route.parameters);
  return [route];
}

describe('workflow routing JSON wire contract', () => {
  it('replays both codecs together with every execution field, zero rate and falsy parameter intact', () => {
    const text = mockTextRoute();
    const image = mockImageRoute();
    const configuration: ModelRuntimeConfiguration = {
      ...DEFAULT_MODEL_CONFIGURATION,
      defaultAnalysis: text.modelId,
      defaultImage: image.modelId,
      textModelRouting: [text],
      imageModelRouting: [image],
    };
    expect(
      decodeJsonConfiguration(packModelRuntimeConfiguration(configuration))
    ).toStrictEqual({
      ...configuration,
      textModelRouting: [textExecutionFields(text)],
    });
  });

  it('keeps each channel identity for identically named and identified synthetic text routes', () => {
    const original = mockTextRoute();
    const { userAgent: _userAgent, ...withoutUserAgent } = original;
    const alternatives: Partial<TextModelRoute>[] = [
      { channelId: 'mock-channel-2' },
      { protocol: TEXT_CHANNEL_PROTOCOLS.chatCompletions },
      { baseUrl: 'https://mock.invalid/v2' },
      { credentialId: 'mock-credential-2' },
      { userAgent: 'MockCodec/2.0 (G02)' },
      { userAgent: '' },
    ];
    const routes = [
      original,
      ...alternatives.map((identity) => mockTextRoute(identity)),
      withoutUserAgent,
      mockTextRoute({ vision: false, tools: true, inputPricePerMillion: 0.5 }),
    ];
    const packed = packWorkflowTextModelRouting(routes);
    const queued: WorkflowTextModelRoutingSnapshot = JSON.parse(
      JSON.stringify(packed)
    );
    expect(packed.channels).toHaveLength(routes.length - 1);
    expect(packed.models.map((model) => model.channelIndex)).toEqual([
      ...routes.slice(0, -1).map((_, index) => index),
      0,
    ]);
    expect(unpackWorkflowTextModelRouting(queued)).toStrictEqual(
      routes.map(textExecutionFields)
    );
  });

  it('decodes stored image v1 JSON alongside pre-codec text arrays', () => {
    const image = mockImageRoute();
    const { channelId, protocol, baseUrl, credentialId, ...binding } = image;
    const legacy: WorkflowImageModelRoutingSnapshot = {
      version: LEGACY_IMAGE_VERSION,
      channels: [{ channelId, protocol, baseUrl, credentialId }],
      models: [{ ...binding, channelIndex: 0 }],
    };
    const text = mockTextRoute();
    expect(
      decodeJsonConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: [text],
        imageModelRouting: legacy,
      })
    ).toStrictEqual({
      ...DEFAULT_MODEL_CONFIGURATION,
      textModelRouting: [text],
      imageModelRouting: [image],
    });
  });

  it('decodes pre-codec image arrays alongside compact text JSON', () => {
    const text = mockTextRoute();
    const image = mockImageRoute();
    expect(
      decodeJsonConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        textModelRouting: packWorkflowTextModelRouting([text]),
        imageModelRouting: [image],
      })
    ).toStrictEqual({
      ...DEFAULT_MODEL_CONFIGURATION,
      textModelRouting: [textExecutionFields(text)],
      imageModelRouting: [image],
    });
  });

  it.each([
    {
      name: 'both undefined',
      routing: { textModelRouting: undefined, imageModelRouting: undefined },
      expected: {},
    },
    {
      name: 'empty text and undefined images',
      routing: { textModelRouting: [], imageModelRouting: undefined },
      expected: { textModelRouting: [] },
    },
    {
      name: 'undefined text and empty images',
      routing: { textModelRouting: undefined, imageModelRouting: [] },
      expected: { imageModelRouting: [] },
    },
    {
      name: 'both explicitly empty',
      routing: { textModelRouting: [], imageModelRouting: [] },
      expected: { textModelRouting: [], imageModelRouting: [] },
    },
  ])(
    'keeps omission distinct from empty routes: $name',
    ({ routing, expected }) => {
      const configuration = { ...DEFAULT_MODEL_CONFIGURATION, ...routing };
      const packed = packModelRuntimeConfiguration(configuration);
      for (const key of ['textModelRouting', 'imageModelRouting']) {
        expect(Object.hasOwn(packed, key)).toBe(Object.hasOwn(expected, key));
      }
      const replayed = { ...DEFAULT_MODEL_CONFIGURATION, ...expected };
      expect(unpackModelRuntimeConfiguration(configuration)).toStrictEqual(
        replayed
      );
      expect(decodeJsonConfiguration(packed)).toStrictEqual(replayed);
    }
  );
});

describe('image v2 UTF-8 admission contract', () => {
  it.each([IMAGE_WIRE_BUDGET - 1, IMAGE_WIRE_BUDGET])(
    'admits and fully replays a valid %i-byte snapshot without truncation',
    (targetBytes) => {
      const routing = mockImageRoutingAtBytes(targetBytes);
      const packed = packWorkflowImageModelRouting(routing);
      const wire = JSON.stringify(packed);
      expect(WORKFLOW_IMAGE_ROUTING_MAX_BYTES).toBe(IMAGE_WIRE_BUDGET);
      expect(packed.version).toBe(PACKED_IMAGE_VERSION);
      expect(wire.length).toBeLessThan(targetBytes);
      expect(new TextEncoder().encode(wire).byteLength).toBe(targetBytes);
      expect(workflowImageRoutingSnapshotBytes(routing)).toBe(targetBytes);
      expect(
        decodeJsonConfiguration({
          ...DEFAULT_MODEL_CONFIGURATION,
          imageModelRouting: packed,
        }).imageModelRouting
      ).toStrictEqual(routing);
    }
  );

  it('rejects one byte over budget when a UTF-8 character crosses the boundary, without pruning input', () => {
    const routing = mockImageRoutingAtBytes(
      IMAGE_WIRE_BUDGET - UTF8_PADDING_BYTES + 1
    );
    const admitted = packWorkflowImageModelRouting(routing);
    const oversized = routing.map((route) => ({
      ...route,
      name: route.name + UTF8_PADDING_CHARACTER,
    }));
    const oversizedWire = {
      ...admitted,
      models: admitted.models.map((model) => ({
        ...model,
        name: model.name + UTF8_PADDING_CHARACTER,
      })),
    };
    const before = structuredClone(oversized);
    expect(JSON.stringify(oversizedWire).length).toBeLessThan(
      IMAGE_WIRE_BUDGET
    );
    expect(serializedBytes(oversizedWire)).toBe(IMAGE_WIRE_BUDGET + 1);
    expect(workflowImageRoutingSnapshotBytes(oversized)).toBe(
      IMAGE_WIRE_BUDGET + 1
    );
    expect(() => packWorkflowImageModelRouting(oversized)).toThrow(
      WORKFLOW_IMAGE_ROUTING_SIZE_ERROR
    );
    expect(() =>
      packModelRuntimeConfiguration({
        ...DEFAULT_MODEL_CONFIGURATION,
        imageModelRouting: oversized,
      })
    ).toThrow(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR);
    expect(oversized).toStrictEqual(before);
  });
});
