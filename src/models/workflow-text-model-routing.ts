import type { TextModelRoute, TextModelRoutingSnapshot } from './text-channels';

const WORKFLOW_ROUTING_VERSION = 1;
const INVALID_SNAPSHOT = 'Invalid workflow text model routing snapshot.';

type WorkflowTextChannel = Readonly<
  Pick<TextModelRoute, 'channelId' | 'protocol' | 'baseUrl' | 'credentialId'>
>;

type WorkflowTextModel = Readonly<
  Omit<TextModelRoute, keyof WorkflowTextChannel | 'description' | 'vendor'> & {
    channelIndex: number;
  }
>;

export type WorkflowTextModelRoutingSnapshot = Readonly<{
  version: number;
  channels: readonly WorkflowTextChannel[];
  models: readonly WorkflowTextModel[];
}>;

export type WorkflowTextModelRouting =
  | TextModelRoutingSnapshot
  | WorkflowTextModelRoutingSnapshot;

function channelIndexFor(
  route: TextModelRoute,
  channels: WorkflowTextChannel[],
  indices: Map<string, number>
): number {
  const channel = Object.freeze({
    channelId: route.channelId,
    protocol: route.protocol,
    baseUrl: route.baseUrl,
    credentialId: route.credentialId,
  });
  const identity = JSON.stringify(channel);
  const existing = indices.get(identity);
  if (existing !== undefined) return existing;
  const index = channels.length;
  indices.set(identity, index);
  channels.push(channel);
  return index;
}

function executionModel(
  route: TextModelRoute,
  channelIndex: number
): WorkflowTextModel {
  return Object.freeze({
    modelId: route.modelId,
    name: route.name,
    upstreamModel: route.upstreamModel,
    vision: route.vision,
    structuredOutput: route.structuredOutput,
    tools: route.tools,
    contextWindow: route.contextWindow,
    maxOutputTokens: route.maxOutputTokens,
    inputPricePerMillion: route.inputPricePerMillion,
    outputPricePerMillion: route.outputPricePerMillion,
    channelIndex,
  });
}

export function packWorkflowTextModelRouting(
  routing: TextModelRoutingSnapshot
): WorkflowTextModelRoutingSnapshot {
  const channels: WorkflowTextChannel[] = [];
  const indices = new Map<string, number>();
  const models = routing.map((route) =>
    executionModel(route, channelIndexFor(route, channels, indices))
  );
  return Object.freeze({
    version: WORKFLOW_ROUTING_VERSION,
    channels: Object.freeze(channels),
    models: Object.freeze(models),
  });
}

function isLegacyRouting(
  routing: WorkflowTextModelRouting
): routing is TextModelRoutingSnapshot {
  return Array.isArray(routing);
}

function restoreModel(
  model: WorkflowTextModel,
  channels: readonly WorkflowTextChannel[]
): TextModelRoute {
  const { channelIndex, ...binding } = model;
  const channel = channels[channelIndex];
  if (!Number.isInteger(channelIndex) || !channel) {
    throw new Error(INVALID_SNAPSHOT);
  }
  return Object.freeze({ ...binding, ...channel });
}

export function unpackWorkflowTextModelRouting(
  routing: WorkflowTextModelRouting
): TextModelRoutingSnapshot {
  if (isLegacyRouting(routing)) return routing;
  if (routing.version !== WORKFLOW_ROUTING_VERSION) {
    throw new Error(INVALID_SNAPSHOT);
  }
  return Object.freeze(
    routing.models.map((model) => restoreModel(model, routing.channels))
  );
}
