/**
 * Billed likeness-vision calls on a photo or a stored clip. Upload
 * classification (`classifyUpload`) is the only caller: it decides whether
 * the media shows a real person before the rights gate.
 */

import {
  analyzeTalentClip,
  analyzeTalentMedia,
  type TalentVisionResult,
} from '@/cast/server/talent-vision';
import { reportMissingBillingCost } from '@/billing/billing-observability';
import { estimateLLMCost } from '@/billing/cost-estimation';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { ModelConfiguration } from '@/models/model-configuration';
import type { AnalysisModelId } from '@/models/models.config';

type VisionModels = Pick<ModelConfiguration, 'vision' | 'talentVideo'>;

/**
 * What a billed vision call reads and writes. Narrow so a request and a
 * workflow (`UploadCheckWorkflow`, through its named hatches) both satisfy it.
 */
export type VisionBillingDb = (
  | Pick<ScopedDb, 'modelConfiguration'>
  | { models: VisionModels }
) & {
  apiKeys: Pick<ScopedDb['apiKeys'], 'resolveLlmKey'> & {
    resolveOptionalKey: (
      provider: 'google'
    ) => ReturnType<ScopedDb['apiKeys']['resolveOptionalKey']>;
  };
  billing: Pick<ScopedDb['billing'], 'hasEnoughCredits' | 'deductCredits'>;
};
import { InsufficientCreditsError } from '@/platform/errors';
import {
  geminiUnavailableError,
  refuseGeminiOffRegion,
} from '@/models/google-region';
import type { ResolvedLlmKey } from '@/models/server/db/api-keys';
import {
  deleteGeminiFile,
  uploadClipToGemini,
} from '@/models/server/gemini-files';
import { getLogger } from '@/platform/logger';

const logger = getLogger(['openstory', 'cast', 'talent-vision']);

export type AnalyzeTalentMediaForOrganizationInput = {
  scopedDb: VisionBillingDb;
  userId: string;
  imageUrls: string[];
  filenames?: string[];
  idempotencyKey: string;
};

export async function analyzeTalentMediaForOrganization(
  input: AnalyzeTalentMediaForOrganizationInput
): Promise<TalentVisionResult> {
  const model = await configuredVisionModel(input.scopedDb, 'vision');
  const llmKeyInfo = await input.scopedDb.apiKeys.resolveLlmKey(model);
  await requireVisionCredits(input.scopedDb, llmKeyInfo);
  const result = await analyzeTalentMedia({
    model,
    imageUrls: input.imageUrls,
    filenames: input.filenames,
    llmKey: llmKeyInfo,
    // The region fallback swaps the model; re-resolve so the retry's via is
    // one that carries it (#1259).
    resolveLlmKey: (model) => input.scopedDb.apiKeys.resolveLlmKey(model),
    observability: {
      userId: input.userId,
      tags: ['vision', 'likeness'],
    },
  });
  await billTalentVision(input, result, input.imageUrls.length);
  return result;
}

/**
 * The same check on a stored clip (#1930): Gemini watches the whole clip
 * through its Files API. Needs a native Google key (the organization's or the
 * platform's); with none the clip is refused, never judged by another model.
 */
export async function analyzeTalentClipForOrganization(input: {
  scopedDb: VisionBillingDb;
  userId: string;
  /** Storage key of the clip (`<bucket>/<path>`). */
  key: string;
  mimeType: string;
  idempotencyKey: string;
}): Promise<TalentVisionResult> {
  const model = await configuredVisionModel(input.scopedDb, 'talentVideo');
  const credential = await input.scopedDb.apiKeys.resolveOptionalKey('google');
  if (!credential) {
    throw geminiUnavailableError(
      'Checking a clip for a real person needs a Gemini API key. Add one in Settings → API Keys.'
    );
  }
  const llmKey = { ...credential, via: 'google' as const };
  await requireVisionCredits(input.scopedDb, llmKey);
  return refuseGeminiOffRegion('talent clip check', () =>
    checkUploadedClip(input, llmKey, model)
  );
}

async function checkUploadedClip(
  input: {
    scopedDb: VisionBillingDb;
    userId: string;
    key: string;
    mimeType: string;
    idempotencyKey: string;
  },
  llmKey: ResolvedLlmKey,
  model: AnalysisModelId
): Promise<TalentVisionResult> {
  const file = await uploadClipToGemini(input.key, input.mimeType, llmKey.key);
  try {
    const result = await analyzeTalentClip({
      model,
      clip: file,
      llmKey,
      observability: { userId: input.userId, tags: ['vision', 'likeness'] },
    });
    await billTalentVision(input, result, 1);
    return result;
  } finally {
    await deleteGeminiFile(file.name, llmKey.key).catch((error: unknown) => {
      logger.warn('Could not delete a clip from Gemini Files', {
        name: file.name,
        error,
      });
    });
  }
}

async function configuredVisionModel(
  scopedDb: VisionBillingDb,
  field: keyof VisionModels
): Promise<AnalysisModelId> {
  const models =
    'models' in scopedDb
      ? scopedDb.models
      : await scopedDb.modelConfiguration.get();
  return models[field];
}

async function requireVisionCredits(
  scopedDb: VisionBillingDb,
  llmKey: ResolvedLlmKey
): Promise<void> {
  if (llmKey.source === 'organization') return;
  const canAfford = await scopedDb.billing.hasEnoughCredits(estimateLLMCost(1));
  if (!canAfford) {
    throw new InsufficientCreditsError(
      'Insufficient credits for talent vision'
    );
  }
}

async function billTalentVision(
  input: { scopedDb: VisionBillingDb; idempotencyKey: string },
  result: TalentVisionResult,
  mediaCount: number
): Promise<void> {
  if (result.usedOwnKey) return;
  if (result.costMicros > 0) {
    await input.scopedDb.billing.deductCredits(result.costMicros, {
      description: `Talent vision (${result.model})`,
      metadata: { model: result.model },
      idempotencyKey: input.idempotencyKey,
    });
  } else {
    reportMissingBillingCost({
      source: 'talent-vision',
      modelId: result.model,
      metadata: { imageCount: mediaCount },
    });
  }
}
