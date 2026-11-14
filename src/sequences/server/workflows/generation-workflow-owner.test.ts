import { describe, expect, it } from 'vitest';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import type { ParentNotifyHint } from '@/platform/server/workflow/await-child';
import { resolveStoryboardOwner } from './generation-workflow-owner';

const OWNER: GenerationWorkflowOwner = {
  workflowRunId: 'synthetic-storyboard-instance',
  workflowClaimId: 'synthetic-trusted-storyboard-claim',
};
const PARENT: ParentNotifyHint = {
  bindingName: 'STORYBOARD_WORKFLOW',
  parentInstanceId: 'synthetic-parent-instance',
  eventType: 'synthetic-child-done',
};

describe('resolveStoryboardOwner', () => {
  it('returns the trusted snapshot unchanged ahead of notify metadata', () => {
    expect(
      resolveStoryboardOwner({ storyboardOwner: OWNER, _parent: PARENT })
    ).toBe(OWNER);
  });

  it('uses only a real Storyboard parent instance without inferring a claim', () => {
    const input = {
      _parent: PARENT,
      workflowClaimId: 'synthetic-untrusted-raw-claim',
    };
    expect(resolveStoryboardOwner(input)).toEqual({
      workflowRunId: PARENT.parentInstanceId,
    });
  });

  it('keeps an explicit root without a notify parent', () => {
    expect(resolveStoryboardOwner({ storyboardOwner: OWNER })).toBe(OWNER);
  });

  it('leaves standalone analysis without an owner', () => {
    expect(resolveStoryboardOwner({})).toBeUndefined();
  });

  it('does not turn an independent MotionBatch parent into a Storyboard owner', () => {
    expect(
      resolveStoryboardOwner({
        _parent: { ...PARENT, bindingName: 'MOTION_BATCH_WORKFLOW' },
      })
    ).toBeUndefined();
  });
});
