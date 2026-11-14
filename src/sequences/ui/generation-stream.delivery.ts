import type { QueryClient } from '@tanstack/react-query';
import type { Sequence } from '@/platform/server/db/schema';
import { getLogger } from '@/platform/logger';
import { updateQueryCacheFromEvent } from '@/platform/ui/realtime/query-cache-updater';
import { sequenceKeys } from './use-sequences';
import { getGenerationLaunch } from './generation-stream.launch';
import {
  generationWorkflowOwnerOf,
  isGenerationLifecycleEvent,
  matchesGenerationWorkflow,
  type GenerationEvent,
} from './generation-stream.events';
import type { GenerationStreamContext } from './generation-stream.session';
import { refreshGenerationPoster } from './generation-poster.refresh';

const logger = getLogger(['openstory', 'generation', 'poster-refresh']);

export function generationContextFromCache(
  queryClient: QueryClient,
  sequenceId: string
): GenerationStreamContext {
  const sequence = queryClient.getQueryData<Sequence>(
    sequenceKeys.detail(sequenceId)
  );
  const launch = getGenerationLaunch(queryClient, sequenceId);
  return {
    sequenceId,
    workflowRunId: sequence?.workflowRunId ?? null,
    launchToken: launch.pending ? launch.token : null,
  };
}

export function deliverGenerationCacheEvent(
  queryClient: QueryClient,
  sequenceId: string,
  event: GenerationEvent
): void {
  if (event.event === 'generation.poster:ready') {
    void refreshGenerationPoster(queryClient, sequenceId).catch(
      (error: unknown) => {
        logger.warn('Failed to refresh sequence poster', {
          err: error,
          sequenceId,
        });
      }
    );
    return;
  }
  const lifecycle = isGenerationLifecycleEvent(event.event);
  const context = generationContextFromCache(queryClient, sequenceId);
  const owner = generationWorkflowOwnerOf(event.data);
  if (lifecycle && owner && context.launchToken !== null) return;
  if (
    lifecycle &&
    owner &&
    !matchesGenerationWorkflow(owner, context.workflowRunId)
  ) {
    void queryClient.invalidateQueries(
      { queryKey: sequenceKeys.detail(sequenceId) },
      { cancelRefetch: false }
    );
    return;
  }
  updateQueryCacheFromEvent(queryClient, sequenceId, event.event, event.data);
}
