import { requireSafeImageTestEndpoint } from './configured-image-test-mode';
import type {
  ImageGenerationParams,
  ImageGenerationOptions,
  ImageGenerationResult,
} from './image-generation';
import {
  usesConfiguredImageChannel,
  resolveImageModelRoute,
} from '@/models/image-channels';
import { quoteConfiguredImageRequest } from '@/billing/configured-image-billing';
import { multiplyMicros, usdToMicros } from '@/billing/money';
import { resolveConfiguredImageParameters } from '@/models/configured-image-request';
import { generateCompatibleImages } from './compatible-image-client';
import type { CompatibleImageResult } from './compatible-image-types';
import { parseCompatibleImageParameters } from './compatible-image-parameters';
import { configuredImageReferenceFiles } from './configured-image-references';
import type { AspectRatio } from '@/models/aspect-ratios';
import type { ImageModelRoutingSnapshot } from '@/models/image-channels';

const IMAGE_SIZE_RATIOS = {
  square_hd: '1:1',
  portrait_16_9: '9:16',
  landscape_16_9: '16:9',
} as const;

export async function generateConfiguredImage(
  params: ImageGenerationParams,
  options?: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  const routing = options?.credentials?.imageModelRouting;
  if (!usesConfiguredImageChannel(params.model, routing))
    throw new Error('Expected a configured image model.');
  if (!options?.configuredAttemptId)
    throw new Error('Configured images require a tracked generation step.');
  const credentials = options.credentials;
  const route = resolveImageModelRoute(
    credentials?.imageModelRouting,
    params.model
  );
  if (!route || !credentials?.resolveImageChannelKey)
    throw new Error('Configured image credentials are unavailable.');
  requireSafeImageTestEndpoint(route.baseUrl);
  const referenceUrls = params.referenceImageUrls ?? [];
  const operation = referenceUrls.length > 0 ? 'edit' : 'generate';
  const quote = configuredImageGenerationQuote(
    params,
    credentials.imageModelRouting
  );
  const binding = route.operations[operation];
  if (!binding) throw new Error('Configured image operation is unavailable.');
  const { references, mask } = await configuredImageInputs(
    params,
    credentials.organizationId
  );
  const apiKey = await credentials.resolveImageChannelKey(route.credentialId);
  const started = Date.now();
  const result = await generateCompatibleImages({
    baseUrl: route.baseUrl,
    apiKey,
    upstreamModel: binding.upstreamModel,
    operation,
    prompt: params.prompt,
    parameters: parseCompatibleImageParameters(quote.parameters),
    references,
    mask,
  });
  return configuredImageResult(
    params,
    result,
    quote,
    binding.upstreamModel,
    started
  );
}

export function configuredImageGenerationQuote(
  params: ImageGenerationParams,
  routing?: ImageModelRoutingSnapshot
) {
  const references = params.referenceImageUrls ?? [];
  const aspectRatio: AspectRatio | undefined = params.imageSize
    ? IMAGE_SIZE_RATIOS[params.imageSize]
    : undefined;
  const operation = references.length > 0 ? 'edit' : 'generate';
  const route = resolveImageModelRoute(routing, params.model);
  const parameters = route
    ? resolveConfiguredImageParameters(route.parameters, operation, {
        parameters: params.channelParameters,
        aspectRatio,
        resolution: params.resolution,
        imageCount: params.numImages,
        seed: params.seed,
        outputFormat: params.outputFormat,
      })
    : params.channelParameters;
  return quoteConfiguredImageRequest({
    model: params.model,
    imageModelRouting: routing,
    operation,
    parameters,
    referenceImageCount: references.length,
    hasMask: Boolean(params.maskImageUrl),
    aspectRatio,
    resolution: params.resolution,
    ...(params.numImages === undefined ? {} : { imageCount: params.numImages }),
  });
}

async function configuredImageInputs(
  params: ImageGenerationParams,
  organizationId?: string
) {
  const references = await configuredImageReferenceFiles(
    params.referenceImageUrls ?? [],
    organizationId
  );
  const mask = params.maskImageUrl
    ? (
        await configuredImageReferenceFiles(
          [params.maskImageUrl],
          organizationId
        )
      )[0]
    : undefined;
  return { references, mask };
}

function configuredImageResultParameters(
  params: ImageGenerationParams,
  quote: ReturnType<typeof configuredImageGenerationQuote>
): ImageGenerationParams {
  const parameters = parseCompatibleImageParameters(quote.parameters);
  return {
    ...params,
    channelParameters: quote.parameters,
    seed: typeof parameters.seed === 'number' ? parameters.seed : undefined,
    outputFormat: parameters.output_format,
  };
}

function configuredImageResult(
  params: ImageGenerationParams,
  result: CompatibleImageResult,
  quote: ReturnType<typeof configuredImageGenerationQuote>,
  upstreamModel: string,
  started: number
): ImageGenerationResult {
  const mismatch = result.mismatches.find((item) => item.parameter !== 'n');
  if (mismatch)
    throw new Error(
      'Image channel did not honor parameter: ' + mismatch.parameter + '.'
    );
  const parameters = configuredImageResultParameters(params, quote);
  const { seed } = parameters;
  return {
    imageUrls: result.images.map((image) => image.dataUrl),
    parameters,
    generatedAt: new Date().toISOString(),
    processingTimeMs: Date.now() - started,
    via: 'compatible',
    metadata: {
      prompt: params.prompt,
      model: params.model,
      endpointId: upstreamModel,
      dimensions: result.images.map((image) => ({
        width: image.width,
        height: image.height,
      })),
      file_sizes: result.images.map((image) => image.byteLength),
      numImages: result.actualCount,
      ...(seed === undefined ? {} : { seed }),
      cost: multiplyMicros(usdToMicros(quote.unitPriceUsd), result.actualCount),
      usedOwnKey: false,
      requestId: result.requestId,
      configuredPricing: {
        priceCardId: quote.priceCardId,
        unitPriceUsd: quote.unitPriceUsd,
        imageCount: result.actualCount,
        requestedCount: quote.imageCount,
      },
      ...(result.usage ? { supplierUsage: result.usage } : {}),
    },
  };
}
