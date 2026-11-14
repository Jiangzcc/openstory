import { describe, expect, it } from 'vitest';
import {
  createGenerationSession,
  generationSessionReducer,
  GENERATION_REPLAY_LIVE_LIMIT,
  type GenerationStreamContext,
  type GenerationStreamSession,
} from './generation-stream.session';
import type { GenerationEvent } from './generation-stream.events';

const contextA: GenerationStreamContext = {
  sequenceId: 'sequence',
  workflowRunId: 'run-A',
  launchToken: null,
};
const contextB: GenerationStreamContext = {
  ...contextA,
  workflowRunId: 'run-B',
};
const config = { stopAt: 'images' } as const;
const event = (
  name: string,
  run = 'run-B',
  data: Record<string, unknown> = {}
): GenerationEvent => ({
  event: name,
  data: {
    workflowOwner: { workflowRunId: run, workflowClaimId: 'raw/' + run },
    ...data,
  },
});
const phase = (run = 'run-B') =>
  event('generation.phase:start', run, {
    phase: 1,
    phaseName: 'Analyzing script…',
  });
const complete = (run = 'run-B') =>
  event('generation.complete', run, { sequenceId: 'sequence' });
const failed = (run = 'run-B') =>
  event('generation.failed', run, { message: 'failure ' + run });
const initial = (context = contextB) =>
  createGenerationSession({ context, config });
const live = (
  session: GenerationStreamSession,
  incoming: GenerationEvent,
  context = session.context
) =>
  generationSessionReducer(session, {
    type: 'LIVE',
    context,
    config,
    event: incoming,
  });
const startHistory = (session: GenerationStreamSession, requestId = 1) =>
  generationSessionReducer(session, {
    type: 'HISTORY_START',
    context: session.context,
    config,
    requestId,
  });
const history = (
  session: GenerationStreamSession,
  events: GenerationEvent[],
  requestId = 1,
  context = session.context
) =>
  generationSessionReducer(session, {
    type: 'HISTORY_LOADED',
    context,
    config,
    requestId,
    events,
  });

describe('generation stream session ownership and replay', () => {
  it('ignores A terminal events after binding B', () => {
    const state = live(live(initial(), phase()), failed('run-A'));
    expect(state.progress.isFailed).toBe(false);
    expect(state.progress.currentPhase).toBe(1);
  });
  it('discards history A when B has already started', () => {
    let state = startHistory(initial(contextA));
    state = live(state, phase(), contextB);
    state = history(state, [failed('run-A')]);
    expect(state.context).toEqual(contextB);
    expect(state.progress.isFailed).toBe(false);
    expect(state.progress.currentPhase).toBe(1);
  });
  it('reads the latest query context even before the bind effect runs', () => {
    const state = history(
      startHistory(initial(contextA)),
      [complete('run-A')],
      1,
      contextB
    );
    expect(state.context).toEqual(contextB);
    expect(state.progress.isComplete).toBe(false);
  });
  it('replays history first and then live completion', () => {
    let state = startHistory(initial());
    state = live(state, complete());
    state = history(state, [phase()]);
    expect(state.progress.isComplete).toBe(true);
    expect(state.progress.phases.every((p) => p.status === 'completed')).toBe(
      true
    );
  });
  it('replays history first and then live failure', () => {
    let state = startHistory(initial());
    state = live(state, failed());
    state = history(state, [phase()]);
    expect(state.progress.isFailed).toBe(true);
    expect(state.progress.error).toBe('failure run-B');
  });
  it.each([complete(), failed()])(
    'never reopens a terminal owner after a late phase: $event',
    (terminal) => {
      const state = live(live(initial(), terminal), phase());
      expect(state.progress.isComplete || state.progress.isFailed).toBe(true);
    }
  );
  it('keeps non-fatal boundary warnings non-terminal', () => {
    const state = live(
      live(
        initial(),
        event('generation.error', 'run-B', {
          message: 'merged boundary',
          phase: 1,
        })
      ),
      phase()
    );
    expect(state.progress.isFailed).toBe(false);
    expect(state.progress.error).toBe('merged boundary');
  });
  it('waits through the locally pending launch while cache still names A', () => {
    const pending = { ...contextA, launchToken: 1 };
    const state = live(live(initial(pending), complete('run-A')), failed());
    expect(state.progress.isComplete).toBe(false);
    expect(state.progress.isFailed).toBe(false);
  });
  it('recovers early B events from persisted history after launch reconciliation', () => {
    let state = live(initial({ ...contextA, launchToken: 1 }), complete());
    state = generationSessionReducer(state, {
      type: 'BIND',
      context: contextB,
      config,
    });
    state = history(startHistory(state), [phase(), complete()]);
    expect(state.progress.isComplete).toBe(true);
  });
  it('does not start a history request while a launch is pending', () => {
    expect(
      startHistory(initial({ ...contextA, launchToken: 1 })).history
    ).toBeUndefined();
  });
  it('drops a history response that crossed an explicit reset', () => {
    let state = startHistory(initial());
    state = generationSessionReducer(state, {
      type: 'RESET',
      context: contextB,
      config,
    });
    state = history(state, [failed()]);
    expect(state.progress.isFailed).toBe(false);
  });
  it('only adopts the current history request', () => {
    let state = startHistory(startHistory(initial(), 1), 2);
    state = history(state, [failed()], 1);
    expect(state.progress.isFailed).toBe(false);
    state = history(state, [phase()], 2);
    expect(state.progress.currentPhase).toBe(1);
  });
  it('keeps live state when history fails and ignores its late response', () => {
    let state = live(startHistory(initial()), complete());
    state = generationSessionReducer(state, {
      type: 'HISTORY_FAILED',
      requestId: 1,
    });
    state = history(state, [phase()]);
    expect(state.progress.isComplete).toBe(true);
  });
  it('does not reset an accepted raw claim when its actual instance is published', () => {
    let state = live(
      initial({ ...contextB, workflowRunId: 'raw/run-B' }),
      phase()
    );
    const progress = state.progress;
    state = generationSessionReducer(state, {
      type: 'BIND',
      context: contextB,
      config,
    });
    expect(state.progress).toBe(progress);
    expect(state.context.workflowRunId).toBe('run-B');
  });
  it('preserves terminal state across raw-claim publication', () => {
    let state = live(
      initial({ ...contextB, workflowRunId: 'raw/run-B' }),
      failed()
    );
    state = generationSessionReducer(state, {
      type: 'BIND',
      context: contextB,
      config,
    });
    expect(state.progress.isFailed).toBe(true);
  });
  it('resets when the sequence changes even if its run id happens to match', () => {
    let state = live(initial(), failed());
    state = generationSessionReducer(state, {
      type: 'BIND',
      context: { ...contextB, sequenceId: 'other' },
      config,
    });
    expect(state.progress.isFailed).toBe(false);
  });
  it('sizes a newly confirmed session from its frozen phase configuration', () => {
    const state = generationSessionReducer(initial(contextA), {
      type: 'BIND',
      context: contextB,
      config: { stopAt: 'script' },
    });
    expect(state.progress.phases).toHaveLength(1);
    expect(state.config?.stopAt).toBe('script');
  });
  it('does not manufacture ownership from history or the first live event', () => {
    const state = live(initial({ ...contextB, workflowRunId: null }), phase());
    expect(state.context.workflowRunId).toBeNull();
    expect(state.progress.currentPhase).toBe(0);
  });
  it('preserves media updates received while history was pending', () => {
    let state = startHistory(initial());
    state = live(state, {
      event: 'generation.shot:created',
      data: { shotId: 'shot', sceneId: 'scene', orderIndex: 0 },
    });
    state = live(state, {
      event: 'generation.image:progress',
      data: { shotId: 'shot', status: 'completed', thumbnailUrl: '/r2/still' },
    });
    state = history(state, [phase()]);
    expect(state.progress.shots.get('shot')).toMatchObject({
      imageStatus: 'completed',
      thumbnailUrl: '/r2/still',
    });
  });
  it('abandons hydration when its bounded live buffer fills, preserving displayed progress', () => {
    let state = startHistory(initial());
    for (let i = 0; i <= GENERATION_REPLAY_LIVE_LIMIT; i++)
      state = live(state, {
        event: 'generation.image:progress',
        data: {
          shotId: 'shot',
          status: 'generating',
          phase: 'retrying',
          attempt: i,
        },
      });
    expect(state.history).toBeUndefined();
    state = history(state, [failed()]);
    expect(state.progress.isFailed).toBe(false);
    expect(state.progress.shotRetries.get('shot')?.image?.attempt).toBe(
      GENERATION_REPLAY_LIVE_LIMIT
    );
  });
});

describe('generation stream navigation boundary', () => {
  it('ignores a former route callback after another sequence was bound', () => {
    const current = { ...contextB, sequenceId: 'other' };
    let state = generationSessionReducer(initial(), {
      type: 'BIND',
      context: current,
      config,
    });
    state = live(state, complete(), contextB);
    expect(state.context).toEqual(current);
    expect(state.progress.isComplete).toBe(false);
  });
  it('ignores a former route reset callback after navigation', () => {
    const current = { ...contextB, sequenceId: 'other' };
    let state = generationSessionReducer(initial(), {
      type: 'BIND',
      context: current,
      config,
    });
    state = generationSessionReducer(state, {
      type: 'RESET',
      context: contextB,
      config,
    });
    expect(state.context).toEqual(current);
  });
});

describe('accepted terminal receipts survive hydration', () => {
  it.each([complete(), failed()])(
    'preserves $event accepted before a new history request',
    (terminal) => {
      let state = startHistory(live(initial(), terminal));
      state = history(state, [phase()]);
      expect(state.progress.isComplete).toBe(
        terminal.event === 'generation.complete'
      );
      expect(state.progress.isFailed).toBe(
        terminal.event === 'generation.failed'
      );
    }
  );
  it('does not replace live completion with a conflicting history failure', () => {
    let state = live(startHistory(initial()), complete());
    state = history(state, [failed()]);
    expect(state.progress.isComplete).toBe(true);
    expect(state.progress.isFailed).toBe(false);
  });
  it('does not replace live failure with a conflicting history completion', () => {
    let state = live(startHistory(initial()), failed());
    state = history(state, [complete()]);
    expect(state.progress.isFailed).toBe(true);
    expect(state.progress.isComplete).toBe(false);
  });
  it('preserves completion through raw-claim publication and another hydration', () => {
    let state = live(
      initial({ ...contextB, workflowRunId: 'raw/run-B' }),
      complete()
    );
    state = generationSessionReducer(state, {
      type: 'BIND',
      context: contextB,
      config,
    });
    state = history(startHistory(state), [phase()]);
    expect(state.progress.isComplete).toBe(true);
  });
});
