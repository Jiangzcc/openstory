import { beforeEach, describe, expect, it, vi } from 'vitest';
import { micros } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { StudioPromptDraftInput } from '@/studio/schema';
import { asStub } from '@/test/as-stub';
import type {
  TextModelRoute,
  TextModelRoutingSnapshot,
} from '@/models/text-channels';

const CUSTOM_ROUTE: TextModelRoute = {
  modelId: 'custom:request-model',
  name: 'Request model',
  channelId: 'test-channel',
  upstreamModel: 'upstream-model',
  credentialId: 'test-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://models.example/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};

const MODEL = 'google/gemini-3.8-flash' as const;
const ANSWERING_MODEL = 'z-ai/glm-5.3-flash';
const COST = micros(240);
const mockDraft = vi.fn();
vi.doMock('@/studio/server/studio-prompt-draft', () => ({
  draftStudioPrompt: mockDraft,
}));
vi.doMock('@/platform/server/storage/storage-cloudflare', () => ({
  deleteFile: vi.fn(),
}));
const { draftStudioPromptForOrganization } =
  await import('./studio-asset-actions');

beforeEach(() => {
  vi.clearAllMocks();
  mockDraft.mockResolvedValue({
    prompt: 'A camera move.',
    model: ANSWERING_MODEL,
    costMicros: COST,
    usedOwnKey: false,
  });
});

describe('configured Studio prompt draft', () => {
  it('takes its model from the server and bills the answering model', async () => {
    const resolveLlmKey = vi.fn(async () => ({
      key: 'test-key',
      via: 'openrouter',
      source: 'platform',
    }));
    const deductCredits = vi.fn();
    const scopedDb = asStub<ScopedDb>({
      userId: 'u',
      apiKeys: { resolveLlmKey },
      textChannels: { getSnapshot: async () => [] },
      modelConfiguration: {
        get: async () => ({
          ...DEFAULT_MODEL_CONFIGURATION,
          studioDraft: MODEL,
        }),
      },
      billing: { hasEnoughCredits: async () => true, deductCredits },
    });
    const data = asStub<StudioPromptDraftInput>({
      activity: 'video',
      references: [],
      model: 'anthropic/claude-opus-5.5',
      modelConfiguration: { studioDraft: 'anthropic/claude-opus-5.5' },
    });
    expect(await draftStudioPromptForOrganization(scopedDb, data)).toEqual({
      prompt: 'A camera move.',
    });
    expect(resolveLlmKey).toHaveBeenCalledExactlyOnceWith(MODEL, []);
    expect(mockDraft).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL })
    );
    expect(deductCredits).toHaveBeenCalledWith(
      COST,
      expect.objectContaining({ metadata: { model: ANSWERING_MODEL } })
    );
  });
});

function customDraftContext(snapshot: TextModelRoutingSnapshot) {
  const resolveLlmKey = vi.fn(async () => ({
    key: 'mock-key',
    via: 'compatible',
    source: 'platform',
  }));
  const scopedDb = asStub<ScopedDb>({
    userId: 'u',
    apiKeys: { resolveLlmKey },
    textChannels: { getSnapshot: vi.fn(async () => snapshot) },
    modelConfiguration: {
      get: async () => ({
        ...DEFAULT_MODEL_CONFIGURATION,
        studioDraft: CUSTOM_ROUTE.modelId,
      }),
    },
    billing: { hasEnoughCredits: async () => true, deductCredits: vi.fn() },
  });
  return { scopedDb, resolveLlmKey };
}

describe('custom Studio draft routes', () => {
  it('uses the configured custom model and one snapshot for every key lookup', async () => {
    const snapshot = [CUSTOM_ROUTE];
    const { scopedDb, resolveLlmKey } = customDraftContext(snapshot);
    await draftStudioPromptForOrganization(scopedDb, {
      activity: 'image',
      references: [],
    });
    expect(resolveLlmKey).toHaveBeenCalledExactlyOnceWith(
      CUSTOM_ROUTE.modelId,
      snapshot
    );
    expect(scopedDb.textChannels.getSnapshot).toHaveBeenCalledOnce();
    const input = mockDraft.mock.calls[0]?.[0];
    expect(input.model).toBe(CUSTOM_ROUTE.modelId);
    await input.resolveLlmKey(ANSWERING_MODEL);
    expect(resolveLlmKey).toHaveBeenLastCalledWith(ANSWERING_MODEL, snapshot);
  });

  it.each([
    { snapshot: [] },
    { snapshot: [{ ...CUSTOM_ROUTE, vision: false }] },
  ])(
    'rejects missing routes or unsupported image input before drafting',
    async ({ snapshot }) => {
      const { scopedDb, resolveLlmKey } = customDraftContext(snapshot);
      await expect(
        draftStudioPromptForOrganization(scopedDb, {
          activity: 'image',
          references: [
            {
              url: 'https://cdn.example/cyclist.png',
              label: 'Cyclist',
              kind: 'image',
            },
          ],
        })
      ).rejects.toThrow('unavailable or lacks vision');
      expect(resolveLlmKey).not.toHaveBeenCalled();
      expect(mockDraft).not.toHaveBeenCalled();
    }
  );
});
