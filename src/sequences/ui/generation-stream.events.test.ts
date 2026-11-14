import { describe, expect, it } from 'vitest';
import { isRealtimeLeaf, parseLeafPayload } from '@/platform/realtime/schema';
import {
  createInitialState,
  generationStreamReducer,
} from './generation-stream.reducer';
import {
  mapGenerationEvent,
  type GenerationEvent,
} from './generation-stream.events';

const owner = {
  workflowRunId: 'namespaced-actual-instance',
  workflowClaimId: 'raw/claim:whose-shape-is-different',
};
const lifecycleEvents = [
  {
    event: 'generation.phase:start',
    data: { phase: 1, phaseName: 'Analyzing script…', workflowOwner: owner },
  },
  {
    event: 'generation.phase:complete',
    data: { phase: 1, workflowOwner: owner },
  },
  {
    event: 'generation.complete',
    data: { sequenceId: 'sequence', workflowOwner: owner },
  },
  {
    event: 'generation.failed',
    data: { message: 'old failure', workflowOwner: owner },
  },
  {
    event: 'generation.error',
    data: {
      message: 'non-fatal boundary warning',
      phase: 1,
      workflowOwner: owner,
    },
  },
  {
    event: 'generation.reservation:short',
    data: {
      neededUsd: 3,
      remainingUsd: 1,
      sceneCount: 2,
      workflowOwner: owner,
    },
  },
] as const satisfies readonly GenerationEvent[];

describe('generation lifecycle event ownership', () => {
  it.each(lifecycleEvents)('ignores an older owner for $event', (event) => {
    expect(mapGenerationEvent(event, 'new-run')).toBeNull();
  });
  it.each(lifecycleEvents)(
    'waits for a known current owner for $event',
    (event) => {
      expect(mapGenerationEvent(event, null)).toBeNull();
    }
  );
  it.each(lifecycleEvents)(
    'accepts the actual instance for $event',
    (event) => {
      expect(mapGenerationEvent(event, owner.workflowRunId)).not.toBeNull();
    }
  );
  it.each(lifecycleEvents)(
    'accepts only the explicit raw claim alias for $event',
    (event) => {
      expect(mapGenerationEvent(event, owner.workflowClaimId)).not.toBeNull();
    }
  );
  it.each(lifecycleEvents)(
    'retains identity through the wire parser for $event',
    (event) => {
      if (!isRealtimeLeaf(event.event)) throw new Error('unknown wire event');
      expect(
        parseLeafPayload(event.event, 'sequence', event.data)?.data
      ).toEqual(event.data);
    }
  );
  it('does not treat an independent batch failure as a storyboard failure', () => {
    expect(
      mapGenerationEvent(
        { event: 'generation.failed', data: { message: 'batch failed' } },
        'new-run'
      )
    ).toBeNull();
  });
  it.each([
    {},
    { workflowRunId: '' },
    { workflowRunId: 42 },
    { workflowRunId: 'run', workflowClaimId: '' },
  ])('rejects malformed identity %j', (workflowOwner) => {
    expect(
      mapGenerationEvent(
        {
          event: 'generation.failed',
          data: { message: 'bad identity', workflowOwner },
        },
        'run'
      )
    ).toBeNull();
  });
  it('does not guess a raw claim by parsing a namespaced instance', () => {
    expect(
      mapGenerationEvent(lifecycleEvents[0], 'claim:whose-shape-is-different')
    ).toBeNull();
  });
  it('preserves the credits-short message for the matching run', () => {
    expect(mapGenerationEvent(lifecycleEvents[5], owner.workflowRunId)).toEqual(
      {
        type: 'FAILED',
        payload: {
          message: 'Not enough credits to generate images for 2 scenes.',
        },
      }
    );
  });
  it('keeps a boundary warning non-fatal', () => {
    const action = mapGenerationEvent(lifecycleEvents[4], owner.workflowRunId);
    if (!action) throw new Error('warning was dropped');
    const state = generationStreamReducer(createInitialState(), action);
    expect(state.error).toBe('non-fatal boundary warning');
    expect(state.isFailed).toBe(false);
  });
  it('keeps standalone media progress available to the existing reducer', () => {
    expect(
      mapGenerationEvent(
        {
          event: 'generation.image:progress',
          data: {
            shotId: 'shot',
            status: 'generating',
            phase: 'retrying',
            attempt: 2,
          },
        },
        'run'
      )
    ).toMatchObject({
      type: 'IMAGE_PROGRESS',
      payload: { shotId: 'shot', retry: { attempt: 2 } },
    });
  });
});

describe('unknown generation events', () => {
  it.each(['generation.unknown', 'toString', '__proto__'])(
    'ignores %s',
    (event) => {
      expect(mapGenerationEvent({ event, data: {} }, 'run')).toBeNull();
    }
  );
});
