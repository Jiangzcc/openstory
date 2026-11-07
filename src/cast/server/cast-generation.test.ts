import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ImageModelRoute } from '@/models/image-channels';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { CharacterSheetWorkflowInput } from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import { micros } from '@/billing/money';

const MODEL = 'custom-image:mock-sheet';
const mockLoadModels = vi.fn();
const mockBuildPayload = vi.fn();
const mockTrigger = vi.fn();
const mockClaimSheet = vi.fn();
const mockHasEnoughCredits = vi.fn();
const mockCreateReservation = vi.fn();

vi.doMock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: mockLoadModels,
}));
vi.doMock('@/cast/server/cast-edit', () => ({
  requireCharacter: vi.fn(async () => ({
    id: 'char-1',
    name: 'Sam',
    looks: [],
  })),
}));
vi.doMock('@/cast/server/character-look', () => ({
  requireCharacterLook: vi.fn(async () => ({ isDefault: true })),
  requireLiveLook: vi.fn((look) => look),
}));
vi.doMock('@/cast/server/sheets/character-sheet-trigger', () => ({
  buildRegenerateCharacterSheetPayload: mockBuildPayload,
}));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: mockTrigger,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: vi.fn() }),
}));

const { regenerateCharacterSheet } = await import('./cast-generation');

const route: ImageModelRoute = {
  modelId: MODEL,
  name: 'Mock sheet model',
  channelId: 'mock-channel',
  protocol: 'openai-images',
  baseUrl: 'https://mock.invalid/v1',
  credentialId: 'mock-credential',
  operations: {
    generate: {
      upstreamModel: 'mock-sheet',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
    edit: {
      upstreamModel: 'mock-sheet-edit',
      status: 'verified',
      minReferenceImages: 1,
      maxReferenceImages: 1,
      mask: 'unsupported',
    },
  },
  parameters: [],
  priceCards: [
    { id: 'generate', operation: 'generate', match: {}, unitPriceUsd: 0.01 },
    { id: 'edit', operation: 'edit', match: {}, unitPriceUsd: 0.03 },
  ],
};

function models(imageRoute = route): ModelRuntimeConfiguration {
  return { ...DEFAULT_MODEL_CONFIGURATION, imageModelRouting: [imageRoute] };
}

function makeScopedDb(): ScopedDb {
  // Stub only the trigger, claim and real preflight surfaces this action uses.
  return asStub<ScopedDb>({
    organizationId: 'org-1',
    characterLooks: { claimSheet: mockClaimSheet, failSheetClaim: vi.fn() },
    billing: {
      hasEnoughCredits: mockHasEnoughCredits,
      createReservation: mockCreateReservation,
    },
    apiKeys: { hasUsableKey: vi.fn(async () => true) },
  });
}

function regenerate() {
  return regenerateCharacterSheet(
    makeScopedDb(),
    { promptLocale: 'en', userId: 'user-1' },
    null,
    {
      characterId: 'char-1',
      lookId: 'char-1',
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadModels.mockResolvedValue(models());
  // Payload construction is mocked; pricing and credit gates use real modules.
  mockBuildPayload.mockResolvedValue(
    asStub<CharacterSheetWorkflowInput>({
      imageModel: MODEL,
      sequenceId: null,
      lookId: 'char-1',
      face: null,
      referencePhotoUrl: '/r2/reference-photo.png',
    })
  );
  mockClaimSheet.mockResolvedValue({ versionId: 'sheet-1' });
  mockHasEnoughCredits.mockResolvedValue(true);
  mockCreateReservation.mockResolvedValue({
    ok: true,
    reservationId: 'hold-1',
  });
  mockTrigger.mockResolvedValue('run-1');
});

describe('regenerateCharacterSheet configured reference photos', () => {
  it('checks and reserves the edit price before triggering with the same routing snapshot', async () => {
    expect(await regenerate()).toEqual({
      characterId: 'char-1',
      workflowRunId: 'run-1',
    });
    expect(mockHasEnoughCredits).toHaveBeenCalledWith(
      micros(30_000),
      undefined
    );
    expect(mockCreateReservation).toHaveBeenCalledWith(micros(30_000), {
      idempotencyKey: 'character-sheet:sheet-1',
      sequenceId: undefined,
    });
    expect(mockTrigger).toHaveBeenCalledWith(
      '/character-sheet',
      expect.objectContaining({ referencePhotoUrl: '/r2/reference-photo.png' }),
      {
        deduplicationId: 'character-sheet:sheet-1',
        modelConfiguration: models(),
      }
    );
  });

  it('refuses insufficient credits before taking a claim or starting a workflow', async () => {
    mockHasEnoughCredits.mockResolvedValue(false);
    await expect(regenerate()).rejects.toThrow('Insufficient credits');
    expect(mockHasEnoughCredits).toHaveBeenCalledWith(
      micros(30_000),
      undefined
    );
    expect(mockClaimSheet).not.toHaveBeenCalled();
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it('refuses a generate-only route before taking a sheet claim', async () => {
    mockLoadModels.mockResolvedValue(
      models({ ...route, operations: { generate: route.operations.generate } })
    );
    await expect(regenerate()).rejects.toThrow('operation');
    expect(mockClaimSheet).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });
});
