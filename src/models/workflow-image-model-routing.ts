import type {
  ImageModelRoute,
  ImageModelRoutingSnapshot,
} from './image-channels';

const WORKFLOW_IMAGE_ROUTING_VERSION = 2;
const LEGACY_WORKFLOW_IMAGE_ROUTING_VERSION = 1;
const INVALID_SNAPSHOT = 'Invalid workflow image model routing snapshot.';
export const WORKFLOW_IMAGE_ROUTING_MAX_BYTES = 256 * 1024;
export const WORKFLOW_IMAGE_ROUTING_SIZE_ERROR =
  'Image channel settings exceed the workflow snapshot size limit.';
type WorkflowImageChannel = Pick<
  ImageModelRoute,
  'channelId' | 'protocol' | 'baseUrl' | 'credentialId'
>;
type WorkflowImageModel = Omit<
  ImageModelRoute,
  keyof WorkflowImageChannel | 'description'
> & { channelIndex: number };
type PackedImageModel = Omit<
  WorkflowImageModel,
  'parameters' | 'priceCards'
> & { parameterSetIndex: number; priceCardSetIndex: number };
type ParameterSet = ImageModelRoute['parameters'];
type PriceCardSet = ImageModelRoute['priceCards'];
export type WorkflowImageModelRoutingSnapshot = Readonly<{
  version: number;
  channels: readonly WorkflowImageChannel[];
  models: readonly (WorkflowImageModel | PackedImageModel)[];
  parameterSets?: readonly ParameterSet[];
  priceCardSets?: readonly PriceCardSet[];
}>;
export type WorkflowImageModelRouting =
  | ImageModelRoutingSnapshot
  | WorkflowImageModelRoutingSnapshot;
type RoutingDictionaries = {
  channels: WorkflowImageChannel[];
  parameters: ParameterSet[];
  prices: PriceCardSet[];
  channelIndices: Map<string, number>;
  parameterIndices: Map<string, number>;
  priceIndices: Map<string, number>;
};

function dictionaryIndex<T>(
  value: T,
  rows: T[],
  indices: Map<string, number>
): number {
  const identity = JSON.stringify(value);
  const previous = indices.get(identity);
  if (previous !== undefined) return previous;
  const index = rows.length;
  rows.push(structuredClone(value));
  indices.set(identity, index);
  return index;
}

function packImageModel(
  route: ImageModelRoute,
  dictionaries: RoutingDictionaries
): PackedImageModel {
  const {
    channelId,
    protocol,
    baseUrl,
    credentialId,
    description: _description,
    parameters,
    priceCards,
    ...model
  } = route;
  return Object.freeze(
    structuredClone({
      ...model,
      channelIndex: dictionaryIndex(
        { channelId, protocol, baseUrl, credentialId },
        dictionaries.channels,
        dictionaries.channelIndices
      ),
      parameterSetIndex: dictionaryIndex(
        parameters,
        dictionaries.parameters,
        dictionaries.parameterIndices
      ),
      priceCardSetIndex: dictionaryIndex(
        priceCards,
        dictionaries.prices,
        dictionaries.priceIndices
      ),
    })
  );
}

function createPackedRouting(
  routing: ImageModelRoutingSnapshot
): WorkflowImageModelRoutingSnapshot {
  const dictionaries: RoutingDictionaries = {
    channels: [],
    parameters: [],
    prices: [],
    channelIndices: new Map(),
    parameterIndices: new Map(),
    priceIndices: new Map(),
  };
  const models = routing.map((route) => packImageModel(route, dictionaries));
  return Object.freeze({
    version: WORKFLOW_IMAGE_ROUTING_VERSION,
    channels: Object.freeze(dictionaries.channels),
    models: Object.freeze(models),
    parameterSets: Object.freeze(dictionaries.parameters),
    priceCardSets: Object.freeze(dictionaries.prices),
  });
}

function snapshotBytes(snapshot: WorkflowImageModelRoutingSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}

export function workflowImageRoutingSnapshotBytes(
  routing: ImageModelRoutingSnapshot
): number {
  return snapshotBytes(createPackedRouting(routing));
}

export function packWorkflowImageModelRouting(
  routing: ImageModelRoutingSnapshot
): WorkflowImageModelRoutingSnapshot {
  const snapshot = createPackedRouting(routing);
  if (snapshotBytes(snapshot) > WORKFLOW_IMAGE_ROUTING_MAX_BYTES)
    throw new Error(WORKFLOW_IMAGE_ROUTING_SIZE_ERROR);
  return snapshot;
}

function dictionaryValue<T>(rows: readonly T[] | undefined, index: number): T {
  const value = rows?.[index];
  if (!Number.isInteger(index) || index < 0 || value === undefined)
    throw new Error(INVALID_SNAPSHOT);
  return value;
}

function restoreImageModel(
  model: WorkflowImageModel | PackedImageModel,
  routing: WorkflowImageModelRoutingSnapshot
) {
  if ('parameters' in model) {
    if (routing.version !== LEGACY_WORKFLOW_IMAGE_ROUTING_VERSION)
      throw new Error(INVALID_SNAPSHOT);
    const { channelIndex: _channelIndex, ...binding } = model;
    return binding;
  }
  if (routing.version !== WORKFLOW_IMAGE_ROUTING_VERSION)
    throw new Error(INVALID_SNAPSHOT);
  const {
    channelIndex: _channelIndex,
    parameterSetIndex,
    priceCardSetIndex,
    ...binding
  } = model;
  return {
    ...binding,
    parameters: dictionaryValue(routing.parameterSets, parameterSetIndex),
    priceCards: dictionaryValue(routing.priceCardSets, priceCardSetIndex),
  };
}

export function unpackWorkflowImageModelRouting(
  routing: WorkflowImageModelRouting
): ImageModelRoutingSnapshot {
  if (isLegacyImageRouting(routing)) return routing;
  if (
    routing.version !== WORKFLOW_IMAGE_ROUTING_VERSION &&
    routing.version !== LEGACY_WORKFLOW_IMAGE_ROUTING_VERSION
  )
    throw new Error(INVALID_SNAPSHOT);
  return Object.freeze(
    routing.models.map((model) =>
      Object.freeze(
        structuredClone({
          ...restoreImageModel(model, routing),
          ...dictionaryValue(routing.channels, model.channelIndex),
        })
      )
    )
  );
}

function isLegacyImageRouting(
  routing: WorkflowImageModelRouting
): routing is ImageModelRoutingSnapshot {
  return Array.isArray(routing);
}
