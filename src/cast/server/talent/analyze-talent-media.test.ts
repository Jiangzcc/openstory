import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { micros } from '@/billing/money';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { ValidationError } from '@/platform/errors';
import { asStub } from '@/test/as-stub';

const mockUpload = vi.fn();
const mockAnalyzeClip = vi.fn();
const mockAnalyzeMedia = vi.fn();
const mockDelete = vi.fn();
vi.doMock('@/models/server/gemini-files', () => ({
  uploadClipToGemini: mockUpload,
  deleteGeminiFile: mockDelete,
}));
vi.doMock('@/cast/server/talent-vision', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  analyzeTalentClip: mockAnalyzeClip,
  analyzeTalentMedia: mockAnalyzeMedia,
}));

const { analyzeTalentClipForOrganization, analyzeTalentMediaForOrganization } =
  await import('./analyze-talent-media');

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue(undefined);
});

describe('analyzeTalentClipForOrganization', () => {
  it('refuses missing native Google credentials before the clip leaves storage (#1930)', async () => {
    const scopedDb = asStub<ScopedDb>({
      modelConfiguration: { get: async () => DEFAULT_MODEL_CONFIGURATION },
      apiKeys: {
        resolveOptionalKey: async () => undefined,
      },
    });

    await expect(
      analyzeTalentClipForOrganization({
        promptLocale: 'en',
        scopedDb,
        userId: 'u',
        key: 'talent/t/uploads/clip.mp4',
        mimeType: 'video/mp4',
        idempotencyKey: 'likeness:x',
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockAnalyzeClip).not.toHaveBeenCalled();
  });
});

const IMAGE_MODEL = 'z-ai/glm-5.3-flash' as const;
const VIDEO_MODEL = 'google/gemini-4-argon' as const;
const COST = micros(260);
const configuredModels = {
  ...DEFAULT_MODEL_CONFIGURATION,
  vision: IMAGE_MODEL,
  talentVideo: VIDEO_MODEL,
};

function configuredContext() {
  const get = vi.fn(async () => configuredModels);
  const resolveLlmKey = vi.fn(async () => ({
    key: 'k',
    via: 'google' as const,
    source: 'platform' as const,
  }));
  const resolveOptionalKey = vi
    .fn<ScopedDb['apiKeys']['resolveOptionalKey']>()
    .mockResolvedValue({ key: 'k', source: 'platform' });
  const deductCredits = vi.fn();
  const scopedDb = asStub<ScopedDb>({
    apiKeys: { resolveLlmKey, resolveOptionalKey },
    modelConfiguration: { get },
    billing: { hasEnoughCredits: async () => true, deductCredits },
  });
  return { scopedDb, get, resolveLlmKey, resolveOptionalKey, deductCredits };
}

function analysisResult(model: string) {
  return { model, costMicros: COST, usedOwnKey: false, subjectKind: 'other' };
}

describe('configured likeness models and billing', () => {
  it('uses the server image model and bills the actual answering model', async () => {
    const c = configuredContext();
    mockAnalyzeMedia.mockResolvedValue(
      analysisResult('anthropic/claude-sonnet-5.5')
    );
    await analyzeTalentMediaForOrganization({
      promptLocale: 'en',
      scopedDb: c.scopedDb,
      userId: 'u',
      imageUrls: ['/r2/talent/t/a.png'],
      idempotencyKey: 'likeness:image',
    });
    expect(c.get).toHaveBeenCalledOnce();
    expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(IMAGE_MODEL);
    expect(mockAnalyzeMedia).toHaveBeenCalledWith(
      expect.objectContaining({ model: IMAGE_MODEL })
    );
    expect(c.deductCredits).toHaveBeenCalledWith(
      COST,
      expect.objectContaining({
        metadata: { model: 'anthropic/claude-sonnet-5.5' },
        idempotencyKey: 'likeness:image',
      })
    );
  });

  it('uses the workflow snapshot without reading mutable configuration', async () => {
    const c = configuredContext();
    const snapshotModel = 'google/gemini-3.8-flash' as const;
    const scopedDb = {
      ...c.scopedDb,
      models: { ...configuredModels, vision: snapshotModel },
    };
    mockAnalyzeMedia.mockResolvedValue(analysisResult(snapshotModel));
    await analyzeTalentMediaForOrganization({
      promptLocale: 'en',
      scopedDb,
      userId: 'u',
      imageUrls: ['/r2/talent/t/a.png'],
      idempotencyKey: 'likeness:snapshot',
    });
    expect(c.get).not.toHaveBeenCalled();
    expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(snapshotModel);
    expect(mockAnalyzeMedia).toHaveBeenCalledWith(
      expect.objectContaining({ model: snapshotModel })
    );
  });

  it('uses the configured native video model and preserves cleanup and billing', async () => {
    const c = configuredContext();
    mockUpload.mockResolvedValue({
      uri: 'https://files.example/clip',
      name: 'files/clip',
      mimeType: 'video/mp4',
    });
    mockAnalyzeClip.mockResolvedValue(analysisResult(VIDEO_MODEL));
    await analyzeTalentClipForOrganization({
      promptLocale: 'en',
      scopedDb: c.scopedDb,
      userId: 'u',
      key: 'talent/t/clip.mp4',
      mimeType: 'video/mp4',
      idempotencyKey: 'likeness:clip',
    });
    expect(c.resolveOptionalKey).toHaveBeenCalledExactlyOnceWith('google');
    expect(c.resolveLlmKey).not.toHaveBeenCalled();
    expect(mockAnalyzeClip).toHaveBeenCalledWith(
      expect.objectContaining({ model: VIDEO_MODEL })
    );
    expect(c.deductCredits).toHaveBeenCalledWith(
      COST,
      expect.objectContaining({ metadata: { model: VIDEO_MODEL } })
    );
    expect(mockDelete).toHaveBeenCalledExactlyOnceWith('files/clip', 'k');
  });
});
