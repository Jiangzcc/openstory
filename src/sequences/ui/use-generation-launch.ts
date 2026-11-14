import { skipToken, useQuery } from '@tanstack/react-query';
import {
  DEFAULT_GENERATION_LAUNCH,
  generationLaunchKey,
} from './generation-stream.launch';

export function useGenerationLaunchState(sequenceId: string) {
  return (
    useQuery({
      queryKey: generationLaunchKey(sequenceId),
      queryFn: skipToken,
      initialData: DEFAULT_GENERATION_LAUNCH,
    }).data ?? DEFAULT_GENERATION_LAUNCH
  );
}
