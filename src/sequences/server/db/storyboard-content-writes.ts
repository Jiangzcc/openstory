import { isEngineAbortError } from '@/platform/server/workflow/errors';
import {
  StoryboardContentOwnershipError,
  StoryboardContentOwnershipCheckError,
} from './storyboard-content-scope';
import type { StoryboardContentScope } from './storyboard-content-scope';

export function checkedStoryboardContentWrite<Args extends unknown[], Result>(
  scope: StoryboardContentScope,
  write: (...args: Args) => Promise<Result>
) {
  return async (...args: Args): Promise<Result> => {
    await scope.assert();
    const result = await write(...args).catch((error: unknown) =>
      rethrowContentWriteFailure(scope, error)
    );
    await scope.assert();
    return result;
  };
}

async function rethrowContentWriteFailure(
  scope: StoryboardContentScope,
  error: unknown
): Promise<never> {
  if (isEngineAbortError(error)) throw error;
  try {
    await scope.assert();
  } catch (ownershipError) {
    if (isEngineAbortError(ownershipError)) throw ownershipError;
    if (ownershipError instanceof StoryboardContentOwnershipError) {
      throw new StoryboardContentOwnershipError({ cause: error });
    }
    throw new StoryboardContentOwnershipCheckError(
      new AggregateError(
        [error, ownershipError],
        'Content write failed and ownership could not be verified'
      )
    );
  }
  throw error;
}
