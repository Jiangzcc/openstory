import { getEnv } from '#env';
import type { Locale } from '@/platform/i18n/locale';
import { generateId } from '@/platform/id';
import type { WorkflowModelConfiguration } from '@/models/model-runtime-configuration';
import { loadModelRuntimeConfiguration } from '@/platform/server/db/scoped';
import { packModelRuntimeConfiguration } from '@/platform/server/db/scoped-workflow';
import {
  assertTriggerAllowed,
  isMockWorkflowTrigger,
  type TriggerWorkflowOptions,
} from './client';
import { getCfBindingForTriggerPath } from './trigger-bindings';
import { buildInstanceId } from './instance-id';
import { isInstanceAlreadyExistsError } from './errors';
import { disposeRpcStub } from './rpc-dispose';

type WorkflowRunBody = {
  userId: string;
  organizationId: string;
  promptLocale: Locale;
};

export type PrepareWorkflowRunOptions = TriggerWorkflowOptions;

export { WorkflowLaunchPendingError } from './launch-pending';

// Persist this server-prepared snapshot with its claim before dispatching it.
export type PreparedWorkflowRun<T extends WorkflowRunBody = WorkflowRunBody> = {
  readonly workflowRunId: string;
  readonly triggerPath: string;
  readonly body: T & {
    readonly modelConfiguration: WorkflowModelConfiguration;
  };
};

export async function prepareWorkflowRun<T extends WorkflowRunBody>(
  urlPath: string,
  body: T,
  options?: PrepareWorkflowRunOptions
): Promise<PreparedWorkflowRun<T>> {
  await assertTriggerAllowed(urlPath, body, options?.enforcement);
  const env = getEnv();
  if (!isMockWorkflowTrigger(urlPath, env)) {
    getCfBindingForTriggerPath(urlPath, env);
  }
  const workflowRunId = buildInstanceId({
    env,
    workflowName: urlPath.replace(/^\//, ''),
    suffix: options?.deduplicationId || generateId(),
  });
  const configuration =
    options?.modelConfiguration ?? (await loadModelRuntimeConfiguration());
  const prepared = {
    workflowRunId,
    triggerPath: urlPath,
    body: {
      ...structuredClone(body),
      modelConfiguration: Object.freeze(
        packModelRuntimeConfiguration(structuredClone(configuration))
      ),
    },
  };
  // Reject non-JSON payloads before the caller can take a claim.
  JSON.stringify(prepared);
  return prepared;
}

export async function triggerPreparedWorkflow<T extends WorkflowRunBody>(
  prepared: PreparedWorkflowRun<T>
): Promise<string> {
  await assertTriggerAllowed(prepared.triggerPath, prepared.body);
  const env = getEnv();
  if (isMockWorkflowTrigger(prepared.triggerPath, env)) {
    return prepared.workflowRunId;
  }
  const binding = getCfBindingForTriggerPath(prepared.triggerPath, env);
  try {
    const instance = await binding.create({
      id: prepared.workflowRunId,
      params: prepared.body,
    });
    try {
      return prepared.workflowRunId;
    } finally {
      disposeRpcStub(instance);
    }
  } catch (error) {
    if (!isInstanceAlreadyExistsError(error)) throw error;
    return prepared.workflowRunId;
  }
}
