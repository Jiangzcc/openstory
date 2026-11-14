import { NonRetryableError } from 'cloudflare:workflows';
import { isStoryboardContentOwnershipError } from '../db/storyboard-content-scope';

export function stopStaleContent<Args extends unknown[], Result>(
  write: (...args: Args) => Promise<Result>
) {
  return async (...args: Args): Promise<Result> => {
    try {
      return await write(...args);
    } catch (error) {
      if (isStoryboardContentOwnershipError(error)) {
        const stopped = new NonRetryableError(error.message, error.name);
        stopped.cause = error;
        throw stopped;
      }
      throw error;
    }
  };
}
