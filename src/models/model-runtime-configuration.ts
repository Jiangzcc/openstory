import type { ModelConfiguration } from './model-configuration';
import type { TextModelRoutingSnapshot } from './text-channels';
import type { ImageModelRoutingSnapshot } from './image-channels';
import type { WorkflowTextModelRouting } from './workflow-text-model-routing';
import type { WorkflowImageModelRouting } from './workflow-image-model-routing';
import {
  packWorkflowTextModelRouting,
  unpackWorkflowTextModelRouting,
} from './workflow-text-model-routing';
import {
  packWorkflowImageModelRouting,
  unpackWorkflowImageModelRouting,
} from './workflow-image-model-routing';

export type ModelRuntimeConfiguration = ModelConfiguration & {
  textModelRouting?: TextModelRoutingSnapshot;
  imageModelRouting?: ImageModelRoutingSnapshot;
};
export type WorkflowModelConfiguration = ModelConfiguration & {
  textModelRouting?: WorkflowTextModelRouting;
  imageModelRouting?: WorkflowImageModelRouting;
};

export function packModelRuntimeConfiguration(
  configuration: ModelRuntimeConfiguration
): WorkflowModelConfiguration {
  const { textModelRouting, imageModelRouting, ...models } = configuration;
  return {
    ...models,
    ...(textModelRouting === undefined
      ? {}
      : { textModelRouting: packWorkflowTextModelRouting(textModelRouting) }),
    ...(imageModelRouting === undefined
      ? {}
      : {
          imageModelRouting: packWorkflowImageModelRouting(imageModelRouting),
        }),
  };
}

export function unpackModelRuntimeConfiguration(
  configuration: WorkflowModelConfiguration
): ModelRuntimeConfiguration {
  const { textModelRouting, imageModelRouting, ...models } = configuration;
  return {
    ...models,
    ...(textModelRouting === undefined
      ? {}
      : { textModelRouting: unpackWorkflowTextModelRouting(textModelRouting) }),
    ...(imageModelRouting === undefined
      ? {}
      : {
          imageModelRouting: unpackWorkflowImageModelRouting(imageModelRouting),
        }),
  };
}
