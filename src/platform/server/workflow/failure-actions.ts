import { isEngineAbortError } from './errors';

// Attempt independent failure actions in order, then reject so step.do can retry.
export async function runFailureActions(
  actions: ReadonlyArray<() => Promise<unknown>>
): Promise<void> {
  let failure: { error: unknown } | undefined;
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      if (isEngineAbortError(error)) throw error;
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}
