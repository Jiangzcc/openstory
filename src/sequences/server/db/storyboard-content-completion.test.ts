import { expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';
import { logRunEvent } from './sequence-events';
import {
  StoryboardContentOwnershipError,
  StoryboardContentOwnershipCheckError,
} from './storyboard-content-scope';

const INPUT = {
  sequenceId: 'synthetic-sequence',
  actorId: null,
  kind: 'scene-split.completed',
  targetType: 'sequence',
  targetId: 'synthetic-sequence',
  summary: 'Synthetic completed split',
} as const;

// Direct callbacks substitute the workflow engine; no provider or realtime transport runs.
function stepDouble() {
  return asStub<WorkflowStep>({
    do: async (_name: string, run: () => Promise<unknown>) => run(),
  });
}

it('does not let completion logging swallow a lost storyboard owner', async () => {
  const ownership = new StoryboardContentOwnershipError();
  const recordOnce = vi.fn(async () => {
    throw ownership;
  });
  await expect(
    logRunEvent(stepDouble(), { recordOnce }, 'synthetic-completion', INPUT)
  ).rejects.toBe(ownership);
});

it('keeps an ordinary activity transport failure best effort', async () => {
  const recordOnce = vi.fn(async () => {
    throw new Error('Synthetic activity transport failure');
  });
  await expect(
    logRunEvent(stepDouble(), { recordOnce }, 'synthetic-completion', INPUT)
  ).resolves.toBeUndefined();
  expect(recordOnce).toHaveBeenCalledOnce();
});

it('propagates an ownership error reconstructed at a workflow step boundary', async () => {
  const original = new StoryboardContentOwnershipError();
  const serialized = { name: original.name, message: original.message };
  const recordOnce = vi.fn(async () => {
    throw serialized;
  });
  await expect(
    logRunEvent(stepDouble(), { recordOnce }, 'synthetic-completion', INPUT)
  ).rejects.toBe(serialized);
});

it('propagates an unknown ownership check while retaining its underlying database failure', async () => {
  const failure = new Error('Synthetic ownership read failure');
  const ownership = new StoryboardContentOwnershipCheckError(failure);
  const recordOnce = vi.fn(async () => {
    throw ownership;
  });
  await expect(
    logRunEvent(stepDouble(), { recordOnce }, 'synthetic-completion', INPUT)
  ).rejects.toBe(ownership);
  expect(ownership.cause).toBe(failure);
});
