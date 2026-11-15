import { eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import {
  creditReservations,
  credits,
  organization,
  sequences,
  transactions,
  user,
} from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import { createModelConfigurationAdminMethods } from '@/models/server/db/model-configuration';
import { createTextChannelsAdminMethods } from '@/models/server/db/text-channels';
import { createImageChannelsAdminMethods } from '@/models/server/db/image-channels';
import type { ChannelTextModel } from '@/models/text-channels';
import type { ChannelImageModel } from '@/models/image-channels';

// Synthetic configuration, credentials and wallet funds; no supplier is contacted.
export const CAPTURE = {
  analysisA: 'custom:capture-analysis-a',
  analysisB: 'custom:capture-analysis-b',
  helperA: 'custom:capture-helper-a',
  helperB: 'custom:capture-helper-b',
  imageA: 'custom-image:capture-a',
  imageB: 'custom-image:capture-b',
  textChannel: 'capture-text',
  imageChannel: 'capture-image',
  organizationAnalysis: 'openai/gpt-5.4-mini',
  organizationHelper: DEFAULT_MODEL_CONFIGURATION.sceneSplit,
  startingBalance: 10_000_000,
  coarseTextMicros: 60_000,
  oneShotImageCount: 3,
  tokenUsage: {
    promptTokens: 1_000_000,
    completionTokens: 500_000,
    totalTokens: 1_500_000,
  },
} as const;

export const CAPTURE_RATES = {
  A: {
    input: 2,
    output: 6,
    image: 0.02,
    imageMicros: 20_000,
    textMicros: 5_000_000,
  },
  B: {
    input: 20,
    output: 60,
    image: 0.08,
    imageMicros: 80_000,
    textMicros: 50_000_000,
  },
} as const;
export type CaptureVersion = keyof typeof CAPTURE_RATES;

function textModel(
  id: ChannelTextModel['id'],
  version: CaptureVersion
): ChannelTextModel {
  const rate = CAPTURE_RATES[version];
  return {
    id,
    name: 'Synthetic ' + id,
    channelId: CAPTURE.textChannel,
    upstreamModel: 'synthetic/' + id.slice('custom:'.length),
    enabled: true,
    vision: true,
    structuredOutput: true,
    tools: true,
    contextWindow: 32_000,
    maxOutputTokens: 4_000,
    inputPricePerMillion: rate.input,
    outputPricePerMillion: rate.output,
  };
}

function imageModel(
  id: ChannelImageModel['id'],
  version: CaptureVersion
): ChannelImageModel {
  return {
    id,
    name: 'Synthetic ' + id,
    channelId: CAPTURE.imageChannel,
    enabled: true,
    operations: {
      generate: {
        upstreamModel: 'synthetic-image',
        status: 'verified',
        minReferenceImages: 0,
        maxReferenceImages: 0,
        mask: 'unsupported',
      },
    },
    parameters: [
      {
        key: 'size',
        label: 'Size',
        type: 'string',
        status: 'verified',
        operations: ['generate'],
        required: true,
        defaultValue: '512x512',
        values: ['512x512', '1024x576'],
      },
    ],
    priceCards: [
      {
        id: 'wide',
        operation: 'generate',
        match: { size: '1024x576' },
        unitPriceUsd: CAPTURE_RATES[version].image,
      },
      {
        id: 'square-decoy',
        operation: 'generate',
        match: { size: '512x512' },
        unitPriceUsd: 0.5,
      },
    ],
  };
}

async function saveText(db: Database, version: CaptureVersion) {
  const writer = createTextChannelsAdminMethods(db);
  await writer.saveChannel({
    id: CAPTURE.textChannel,
    name: 'Synthetic text ' + version,
    baseUrl: 'https://capture-' + version.toLowerCase() + '.invalid/v1',
    protocol: version === 'A' ? 'openai-chat-completions' : 'openai-responses',
    userAgent: 'SyntheticCapture/' + version,
    enabled: true,
    apiKey: 'synthetic-text-secret-' + version,
  });
  for (const id of [
    CAPTURE.analysisA,
    CAPTURE.analysisB,
    CAPTURE.helperA,
    CAPTURE.helperB,
  ]) {
    await writer.saveModel({
      ...textModel(id, version),
    });
  }
}

async function saveImages(db: Database, version: CaptureVersion) {
  const writer = createImageChannelsAdminMethods(db);
  await writer.saveChannel({
    id: CAPTURE.imageChannel,
    name: 'Synthetic image ' + version,
    baseUrl: 'https://capture-images-' + version.toLowerCase() + '.invalid/v1',
    protocol: 'openai-images',
    enabled: true,
    apiKey: 'synthetic-image-secret-' + version,
  });
  for (const id of [CAPTURE.imageA, CAPTURE.imageB]) {
    await writer.saveModel({
      ...imageModel(id, version),
    });
  }
}

export async function saveCaptureConfiguration(
  db: Database,
  version: CaptureVersion
) {
  await saveText(db, version);
  await saveImages(db, version);
  return createModelConfigurationAdminMethods(db).save({
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultAnalysis: version === 'A' ? CAPTURE.analysisA : CAPTURE.analysisB,
    sceneSplit: version === 'A' ? CAPTURE.helperA : CAPTURE.helperB,
    defaultImage: version === 'A' ? CAPTURE.imageA : CAPTURE.imageB,
  });
}

export async function createCaptureContext(
  db: Database,
  createScope: (organizationId: string, userId: string) => ScopedDb,
  balance: number = CAPTURE.startingBalance
) {
  const organizationId = generateId();
  const userId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic capture',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic capture',
    email: userId + '@capture.invalid',
  });
  await db.insert(credits).values({ organizationId, balance });
  const scopedDb = createScope(organizationId, userId);
  for (const provider of ['fal', 'openrouter'] as const) {
    await scopedDb.apiKeys.saveKey({
      provider,
      apiKey: 'synthetic-organization-' + provider,
    });
  }
  const template = DEFAULT_STYLE_TEMPLATES[0];
  if (!template)
    throw new Error('Synthetic capture requires a style template.');
  const style = await scopedDb.styles.create({
    name: 'Synthetic capture',
    config: template.config,
  });
  return {
    scopedDb,
    organizationId,
    user: { id: userId },
    promptLocale: 'en' as const,
    styleId: style.id,
  };
}
export type CaptureContext = Awaited<ReturnType<typeof createCaptureContext>>;

export function captureInput(
  context: CaptureContext,
  overrides: Record<string, unknown> = {}
) {
  return {
    script: 'Scene 1 — 5s\nA cyclist races home.',
    styleId: context.styleId,
    aspectRatio: '16:9',
    resolution: '720p',
    generateStartFrames: true,
    generateVoices: false,
    stopAt: 'images',
    ...overrides,
  };
}

export async function captureState(db: Database, context: CaptureContext) {
  const [rows, holds, funds, ledger] = await Promise.all([
    db
      .select()
      .from(sequences)
      .where(eq(sequences.organizationId, context.organizationId)),
    db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.organizationId, context.organizationId)),
    db
      .select()
      .from(credits)
      .where(eq(credits.organizationId, context.organizationId)),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.organizationId, context.organizationId)),
  ]);
  return { rows, holds, funds, ledger };
}

export type CaptureFault =
  | 'text-capability'
  | 'text-disabled'
  | 'image-price'
  | 'image-capability'
  | 'image-disabled';

export async function saveCaptureHelper(
  db: Database,
  sceneSplit: ModelConfiguration['sceneSplit']
) {
  const writer = createModelConfigurationAdminMethods(db);
  return writer.save({ ...(await writer.get()), sceneSplit });
}

export async function damageCaptureConfiguration(
  db: Database,
  fault: CaptureFault
) {
  if (fault.startsWith('text-')) {
    const writer = createTextChannelsAdminMethods(db);
    const saved = await writer.get();
    const model = saved.models.find((entry) => entry.id === CAPTURE.analysisA);
    if (!model) throw new Error('Missing synthetic text model.');
    await writer.saveModel({
      ...model,
      ...(fault === 'text-capability'
        ? { structuredOutput: false }
        : { enabled: false }),
    });
    return;
  }
  const writer = createImageChannelsAdminMethods(db);
  const saved = await writer.get();
  const model = saved.models.find((entry) => entry.id === CAPTURE.imageA);
  if (!model?.operations.generate)
    throw new Error('Missing synthetic image model.');
  await writer.saveModel({
    ...model,
    ...(fault === 'image-price'
      ? {
          priceCards: model.priceCards.filter(
            (card) => card.id === 'square-decoy'
          ),
        }
      : {}),
    ...(fault === 'image-capability'
      ? {
          operations: {
            generate: { ...model.operations.generate, status: 'unverified' },
          },
        }
      : {}),
    ...(fault === 'image-disabled' ? { enabled: false } : {}),
  });
}
