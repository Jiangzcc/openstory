/**
 * Pre-flight Billing Check
 * Shared utility for server functions to verify credit availability
 * before triggering workflows. Skips check if team has own BYOK keys.
 */

import { llmtrTextModel } from '@/models/llmtr';
import type { TextModelRoutingSnapshot } from '@/models/text-channels';
import type { Microdollars } from '@/billing/money';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { InsufficientCreditsError } from '@/platform/errors';
import { generateId } from '@/platform/id';
import { getLogger } from '@/platform/logger';

const logger = getLogger(['openstory', 'billing', 'preflight']);

/**
 * The two live checks a preflight makes: whether the team can pay, and whether
 * it has its own key (in which case it doesn't need to). Narrowed so a
 * workflow passes `scopedDb.liveRead` — a balance read at charge time is one
 * of the sanctioned live reads.
 */
export type PreflightScopedDb = {
  apiKeys: Pick<ScopedDb['apiKeys'], 'hasUsableKey'>;
  billing: Pick<ScopedDb['billing'], 'hasEnoughCredits'>;
};

type ReservationPreflightScopedDb = {
  apiKeys: Pick<ScopedDb['apiKeys'], 'hasUsableKey'>;
  billing: Pick<ScopedDb['billing'], 'hasEnoughCredits' | 'createReservation'>;
};

export type Provider = 'fal' | 'openrouter';
export type LlmKeySource = Awaited<
  ReturnType<ScopedDb['apiKeys']['resolveLlmKey']>
>['source'];

type CreditCoverageOptions = {
  providers?: Provider[];
  llmModel?: string;
  /** Sources resolved for every text model this operation will call. */
  llmSources?: readonly LlmKeySource[];
};

export async function resolveLlmSources(
  scopedDb: { apiKeys: Pick<ScopedDb['apiKeys'], 'resolveLlmKey'> },
  models: readonly string[],
  routing: TextModelRoutingSnapshot
): Promise<LlmKeySource[]> {
  return Promise.all(
    [...new Set(models)].map(
      async (model) =>
        (await scopedDb.apiKeys.resolveLlmKey(model, routing)).source
    )
  );
}

async function hasOwnCoverage(
  scopedDb: PreflightScopedDb,
  opts: CreditCoverageOptions
): Promise<boolean> {
  if (opts.llmSources?.includes('platform')) return false;
  const providers = opts.providers ?? ['fal'];
  const keyChecks = await Promise.all(
    providers.map(async (provider) =>
      provider === 'openrouter' && opts.llmSources !== undefined
        ? opts.llmSources.length > 0 &&
          opts.llmSources.every((source) => source === 'team')
        : coversProvider(scopedDb, provider, opts.llmModel)
    )
  );
  return providers.length > 0 && keyChecks.every(Boolean);
}

async function coversProvider(
  scopedDb: PreflightScopedDb,
  provider: Provider,
  llmModel?: string
): Promise<boolean> {
  if (await scopedDb.apiKeys.hasUsableKey(provider)) return true;
  if (provider !== 'openrouter') return false;
  if (await scopedDb.apiKeys.hasUsableKey('fal')) return true;
  // LLMTR only covers models it actually maps. Fal's OpenRouter proxy
  // carries the whole registry; LLMTR does not.
  if (!llmModel || !llmtrTextModel(llmModel)) return false;
  return scopedDb.apiKeys.hasUsableKey('llmtr');
}

/**
 * Verify a team can afford a generation before triggering it.
 * Skips the check entirely if the team has BYOK keys for all required providers.
 *
 * @param scopedDb - Scoped DB context for the team
 * @param estimatedCostMicros - Estimated raw cost in Microdollars
 * @param providers - Which BYOK providers bypass the check (default: ['fal']);
 *   an empty list requires platform credits regardless of team keys.
 * @param errorMessage - Custom error message for insufficient credits
 *
 * @throws InsufficientCreditsError if team lacks credits and has no BYOK keys
 */
export async function requireCredits(
  scopedDb: PreflightScopedDb,
  estimatedCostMicros: Microdollars,
  opts: CreditCoverageOptions & {
    /** Existing parent envelope this child spends. */
    reservationId?: string;
    errorMessage?: string;
  } = {}
): Promise<void> {
  if (await hasOwnCoverage(scopedDb, opts)) return;

  const canAfford = await scopedDb.billing.hasEnoughCredits(
    estimatedCostMicros,
    opts.reservationId
  );
  if (!canAfford) {
    throw new InsufficientCreditsError(
      opts.errorMessage ?? 'Insufficient credits'
    );
  }
}

/**
 * Create a run envelope instead of a read-only preflight. Returns undefined
 * when BYOK skips the hold. Throws InsufficientCreditsError if available
 * funds cannot cover the estimate.
 * Pass `providers: []` for platform-only work that BYOK cannot cover.
 */
export async function reserveRunCredits(
  scopedDb: ReservationPreflightScopedDb,
  estimatedCostMicros: Microdollars,
  opts: CreditCoverageOptions & {
    errorMessage?: string;
    sequenceId?: string;
    idempotencyKey?: string;
  } = {}
): Promise<string | undefined> {
  if (await hasOwnCoverage(scopedDb, opts)) return undefined;

  const result = await scopedDb.billing.createReservation(estimatedCostMicros, {
    idempotencyKey: opts.idempotencyKey ?? generateId(),
    sequenceId: opts.sequenceId,
  });
  if (!result.ok) {
    throw new InsufficientCreditsError(
      opts.errorMessage ?? 'Insufficient credits'
    );
  }
  return result.reservationId;
}

type ReservationReleaseDb = {
  billing: Pick<ScopedDb['billing'], 'zeroReservation'>;
};

/**
 * Zero this hold if work after `reserveRunCredits` throws. On success,
 * leftover stays for the run to capture; release is the parent's
 * success/`onFailure` path, not this helper.
 */
export async function releaseReservationOnThrow<T>(
  scopedDb: ReservationReleaseDb,
  reservationId: string | undefined,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (reservationId) {
      try {
        await scopedDb.billing.zeroReservation(reservationId);
      } catch (releaseError) {
        logger.error('Failed to zero reservation after trigger error', {
          err: releaseError,
          reservationId,
        });
      }
    }
    throw error;
  }
}
