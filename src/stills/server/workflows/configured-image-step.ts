import type { WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { isEngineAbortError } from '@/platform/server/workflow/errors';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { requireCredits } from '@/billing/server/preflight';
import { getLogger } from '@/platform/logger';
import type {
  ImageGenerationParams,
  ImageGenerationResult,
} from '../image-generation';
import {
  configuredImageGenerationQuote,
  generateConfiguredImage,
} from '../configured-image-generation';
import { CompatibleImageError } from '../compatible-image-error';
import {
  COMPATIBLE_IMAGE_LIMITS,
  COMPATIBLE_IMAGE_STEP_TIMEOUT,
} from '../compatible-image-limits';

const logger = getLogger(['openstory', 'image-channel']);
const NO_RESPONSE_STATUS = 'no_response';
const CHANNEL_STEP_CONFIGURATION = {
  retries: { limit: 0, delay: '1 second' },
  timeout: COMPATIBLE_IMAGE_STEP_TIMEOUT,
} as const;
export type StoredImage = {
  url: string;
  path: string;
  sheetId?: string;
  contentType?: string;
};
export type StoredChannelGeneration = {
  stored: StoredImage[];
  metadata: ImageGenerationResult['metadata'];
  via: ImageGenerationResult['via'];
};
export type ConfiguredImageStepInput = {
  step: WorkflowStep;
  stepName: string;
  scopedDb: WorkflowScopedDb;
  params: ImageGenerationParams;
  reservationId?: string;
  maximumOutputs?: number;
  store: (result: ImageGenerationResult) => Promise<StoredImage[]>;
};

async function generateAndStore(
  args: ConfiguredImageStepInput
): Promise<StoredChannelGeneration> {
  const startedAt = Date.now();
  try {
    const generated = await generateConfiguredImage(args.params, {
      credentials: args.scopedDb.credentials,
    });
    const stored = await args.store(generated);
    if (stored.length === 0 || stored.length !== generated.imageUrls.length)
      throw new NonRetryableError('Not all generated images were stored.');
    return {
      stored,
      metadata: generated.metadata,
      via: generated.via,
    };
  } catch (error) {
    if (isEngineAbortError(error)) throw error;
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof CompatibleImageError)
      logger.error(
        'Image channel request failed: {code}, HTTP {status}, {submissionState}, elapsed {elapsedMs} ms (timeout {timeoutMs} ms).',
        {
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

async function configuredGeneration(
  args: ConfiguredImageStepInput
): Promise<StoredChannelGeneration> {
  const quote = configuredImageGenerationQuote(
    args.params,
    args.scopedDb.models.imageModelRouting
  );
  if (quote.imageCount > (args.maximumOutputs ?? 1))
    throw new NonRetryableError(
      'This image operation stores one output per task.'
    );
  await requireCredits(args.scopedDb.liveRead, quote.costMicros, {
    providers: [],
    reservationId: args.reservationId,
  });
  return generateAndStore(args);
}

export async function runConfiguredImageStep(
  args: ConfiguredImageStepInput
): Promise<StoredChannelGeneration> {
  return args.step.do(args.stepName, CHANNEL_STEP_CONFIGURATION, () =>
    configuredGeneration(args)
  );
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
