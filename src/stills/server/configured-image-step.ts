import type { WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { requireCredits } from '@/billing/server/preflight';
import { getLogger } from '@/platform/logger';
import { generateImageWithProvider } from './image-generation';
import type {
  ImageGenerationParams,
  ImageGenerationResult,
} from './image-generation';
import { configuredImageGenerationQuote } from './configured-image-generation';
import { CompatibleImageError } from './compatible-image-error';
import {
  COMPATIBLE_IMAGE_LIMITS,
  COMPATIBLE_IMAGE_STEP_TIMEOUT,
} from './compatible-image-limits';
import {
  IMAGE_ATTEMPT_STATUS,
  storedChannelGenerationSchema,
} from './configured-image-attempt';
import type {
  ImageAttemptIdentity,
  StoredChannelGeneration,
} from './configured-image-attempt';

const logger = getLogger(['openstory', 'image-channel']);
const NO_RESPONSE_STATUS = 'no_response';
const CHANNEL_STEP_CONFIGURATION = {
  retries: { limit: 0, delay: '1 second' },
  timeout: COMPATIBLE_IMAGE_STEP_TIMEOUT,
} as const;
const RECORD_STEP_CONFIGURATION = {
  retries: { limit: 5, delay: '2 seconds', backoff: 'exponential' },
  timeout: '1 minute',
} as const;
type StoredImage = StoredChannelGeneration['stored'][number];
export type ConfiguredImageStepInput = {
  step: WorkflowStep;
  stepName: string;
  workflowRunId: string;
  scopedDb: WorkflowScopedDb;
  params: ImageGenerationParams;
  reservationId?: string;
  maximumOutputs?: number;
  store: (result: ImageGenerationResult) => Promise<StoredImage[]>;
};

async function attemptIdentity(
  args: ConfiguredImageStepInput
): Promise<ImageAttemptIdentity> {
  const route = args.scopedDb.models.imageModelRouting?.find(
    (entry) => entry.modelId === args.params.model
  );
  const data = new TextEncoder().encode(
    JSON.stringify({ params: args.params, route })
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const inputHash = [...digest]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return {
    id: args.workflowRunId + ':' + args.stepName,
    model: args.params.model,
    inputHash,
  };
}

async function recordUnknown(
  args: ConfiguredImageStepInput,
  identity: ImageAttemptIdentity
): Promise<void> {
  const [recorded] = await Promise.allSettled([
    args.scopedDb.imageGenerationAttempts.markUnknown(identity),
  ]);
  if (recorded.status !== 'rejected') return;
  if (isEngineAbortError(recorded.reason)) throw recorded.reason;
  logger.error('Could not mark image attempt as unknown.', {
    attemptId: identity.id,
  });
}

function recoveredAttempt(
  attempt: Awaited<
    ReturnType<WorkflowScopedDb['claims']['imageGenerationAttempts']['getById']>
  >
) {
  if (!attempt) return undefined;
  if (attempt.status === IMAGE_ATTEMPT_STATUS.stored && attempt.result)
    return attempt.result;
  throw new NonRetryableError(
    'Image generation was already submitted; its result is unknown. Automatic resubmission is disabled.'
  );
}

async function generateAndStore(
  args: ConfiguredImageStepInput,
  identity: ImageAttemptIdentity
) {
  const startedAt = Date.now();
  try {
    const generated = await generateImageWithProvider(args.params, {
      credentials: args.scopedDb.credentials,
      configuredAttemptId: identity.id,
    });
    const stored = await args.store(generated);
    if (stored.length !== generated.imageUrls.length)
      throw new NonRetryableError('Not all generated images were stored.');
    return storedChannelGenerationSchema.parse({
      stored,
      metadata: generated.metadata,
      via: generated.via,
    });
  } catch (error) {
    if (isEngineAbortError(error)) throw error;
    const elapsedMs = Date.now() - startedAt;
    await recordUnknown(args, identity);
    if (error instanceof CompatibleImageError)
      logger.error(
        'Image channel request failed: {code}, HTTP {status}, {submissionState}, elapsed {elapsedMs} ms (timeout {timeoutMs} ms).',
        {
          attemptId: identity.id,
          code: error.code,
          status: error.status ?? NO_RESPONSE_STATUS,
          submissionState: error.submissionState,
          elapsedMs,
          timeoutMs: COMPATIBLE_IMAGE_LIMITS.timeoutMs,
        }
      );
    const message =
      error instanceof CompatibleImageError ||
      error instanceof NonRetryableError
        ? error.message
        : 'Image channel generation or storage failed.';
    throw new NonRetryableError(message);
  }
}

async function trackedGeneration(
  args: ConfiguredImageStepInput,
  identity: ImageAttemptIdentity
): Promise<StoredChannelGeneration> {
  const quote = configuredImageGenerationQuote(
    args.params,
    args.scopedDb.models.imageModelRouting
  );
  if (quote.imageCount > (args.maximumOutputs ?? 1))
    throw new NonRetryableError(
      'This image operation stores one output per task.'
    );
  const existing = recoveredAttempt(
    await args.scopedDb.claims.imageGenerationAttempts.getById(identity)
  );
  if (existing) return existing;
  await requireCredits(args.scopedDb.liveRead, quote.costMicros, {
    providers: [],
    reservationId: args.reservationId,
  });
  const claimed = await args.scopedDb.imageGenerationAttempts.claim(identity);
  if (!claimed.claimed) {
    const recovered = recoveredAttempt(claimed.attempt);
    if (recovered) return recovered;
  }
  return generateAndStore(args, identity);
}

export async function runConfiguredImageStep(
  args: ConfiguredImageStepInput
): Promise<StoredChannelGeneration> {
  const identity = await attemptIdentity(args);
  const result = await args.step.do(
    args.stepName,
    CHANNEL_STEP_CONFIGURATION,
    () => trackedGeneration(args, identity)
  );
  await args.step.do(
    args.stepName + ':record',
    RECORD_STEP_CONFIGURATION,
    async () => {
      try {
        await args.scopedDb.imageGenerationAttempts.complete(identity, result);
      } catch (error) {
        if (isEngineAbortError(error)) throw error;
        throw new Error('Could not persist stored image metadata.');
      }
    }
  );
  return result;
}

export async function runConfiguredSingleImageStep(
  args: Omit<ConfiguredImageStepInput, 'store' | 'maximumOutputs'> & {
    store: (result: ImageGenerationResult) => Promise<StoredImage>;
  }
) {
  const result = await runConfiguredImageStep({
    ...args,
    store: async (image) => [await args.store(image)],
  });
  const stored = result.stored[0];
  if (!stored)
    throw new NonRetryableError('Image generation did not store an output.');
  return { stored, metadata: result.metadata, via: result.via };
}
