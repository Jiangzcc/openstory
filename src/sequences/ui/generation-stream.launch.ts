import type { QueryClient } from '@tanstack/react-query';

export type GenerationLaunchState = {
  readonly token: number;
  readonly pending: boolean;
  readonly previousRunId: string | null;
};

export const DEFAULT_GENERATION_LAUNCH: GenerationLaunchState = {
  token: 0,
  pending: false,
  previousRunId: null,
};

export const generationLaunchKey = (sequenceId: string) =>
  ['generation-launch', sequenceId] as const;

export function getGenerationLaunch(
  queryClient: QueryClient,
  sequenceId: string
): GenerationLaunchState {
  return (
    queryClient.getQueryData<GenerationLaunchState>(
      generationLaunchKey(sequenceId)
    ) ?? DEFAULT_GENERATION_LAUNCH
  );
}

function retainGenerationLaunch(
  queryClient: QueryClient,
  sequenceId: string
): void {
  const queryKey = generationLaunchKey(sequenceId);
  queryClient.setQueryDefaults(queryKey, {
    ...queryClient.getQueryDefaults(queryKey),
    gcTime: Infinity,
  });
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  query?.setOptions({ ...query.options, gcTime: Infinity });
}

export function beginGenerationLaunch(
  queryClient: QueryClient,
  sequenceId: string,
  previousRunId: string | null
): number {
  retainGenerationLaunch(queryClient, sequenceId);
  const token = getGenerationLaunch(queryClient, sequenceId).token + 1;
  queryClient.setQueryData<GenerationLaunchState>(
    generationLaunchKey(sequenceId),
    { token, pending: true, previousRunId }
  );
  return token;
}

export function finishGenerationLaunch(
  queryClient: QueryClient,
  sequenceId: string,
  token: number
): boolean {
  const current = getGenerationLaunch(queryClient, sequenceId);
  if (!current.pending || current.token !== token) return false;
  queryClient.setQueryData<GenerationLaunchState>(
    generationLaunchKey(sequenceId),
    { ...current, pending: false }
  );
  return true;
}

export function canRestoreGenerationLaunch(
  queryClient: QueryClient,
  sequenceId: string,
  token: number,
  currentRunId: string | null
): boolean {
  const current = getGenerationLaunch(queryClient, sequenceId);
  return (
    current.pending &&
    current.token === token &&
    (currentRunId === null || currentRunId === current.previousRunId)
  );
}
