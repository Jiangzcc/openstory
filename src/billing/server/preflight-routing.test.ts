import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { TextModelRoute } from '@/models/text-channels';
import { micros } from '@/billing/money';
import { InsufficientCreditsError } from '@/platform/errors';
import { asStub } from '@/test/as-stub';
import {
  requireCredits,
  reserveRunCredits,
  resolveLlmSources,
} from './preflight';

const mocks = vi.hoisted(() => ({
  decryptApiKey: vi.fn(),
  resolveSecret: vi.fn(),
}));
vi.mock('#env', () => ({
  getEnv: () => ({ OPENROUTER_KEY: 'mock-platform-key' }),
}));
vi.mock('@/platform/server/crypto/api-key-encryption', () => ({
  decryptApiKey: mocks.decryptApiKey,
  encryptApiKey: vi.fn(),
  getKeyHint: vi.fn(),
}));
vi.mock('@/models/server/db/text-channels', () => ({
  createTextChannelsReadMethods: () => ({ resolveSecret: mocks.resolveSecret }),
}));
const { createApiKeysReadMethods } =
  await import('@/models/server/db/api-keys');

const COST = micros(1000);
const ROUTE: TextModelRoute = {
  modelId: 'openai/gpt-5.4-mini',
  name: 'Mock built-in binding',
  upstreamModel: 'mock-upstream',
  channelId: 'mock-channel',
  credentialId: 'mock-credential',
  protocol: 'openai-responses',
  baseUrl: 'https://mock.invalid',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 8000,
  maxOutputTokens: 2000,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
};

function mockScope() {
  const encryptedTeamRow = {
    encryptedKey: 'mock-ciphertext',
    keyIv: 'mock-iv',
    keyTag: 'mock-tag',
    isInvalid: false,
    invalidReason: null,
  };
  const limit = vi
    .fn()
    .mockResolvedValue([])
    .mockResolvedValueOnce([encryptedTeamRow]);
  const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  const database = asStub<Database>({
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    update: () => ({ set }),
  });
  const apiKeys = createApiKeysReadMethods(database, 'mock-team');
  const createReservation = vi.fn(async () => ({ ok: false }));
  const scopedDb = asStub<ScopedDb>({
    apiKeys,
    billing: {
      hasEnoughCredits: async () => false,
      createReservation,
    },
  });
  return { scopedDb, set, createReservation };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSecret.mockResolvedValue('mock-channel-secret');
});

describe('billing follows resolved LLM credentials', () => {
  it('marks an undecryptable active team key invalid and requires platform funds', async () => {
    mocks.decryptApiKey.mockRejectedValue(new Error('Mock decryption failure'));
    const { scopedDb, set, createReservation } = mockScope();
    const llmSources = await resolveLlmSources(
      scopedDb,
      [ROUTE.modelId],
      [ROUTE]
    );
    expect(llmSources).toEqual(['platform']);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ isInvalid: true })
    );
    expect(mocks.resolveSecret).toHaveBeenCalledWith(ROUTE.credentialId);
    await expect(
      requireCredits(scopedDb, COST, {
        providers: ['openrouter'],
        llmSources,
      })
    ).rejects.toThrow(InsufficientCreditsError);
    await expect(
      reserveRunCredits(scopedDb, COST, {
        providers: ['openrouter'],
        llmSources,
      })
    ).rejects.toThrow(InsufficientCreditsError);
    expect(createReservation).toHaveBeenCalledOnce();
  });

  it('lets an actually decrypted team key cover a built-in binding at zero balance', async () => {
    mocks.decryptApiKey.mockResolvedValue('mock-team-secret');
    const { scopedDb, set, createReservation } = mockScope();
    const llmSources = await resolveLlmSources(
      scopedDb,
      [ROUTE.modelId],
      [ROUTE]
    );
    expect(llmSources).toEqual(['organization']);
    await expect(
      reserveRunCredits(scopedDb, COST, {
        providers: ['openrouter'],
        llmSources,
      })
    ).resolves.toBeUndefined();
    expect(mocks.resolveSecret).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });
});
