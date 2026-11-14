import { expect, it, vi } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import { asStub } from '@/test/as-stub';
import { createStoryboardContentMethods } from './storyboard-content';
import {
  StoryboardContentOwnershipError,
  StoryboardContentOwnershipCheckError,
} from './storyboard-content-scope';

const OWNER = { id: 'synthetic-sequence', workflowRunId: 'synthetic-root' };
const ACTIVE = [{ id: OWNER.id }];
type Read = typeof ACTIVE | Error;

// Explicit SQL execution substitutes isolate error classification; real mutations have separate D1 tests.
function fixture(reads: Read[], writeError?: Error) {
  const read = vi.fn(async () => {
    const result = reads.shift();
    if (!result) throw new Error('Missing synthetic ownership read');
    if (result instanceof Error) throw result;
    return result;
  });
  const write = vi.fn(async () => {
    if (writeError) throw writeError;
  });
  const db = asStub<Database>({
    select: () => ({
      from: () => ({
        where: () => ({
          catch: (reject: (error: unknown) => never) => read().catch(reject),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: write }) }),
  });
  const content = createStoryboardContentMethods(
    db,
    'synthetic-organization',
    OWNER
  );
  return {
    read,
    write,
    run: () => content.sequences.updateTitle(OWNER.id, 'Synthetic title'),
  };
}

it('retains the original SQL error when the owner is still active', async () => {
  const failure = new Error('Synthetic write failure');
  const test = fixture([ACTIVE, ACTIVE], failure);
  await expect(test.run()).rejects.toBe(failure);
  expect(test.read).toHaveBeenCalledTimes(2);
});

it('classifies a guarded missing-row failure as ownership loss and retains its cause', async () => {
  const failure = new Error('Synthetic guarded row not found');
  const test = fixture([ACTIVE, []], failure);
  await expect(test.run()).rejects.toBeInstanceOf(
    StoryboardContentOwnershipError
  );
  const retry = fixture([ACTIVE, []], failure);
  await expect(retry.run()).rejects.toHaveProperty('cause', failure);
});

it('propagates unavailable preflight ownership without attempting a write', async () => {
  const failure = new Error('Synthetic ownership read failure');
  const test = fixture([failure]);
  await expect(test.run()).rejects.toMatchObject({
    name: 'StoryboardContentOwnershipCheckError',
    cause: failure,
  });
  expect(test.write).not.toHaveBeenCalled();
});

it('retains both write and verification failures under a named retryable ownership error', async () => {
  const failure = new Error('Synthetic write failure');
  const readFailure = new Error('Synthetic ownership read failure');
  const test = fixture([ACTIVE, readFailure], failure);
  const error: unknown = await test.run().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(StoryboardContentOwnershipCheckError);
  if (!(error instanceof Error) || !(error.cause instanceof AggregateError)) {
    throw new Error('Expected both original failures to remain available');
  }
  expect(error.cause.errors).toEqual([
    failure,
    expect.objectContaining({ cause: readFailure }),
  ]);
});

it.each(['preflight', 'write', 'recheck'] as const)(
  'preserves engine abort at %s unchanged',
  async (stage) => {
    const abort = new Error('Aborting engine: Grace period complete');
    const failure = new Error('Synthetic write failure');
    const reads = stage === 'preflight' ? [abort] : [ACTIVE, abort];
    const test = fixture(reads, stage === 'write' ? abort : failure);
    await expect(test.run()).rejects.toBe(abort);
    expect(test.read).toHaveBeenCalledTimes(stage === 'recheck' ? 2 : 1);
  }
);
