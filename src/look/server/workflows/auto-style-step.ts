import type { Locale } from '@/platform/i18n/locale';
/**
 * Automatic style derivation (#1213), run by analyze-script in parallel with
 * scene-split. Runs one billed LLM call over the snapshotted script, writes the
 * recipe onto the sequence-bound style row and the sequence's own snapshot,
 * and hands the resolved `StyleConfig` back for every child payload.
 */
import type { AnalysisModelId } from '@/models/models.config';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { GenerationWorkflowOwner } from '@/platform/realtime/schema';
import { autoStyleOutput } from './auto-style-output';
import { getLogger } from '@/platform/logger';
import { getGenerationChannel } from '@/platform/realtime';
import {
  autoStyleDraftFromResponse,
  createAutoStyleResponseSchema,
  STYLE_CATEGORIES,
  type AutoStyleDraft,
} from '@/look/auto-style';
import { STYLE_PACE_VALUES, type StyleConfig } from '@/look/style-config';
import { durableLLMCallCf } from '@/models/server/llm-call-helper';
import type { WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

const logger = getLogger(['openstory', 'workflow', 'auto-style']);

type AutoStyleStepParams = {
  promptLocale: Locale;
  scopedDb: WorkflowScopedDb;
  workflowRunId: string;
  storyboardOwner?: GenerationWorkflowOwner;
  sequenceId: string;
  styleId: string;
  script: string;
  aspectRatio: AspectRatio;
  analysisModelId: AnalysisModelId;
  reservationId?: string;
};

export async function deriveAutoStyle(
  step: WorkflowStep,
  params: AutoStyleStepParams
): Promise<StyleConfig> {
  const { scopedDb, sequenceId, styleId } = params;

  const response = await durableLLMCallCf(
    step,
    {
      name: 'automatic-style',
      phase: { number: 1, name: 'Analyzing script & deriving a style…' },
      promptName: 'phase/automatic-style-chat',
      promptVariables: {
        script: params.script,
        aspectRatio: params.aspectRatio,
        categories: STYLE_CATEGORIES.join(', '),
        paces: STYLE_PACE_VALUES.join(', '),
      },
      modelId: params.analysisModelId,
      responseSchema: createAutoStyleResponseSchema(params.promptLocale),
      additionalMetadata: { styleId },
      reasoning: true,
    },
    {
      promptLocale: params.promptLocale,
      sequenceId,
      workflowRunId: params.workflowRunId,
      scopedDb,
      reservationId: params.reservationId,
    }
  );

  const draft = coerceDraft(response, sequenceId);
  await step.do('save-automatic-style', () =>
    saveAutomaticStyle(params, draft)
  );
  return draft.config;
}

// Coercion of a cached LLM result cannot improve on retry.
function coerceDraft(
  response: Parameters<typeof autoStyleDraftFromResponse>[0],
  sequenceId: string
): AutoStyleDraft {
  try {
    return autoStyleDraftFromResponse(response);
  } catch (error) {
    throw new NonRetryableError(
      `Automatic style for sequence ${sequenceId} was unsalvageable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function saveAutomaticStyle(
  params: AutoStyleStepParams,
  draft: AutoStyleDraft
) {
  const { sequenceId, styleId } = params;
  const output = autoStyleOutput(
    params.scopedDb,
    sequenceId,
    params.storyboardOwner
  );
  const bound = await output.styles.setGeneratedForSequence({
    styleId,
    sequenceId,
    draft,
  });
  if (!bound) {
    // Promoted between the trigger and this step — a library row must never
    // be rewritten by a run.
    throw new NonRetryableError(
      `Automatic style ${styleId} is no longer bound to sequence ${sequenceId}`
    );
  }
  // Reads the row just written in this step; scoped to the sequence still
  // pointing at this style, so a library pick made mid-run wins.
  const snapshotted = await output.sequences.snapshotAutoStyle({
    id: sequenceId,
    styleId,
  });
  if (!snapshotted) {
    logger.warn('[AutoStyle:cf] sequence re-styled mid-run; snapshot kept', {
      sequenceId,
      styleId,
    });
  }
  await announceAutomaticStyle(sequenceId, styleId, draft);
}

async function announceAutomaticStyle(
  sequenceId: string,
  styleId: string,
  draft: AutoStyleDraft
) {
  await getGenerationChannel(sequenceId).emit('generation.style:ready', {
    styleId,
    name: draft.name,
  });
  logger.info('[AutoStyle:cf] derived style saved', {
    sequenceId,
    styleId,
    name: draft.name,
  });
}
