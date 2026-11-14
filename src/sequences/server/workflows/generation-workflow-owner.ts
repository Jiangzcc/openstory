import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import type { ParentNotifyHint } from '@/platform/server/workflow/await-child';

export function resolveStoryboardOwner({
  storyboardOwner,
  _parent,
}: {
  storyboardOwner?: GenerationWorkflowOwner;
  _parent?: ParentNotifyHint;
}): GenerationWorkflowOwner | undefined {
  if (storyboardOwner) return storyboardOwner;
  if (_parent?.bindingName === 'STORYBOARD_WORKFLOW')
    return { workflowRunId: _parent.parentInstanceId };
  return undefined;
}
