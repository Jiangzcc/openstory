import { expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';
import { logRunEvent } from './sequence-events';

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

it('keeps an ordinary activity transport failure best effort', async () => {
  const recordOnce = vi.fn(async () => {
    throw new Error('Synthetic activity transport failure');
  });
  await expect(
    logRunEvent(stepDouble(), { recordOnce }, 'synthetic-completion', INPUT)
  ).resolves.toBeUndefined();
  expect(recordOnce).toHaveBeenCalledOnce();
});

it('preserves the upstream workflow engine interruption', async () => {
  const interruption = new Error('Aborting engine: Grace period complete');
  const recordOnce = vi.fn(async () => {
    throw interruption;
  });
  await expect(
    logRunEvent(stepDouble(), { recordOnce }, 'synthetic-completion', INPUT)
  ).rejects.toBe(interruption);
});
