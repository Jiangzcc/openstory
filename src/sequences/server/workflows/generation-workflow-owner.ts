import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import type { AnalyzeScriptWorkflowInput } from '@/platform/server/workflow/types';

export function resolveStoryboardOwner({
  storyboardOwner,
  _parent,
}: Pick<AnalyzeScriptWorkflowInput, 'storyboardOwner' | '_parent'>):
  | GenerationWorkflowOwner
  | undefined {
  if (storyboardOwner) return storyboardOwner;
  if (_parent?.bindingName === 'STORYBOARD_WORKFLOW')
    return { workflowRunId: _parent.parentInstanceId };
  return undefined;
}
