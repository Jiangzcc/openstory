import { describe, expect, it } from 'vitest';
import type { SequenceElementMinimal } from '@/platform/server/db/schema';
import { collectElementResults } from './element-sheet-workflow';

const cause = new Error('Synthetic D1 outage');
const interruption = new Error('Aborting engine: Grace period complete', {
  cause,
});

function collect(errors: unknown[]): SequenceElementMinimal[] {
  return collectElementResults(
    errors.map((reason) => ({ status: 'rejected', reason })),
    errors.map((_, index) => ({ token: `MOCK_${index}` }))
  );
}

describe('element result failures preserve engine interruption', () => {
  it.each([
    [new Error('Synthetic provider failure'), interruption],
    [interruption, new Error('Synthetic provider failure')],
  ])(
    'retains interruption identity and cause across sibling failures',
    (first, second) => {
      try {
        collect([first, second]);
      } catch (actual) {
        expect(actual).toBe(interruption);
        expect(actual).toHaveProperty('cause', cause);
        return;
      }
      throw new Error('Expected synthetic engine interruption');
    }
  );
});
