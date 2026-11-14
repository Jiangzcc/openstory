import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { getChannelHistoryFn } from '@/platform/realtime-history.fn';
import { useUser } from '@/platform/ui/use-user';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
} from 'react';
import { useRealtime } from '@/platform/ui/realtime/client';
import { refetchMissedEvents } from '@/platform/ui/realtime/query-cache-updater';
import { isRealtimeLeaf, parseLeafPayload } from '@/platform/realtime/schema';
import { getLogger } from '@/platform/logger';
import { toast } from 'sonner';
import type { GenerationPhaseConfig } from './generation-stream.reducer';
import type { GenerationEvent } from './generation-stream.events';
import {
  createGenerationSession,
  generationSessionReducer,
  type GenerationSessionAction,
  type GenerationStreamContext,
} from './generation-stream.session';
import {
  deliverGenerationCacheEvent,
  generationContextFromCache,
} from './generation-stream.delivery';
import { useGenerationLaunchState } from './use-generation-launch';
import { useSequence } from './use-sequences';

const logger = getLogger(['openstory', 'realtime', 'use-generation-stream']);
const GENERATION_STREAM_EVENTS = [
  'generation.phase:start',
  'generation.phase:complete',
  'generation.scene:new',
  'generation.scene:updated',
  'generation.shot:created',
  'generation.shot:updated',
  'generation.image:progress',
  'generation.video:progress',
  'generation.audio:progress',
  'generation.variant-image:progress',
  'generation.location:matched',
  'generation.character-sheet:progress',
  'generation.character-voice:progress',
  'generation.location-sheet:progress',
  'generation.poster:ready',
  'generation.style:ready',
  'generation.preview:replaced',
  'generation.stale:detected',
  'generation.complete',
  'generation.failed',
  'generation.reservation:short',
  'generation.updated',
  'generation.error',
] as const;

function notifyGenerationProgress(
  event: GenerationEvent,
  translateEvent: ReturnType<typeof useLiveTranslation>
): void {
  const { event: eventName, data } = event;
  const isMediaProgress =
    eventName === 'generation.image:progress' ||
    eventName === 'generation.video:progress';
  if (isMediaProgress && data.promptSoftened === true) {
    toast.info(translateEvent('Prompt rewritten to pass a content checker'), {
      description: translateEvent('The original is kept in Versions.'),
    });
  }
  if (isMediaProgress && data.modelFallback === true) {
    toast.info(
      translateEvent('Retrying on Grok Imagine after the content checker'),
      {
        description: translateEvent('The selected model is kept in Versions.'),
      }
    );
  }
  // A failed upscale leaves the shot on its current still (#1942), so the
  // shot shows no failure; this toast is the only place the user hears.
  if (
    eventName === 'generation.image:progress' &&
    typeof data.upscaleError === 'string'
  ) {
    toast.warning(translateEvent('Upscale failed'), {
      description: translateEvent('{{value1}}. The current still is kept.', {
        value1: data.upscaleError,
      }),
    });
  }
}

type HistoryEvent = { event: string; data: string };

function parseHistoryEvents(events: HistoryEvent[]): GenerationEvent[] {
  return events.flatMap((evt) => {
    try {
      if (!isRealtimeLeaf(evt.event)) return [];
      const parsed = parseLeafPayload(evt.event, '', JSON.parse(evt.data));
      return parsed ? [{ event: parsed.event, data: parsed.data }] : [];
    } catch (error) {
      logger.error('Failed to parse generation history event', {
        err: error,
        event: evt.event,
      });
      return [];
    }
  });
}

type ReplayOptions = {
  sequenceId: string;
  context: GenerationStreamContext;
  config?: GenerationPhaseConfig;
  enabled: boolean;
  dispatch: Dispatch<GenerationSessionAction>;
};

function useGenerationHistory({
  sequenceId,
  context,
  config,
  enabled,
  dispatch,
}: ReplayOptions): void {
  const queryClient = useQueryClient();
  const requestIdRef = useRef(0);
  const { workflowRunId, launchToken } = context;
  useEffect(() => {
    if (!enabled || !workflowRunId || launchToken !== null) return;
    const requestId = ++requestIdRef.current;
    const lifetime = new AbortController();
    dispatch({
      type: 'HISTORY_START',
      requestId,
      context: generationContextFromCache(queryClient, sequenceId),
      config,
    });
    getChannelHistoryFn({ data: { channel: sequenceId } })
      .then((events) => {
        if (lifetime.signal.aborted) return;
        dispatch({
          type: 'HISTORY_LOADED',
          requestId,
          context: generationContextFromCache(queryClient, sequenceId),
          config,
          events: parseHistoryEvents(events),
        });
      })
      .catch((error: Error) => {
        if (lifetime.signal.aborted) return;
        dispatch({ type: 'HISTORY_FAILED', requestId });
        logger.error('Failed to fetch generation history', {
          err: error,
          sequenceId,
        });
      });
    return () => {
      lifetime.abort();
      dispatch({ type: 'HISTORY_FAILED', requestId });
    };
  }, [
    sequenceId,
    workflowRunId,
    launchToken,
    config,
    enabled,
    queryClient,
    dispatch,
  ]);
}

function useGenerationSession(
  sequenceId: string,
  phaseConfig?: GenerationPhaseConfig
) {
  const queryClient = useQueryClient();
  const { data: sequence } = useSequence(sequenceId);
  const launch = useGenerationLaunchState(sequenceId);
  const config = useMemo(
    () =>
      phaseConfig ?? {
        stopAt: sequence?.generationStopAt ?? undefined,
        referenceOnly: !(sequence?.generateStartFrames ?? false),
        generateVoices: sequence?.generateVoices ?? false,
      },
    [
      phaseConfig,
      sequence?.generationStopAt,
      sequence?.generateStartFrames,
      sequence?.generateVoices,
    ]
  );
  const context = {
    sequenceId,
    workflowRunId: sequence?.workflowRunId ?? null,
    launchToken: launch.pending ? launch.token : null,
  };
  const [session, dispatch] = useReducer(
    generationSessionReducer,
    { context, config },
    createGenerationSession
  );
  useEffect(() => {
    dispatch({
      type: 'BIND',
      context: generationContextFromCache(queryClient, sequenceId),
      config,
    });
  }, [
    sequenceId,
    context.workflowRunId,
    context.launchToken,
    config,
    queryClient,
  ]);
  const visible = generationSessionReducer(session, {
    type: 'BIND',
    context,
    config,
  });
  return { queryClient, context, config, session: visible, dispatch };
}

export function useGenerationStream(
  sequenceId: string,
  phaseConfig?: GenerationPhaseConfig,
  options?: { replayHistory?: boolean }
) {
  const translateEvent = useLiveTranslation('sequences');
  const { data: user } = useUser();
  const { queryClient, context, config, session, dispatch } =
    useGenerationSession(sequenceId, phaseConfig);
  const handleEvent = useCallback(
    (event: GenerationEvent) => {
      deliverGenerationCacheEvent(queryClient, sequenceId, event);
      notifyGenerationProgress(event, translateEvent);
      dispatch({
        type: 'LIVE',
        context: generationContextFromCache(queryClient, sequenceId),
        config,
        event,
      });
    },
    [translateEvent, queryClient, sequenceId, config, dispatch]
  );
  useGenerationHistory({
    sequenceId,
    context,
    config,
    enabled: (options?.replayHistory ?? true) && !!user,
    dispatch,
  });
  const { status } = useRealtime({
    channels: [sequenceId],
    events: GENERATION_STREAM_EVENTS,
    onData: handleEvent,
    onConnected: () => refetchMissedEvents(queryClient, sequenceId),
    enabled: true,
  });
  const reset = useCallback(
    (requestedConfig?: GenerationPhaseConfig) => {
      dispatch({
        type: 'RESET',
        context: generationContextFromCache(queryClient, sequenceId),
        config: requestedConfig ?? config,
      });
    },
    [queryClient, sequenceId, config, dispatch]
  );
  return { state: session.progress, status, reset };
}
