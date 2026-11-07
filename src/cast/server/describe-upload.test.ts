import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttestationRequiredError,
  InsufficientCreditsError,
} from '@/platform/errors';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelConfiguration } from '@/models/model-configuration';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { asStub } from '@/test/as-stub';

const callLLMStream = vi.fn();
vi.doMock('@/models/server/llm-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callLLMStream,
}));
vi.doMock('@/platform/server/storage/external-url', () => ({
  toVisionImageSource: async (value: string) => ({ type: 'url', value }),
}));

const { describeUpload } = await import('./describe-upload');

const organizationId = '01J00000000000000000000000';
const url = `/r2/characters/org/${organizationId}/characters/drafts/x.jpg`;
const VISION_MODEL = 'custom:upload-vision';
const ANSWERING_MODEL = 'z-ai/glm-5.3-flash';
const models = {
  ...DEFAULT_MODEL_CONFIGURATION,
  vision: VISION_MODEL,
} satisfies ModelConfiguration;

function context(
  rows: unknown[],
  source: 'platform' | 'organization' = 'platform'
) {
  const get = vi.fn(async () => models);
  const resolveLlmKey = vi
    .fn<ScopedDb['apiKeys']['resolveLlmKey']>()
    .mockResolvedValue({ key: 'mock-key', source, via: 'openrouter' });
  const hasEnoughCredits = vi.fn(async () => true);
  const deductCredits = vi.fn();
  const scopedDb = asStub<ScopedDb>({
    organizationId,
    modelConfiguration: { get },
    compliance: {
      attestations: { listForSubject: vi.fn(async () => rows) },
    },
    apiKeys: { resolveLlmKey },
    billing: { hasEnoughCredits, deductCredits },
  });
  return { scopedDb, get, resolveLlmKey, hasEnoughCredits, deductCredits };
}

function describeImage(
  scopedDb: Parameters<typeof describeUpload>[0]['scopedDb'],
  subject: 'character' | 'location' = 'character'
) {
  return describeUpload({
    scopedDb,
    userId: 'u',
    url,
    filename: 'x.jpg',
    subject,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  callLLMStream.mockImplementation(async function* () {
    yield {
      done: true,
      delta: '',
      accumulated: '',
      parsed: {
        description: '  A portrait description.  ',
        isCharacterSheet: true,
      },
      model: ANSWERING_MODEL,
      via: 'openrouter',
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cost: 0.004,
      },
    };
  });
});

const cleared = [{ statementVersion: 'likeness-cleared-v1' }];

describe('describeUpload', () => {
  it('sends nothing to the model for an upload with no likeness verdict', async () => {
    const c = context([]);
    await expect(describeImage(c.scopedDb)).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expect(callLLMStream).not.toHaveBeenCalled();
    expect(c.get).not.toHaveBeenCalled();
  });

  it('uses the configured vision route and bills the model that answered', async () => {
    const c = context(cleared);
    await expect(describeImage(c.scopedDb)).resolves.toEqual({
      description: 'A portrait description.',
      isCharacterSheet: true,
    });
    expect(c.get).toHaveBeenCalledOnce();
    expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(VISION_MODEL);
    const request = callLLMStream.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: VISION_MODEL,
      apiKey: { source: 'platform', via: 'openrouter' },
    });
    await request.resolveApiKey(ANSWERING_MODEL);
    expect(c.resolveLlmKey).toHaveBeenLastCalledWith(ANSWERING_MODEL);
    expect(c.deductCredits).toHaveBeenCalledWith(
      4000,
      expect.objectContaining({
        metadata: { model: ANSWERING_MODEL, subject: 'character' },
        idempotencyKey: expect.stringMatching(/^describe-upload:/),
      })
    );
  });

  it('honors a supplied model snapshot without reading mutable configuration', async () => {
    const c = context(cleared);
    await describeImage({ ...c.scopedDb, models });
    expect(c.get).not.toHaveBeenCalled();
    expect(c.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(VISION_MODEL);
  });

  it('does not send a platform call when credits are insufficient', async () => {
    const c = context(cleared);
    c.hasEnoughCredits.mockResolvedValue(false);
    await expect(describeImage(c.scopedDb)).rejects.toBeInstanceOf(
      InsufficientCreditsError
    );
    expect(callLLMStream).not.toHaveBeenCalled();
    expect(c.deductCredits).not.toHaveBeenCalled();
  });

  it('keeps organization-key calls uncharged and location results sheet-free', async () => {
    const c = context(cleared, 'organization');
    await expect(describeImage(c.scopedDb, 'location')).resolves.toMatchObject({
      isCharacterSheet: null,
    });
    expect(c.hasEnoughCredits).not.toHaveBeenCalled();
    expect(c.deductCredits).not.toHaveBeenCalled();
  });
});
