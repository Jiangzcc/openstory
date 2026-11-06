import type { CompatibleImageParameters } from './compatible-image-parameters';

type CompatibleImageOperation = 'generate' | 'edit';
export type CompatibleImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface CompatibleImageInput {
  baseUrl: string;
  apiKey: string;
  upstreamModel: string;
  operation: CompatibleImageOperation;
  prompt: string;
  parameters?: CompatibleImageParameters;
  references: readonly File[];
  mask?: File;
}

export interface CompatibleImageOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface CompatibleImage {
  dataUrl: string;
  width: number;
  height: number;
  mimeType: CompatibleImageMime;
  byteLength: number;
}

export interface CompatibleImageUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokensDetails?: { imageTokens?: number; textTokens?: number };
  outputTokensDetails?: { imageTokens?: number; textTokens?: number };
}

export interface CompatibleImageMismatch {
  parameter: 'size' | 'output_format' | 'quality' | 'background' | 'n';
  requested: string | number;
  actual: string | number;
  imageIndex?: number;
  basis: 'bytes' | 'count' | 'reported';
}

export interface CompatibleImageResult {
  images: CompatibleImage[];
  requestedCount: number;
  actualCount: number;
  returnedCount: number;
  status: 'complete' | 'partial';
  mismatches: CompatibleImageMismatch[];
  usage?: CompatibleImageUsage;
  requestId?: string;
  reported: {
    size?: string;
    outputFormat?: string;
    quality?: string;
    background?: string;
  };
}
