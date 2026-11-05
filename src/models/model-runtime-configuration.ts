import type { ModelConfiguration } from './model-configuration';
import type { TextModelRoutingSnapshot } from './text-channels';
import type { WorkflowTextModelRouting } from './workflow-text-model-routing';
import {
  packWorkflowTextModelRouting,
  unpackWorkflowTextModelRouting,
} from './workflow-text-model-routing';

export type ModelRuntimeConfiguration = ModelConfiguration & {
  textModelRouting?: TextModelRoutingSnapshot;
};

export type WorkflowModelConfiguration = ModelConfiguration & {
  textModelRouting?: WorkflowTextModelRouting;
};

export function packModelRuntimeConfiguration(
  configuration: ModelRuntimeConfiguration
): WorkflowModelConfiguration {
  const { textModelRouting, ...models } = configuration;
  if (textModelRouting === undefined) return models;
  return {
    ...models,
    textModelRouting: packWorkflowTextModelRouting(textModelRouting),
  };
}

export function unpackModelRuntimeConfiguration(
  configuration: WorkflowModelConfiguration
): ModelRuntimeConfiguration {
  const { textModelRouting, ...models } = configuration;
  if (textModelRouting === undefined) return models;
  return {
    ...models,
    textModelRouting: unpackWorkflowTextModelRouting(textModelRouting),
  };
}
