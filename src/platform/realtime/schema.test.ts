import { describe, expect, it } from 'vitest';

import { realtimeSchema } from './index';
import { parseLeafPayload } from './schema';

describe('realtime event shapes', () => {
  it('generation.shot:updated carries ids only — never the Scene (#1811)', () => {
    // Every emit is persisted to the channel DO, and a replay reads the tail
    // back into one isolate: a Scene per shot per prompt type OOMed it.
    expect(
      Object.keys(realtimeSchema.generation['shot:updated'].shape).sort()
    ).toEqual(['shotId', 'updateType']);
  });
});

describe('poster event ownership', () => {
  const posterUrl = '/r2/poster.png';

  it('preserves the explicit root instance and claim through leaf parsing', () => {
    const data = {
      posterUrl,
      workflowOwner: { workflowRunId: 'run-B', workflowClaimId: 'raw/B' },
    };
    expect(
      parseLeafPayload('generation.poster:ready', 'sequence', data)?.data
    ).toEqual(data);
  });

  it('accepts a legacy poster without an owner', () => {
    expect(
      parseLeafPayload('generation.poster:ready', 'sequence', { posterUrl })
        ?.data
    ).toEqual({ posterUrl });
  });

  it.each([{}, { workflowRunId: '' }, { workflowRunId: 42 }])(
    'rejects a malformed explicit owner %j',
    (workflowOwner) => {
      expect(
        parseLeafPayload('generation.poster:ready', 'sequence', {
          posterUrl,
          workflowOwner,
        })
      ).toBeNull();
    }
  );
});
