import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import {
  generationWorkflowOwnerOf,
  isGenerationLifecycleEvent,
  mapGenerationEvent,
  matchesGenerationWorkflow,
  type GenerationEvent,
} from './generation-stream.events';
import {
  createInitialState,
  generationStreamReducer,
  type GenerationPhaseConfig,
  type GenerationStreamState,
} from './generation-stream.reducer';

export const GENERATION_REPLAY_LIVE_LIMIT = 2000;

export type GenerationStreamContext = {
  sequenceId: string;
  workflowRunId: string | null;
  launchToken: number | null;
};

type PendingHistory = { requestId: number; liveEvents: GenerationEvent[] };

export type GenerationStreamSession = {
  context: GenerationStreamContext;
  config?: GenerationPhaseConfig;
  owner?: GenerationWorkflowOwner;
  terminalEvent?: GenerationEvent;
  progress: GenerationStreamState;
  history?: PendingHistory;
};

type ContextAction = {
  context: GenerationStreamContext;
  config?: GenerationPhaseConfig;
};

export type GenerationSessionAction =
  | (ContextAction & { type: 'BIND' | 'RESET' })
  | (ContextAction & { type: 'LIVE'; event: GenerationEvent })
  | (ContextAction & { type: 'HISTORY_START'; requestId: number })
  | (ContextAction & {
      type: 'HISTORY_LOADED';
      requestId: number;
      events: GenerationEvent[];
    })
  | { type: 'HISTORY_FAILED'; requestId: number };

export function createGenerationSession(
  input: ContextAction
): GenerationStreamSession {
  return {
    context: input.context,
    config: input.config,
    progress: createInitialState(input.config),
  };
}

function sameRun(
  session: GenerationStreamSession,
  context: GenerationStreamContext
): boolean {
  return (
    session.context.sequenceId === context.sequenceId &&
    session.context.launchToken === context.launchToken &&
    (session.context.workflowRunId === context.workflowRunId ||
      matchesGenerationWorkflow(session.owner, context.workflowRunId))
  );
}

function bindSession(
  session: GenerationStreamSession,
  input: ContextAction
): GenerationStreamSession {
  if (!sameRun(session, input.context)) return createGenerationSession(input);
  if (session.context.workflowRunId === input.context.workflowRunId)
    return session;
  return { ...session, context: input.context };
}

function applyEvent(
  session: GenerationStreamSession,
  event: GenerationEvent
): GenerationStreamSession {
  const lifecycle = isGenerationLifecycleEvent(event.event);
  if (lifecycle && session.context.launchToken !== null) return session;
  const action = mapGenerationEvent(event, session.context.workflowRunId);
  if (!action) return session;
  const terminal = session.progress.isComplete || session.progress.isFailed;
  if (lifecycle && terminal) return session;
  return {
    ...session,
    progress: generationStreamReducer(session.progress, action),
    owner: lifecycle ? generationWorkflowOwnerOf(event.data) : session.owner,
    terminalEvent:
      action.type === 'COMPLETE' || action.type === 'FAILED'
        ? event
        : session.terminalEvent,
  };
}

function applyLive(
  session: GenerationStreamSession,
  event: GenerationEvent
): GenerationStreamSession {
  const updated = applyEvent(session, event);
  if (updated === session || !session.history) return updated;
  if (session.history.liveEvents.length >= GENERATION_REPLAY_LIVE_LIMIT) {
    return { ...updated, history: undefined };
  }
  return {
    ...updated,
    history: {
      ...session.history,
      liveEvents: [...session.history.liveEvents, event],
    },
  };
}

function isTerminalEvent(event: GenerationEvent): boolean {
  return (
    event.event === 'generation.complete' ||
    event.event === 'generation.failed' ||
    event.event === 'generation.reservation:short'
  );
}

function applyHistory(
  session: GenerationStreamSession,
  requestId: number,
  events: GenerationEvent[]
): GenerationStreamSession {
  if (session.history?.requestId !== requestId) return session;
  const liveEvents = session.history.liveEvents;
  const initial = {
    ...session,
    progress: createInitialState(session.config),
    history: undefined,
  };
  const priorTerminal = session.terminalEvent;
  const historical = priorTerminal
    ? events.filter((event) => !isTerminalEvent(event))
    : events;
  const restored = [...historical, ...liveEvents].reduce(applyEvent, initial);
  return priorTerminal ? applyEvent(restored, priorTerminal) : restored;
}

export function generationSessionReducer(
  session: GenerationStreamSession,
  action: GenerationSessionAction
): GenerationStreamSession {
  if (action.type === 'HISTORY_FAILED') {
    return session.history?.requestId === action.requestId
      ? { ...session, history: undefined }
      : session;
  }
  if (
    action.type !== 'BIND' &&
    action.context.sequenceId !== session.context.sequenceId
  )
    return session;
  const current = bindSession(session, action);
  switch (action.type) {
    case 'BIND':
      return current;
    case 'RESET':
      return createGenerationSession(action);
    case 'LIVE':
      return applyLive(current, action.event);
    case 'HISTORY_START':
      if (current.context.launchToken !== null) return current;
      return {
        ...current,
        history: { requestId: action.requestId, liveEvents: [] },
      };
    case 'HISTORY_LOADED':
      return applyHistory(current, action.requestId, action.events);
  }
}
