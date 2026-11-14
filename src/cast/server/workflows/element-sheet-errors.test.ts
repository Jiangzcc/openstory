import { describe, expect, it } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import type { SequenceElementMinimal } from '@/platform/server/db/schema';
import {
  StoryboardContentOwnershipCheckError,
  StoryboardContentOwnershipError,
} from '@/sequences/server/db/storyboard-content-scope';
import { stopStaleContent } from '@/sequences/server/workflows/storyboard-content-errors';
import { collectElementResults } from './element-sheet-workflow';

const cause = new Error('Synthetic D1 ownership outage');
const ownershipLost = new StoryboardContentOwnershipError({ cause });
const ownershipUnknown = new StoryboardContentOwnershipCheckError(cause);
const engineAbort = new Error('Aborting engine: Grace period complete', {
  cause,
});

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason };
}

function collect(errors: unknown[]): SequenceElementMinimal[] {
  return collectElementResults(
    errors.map(rejected),
    errors.map((_, index) => ({ token: `MOCK_${index}` }))
  );
}

describe('element result failures retain the engine and ownership protocol', () => {
  it.each([ownershipLost, ownershipUnknown, engineAbort])(
    'retains $name identity and cause',
    (error) => {
      expect(() =>
        collect([new Error('Synthetic provider failure'), error])
      ).toThrow(error);
      try {
        collect([error]);
      } catch (actual) {
        expect(actual).toBe(error);
        expect(actual).toHaveProperty('cause', cause);
      }
    }
  );

  it.each([
    [ownershipLost, engineAbort],
    [engineAbort, ownershipLost],
    [ownershipUnknown, engineAbort],
  ])(
    'prioritizes an engine interruption over sibling root failure',
    (first, second) => {
      try {
        collect([first, second]);
      } catch (actual) {
        expect(actual).toBe(engineAbort);
        return;
      }
      throw new Error('Expected synthetic engine interruption');
    }
  );

  it('retains an ownership failure made nonretryable inside a step', async () => {
    const write = stopStaleContent(async () => {
      throw ownershipLost;
    });
    const error = await write().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(NonRetryableError);
    try {
      collect([error]);
    } catch (actual) {
      expect(actual).toBe(error);
      expect(actual).toHaveProperty('cause', ownershipLost);
    }
  });
});
