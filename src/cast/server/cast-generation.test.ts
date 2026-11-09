import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  quoteConfiguredPlanImages,
  referenceSheetImageRequests,
} from '@/billing/configured-image-plan-billing';
import { ZERO_MICROS, micros } from '@/billing/money';
import type { Microdollars } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ImageModelRoute } from '@/models/image-channels';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { PlanReferences } from '@/shots/server/update-stale-references';
import {
  computeCharacterSheetHashFromDto,
  computeLocationSheetHashFromDto,
} from '@/cast/server/workflows/sheet-snapshots';
import { asStub } from '@/test/as-stub';

type CharacterPayload = PlanReferences['characterSheets'][number];
type LocationPayload = PlanReferences['locationSheets'][number];
type SheetCase = {
  name: string;
  referenceCount: number;
  costMicros: Microdollars;
} & (
  | { kind: 'character'; overrides: Partial<CharacterPayload> }
  | { kind: 'location'; photos: string[] }
);
type PreparedSheet = {
  payload: CharacterPayload | LocationPayload;
  references: PlanReferences;
  run: () => Promise<unknown>;
  result: object;
  path: string;
  claim: Mock;
  claimArgs: unknown[];
  failClaim: Mock;
  targetId: string;
  versionId: string;
  claimFields: object;
  idempotencyKey: string;
};

const MODEL = 'custom-image:mock-sheet';
const REQUESTED_MODEL = 'nano_banana_2';
const GENERATE_COST = micros(10_000);
const EDIT_COST = micros(30_000);
const CHARACTER_ID = 'char-1';
const LOCATION_ID = 'location-1';
const SHEET_VERSION_ID = 'sheet-1';
const REFERENCE_VERSION_ID = 'reference-1';
const RESERVATION_ID = 'hold-1';
const WORKFLOW_RUN_ID = 'run-1';
const PHOTO_URL = '/r2/reference-photo.png';
const FACE = { url: '/r2/default-sheet.png', versionId: 'default-sheet-1' };
const ACTOR = { promptLocale: 'en', userId: 'user-1' } as const;
const mockLoadModels = vi.fn();
const mockBuildCharacterPayload = vi.fn();
const mockBuildLocationPayload = vi.fn();
const mockRequireCharacter = vi.fn();
const mockRequireLocation = vi.fn();
const mockRequireLook = vi.fn();
const mockTrigger = vi.fn();
const mockClaimSheet = vi.fn();
const mockFailSheetClaim = vi.fn();
const mockClaimReference = vi.fn();
const mockFailReferenceClaim = vi.fn();
const mockHasEnoughCredits = vi.fn();
const mockCreateReservation = vi.fn();
const mockZeroReservation = vi.fn();

// Mock DB, payload builders and workflow transport; pricing/preflight stay real.
vi.doMock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: mockLoadModels,
}));
vi.doMock('@/cast/server/cast-edit', () => ({
  requireCharacter: mockRequireCharacter,
  requireLocation: mockRequireLocation,
}));
vi.doMock('@/cast/server/character-look', () => ({
  requireCharacterLook: mockRequireLook,
  requireLiveLook: vi.fn((look) => look),
}));
vi.doMock('@/cast/server/sheets/character-sheet-trigger', () => ({
  buildRegenerateCharacterSheetPayload: mockBuildCharacterPayload,
}));
vi.doMock('@/cast/server/sheets/location-sheet-trigger', () => ({
  buildRegenerateLocationSheetPayload: mockBuildLocationPayload,
}));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: mockTrigger,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: vi.fn() }),
}));

const { regenerateCharacterSheet, regenerateLocationSheet } =
  await import('./cast-generation');

const EDIT_OPERATION = {
  upstreamModel: 'mock-sheet-edit',
  status: 'verified',
  minReferenceImages: 1,
  maxReferenceImages: 1,
  mask: 'unsupported',
} as const;
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
    edit: EDIT_OPERATION,
  },
  parameters: [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      status: 'verified',
      operations: ['generate', 'edit'],
      required: true,
      defaultValue: '512x512',
      values: ['512x512', '1024x576', '576x1024'],
    },
  ],
  priceCards: [
    {
      id: 'generate-wide',
      operation: 'generate',
      match: { size: '1024x576' },
      unitPriceUsd: 0.01,
    },
    {
      id: 'edit-wide',
      operation: 'edit',
      match: { size: '1024x576' },
      unitPriceUsd: 0.03,
    },
    {
      id: 'generate-other',
      operation: 'generate',
      match: {},
      unitPriceUsd: 0.02,
    },
    { id: 'edit-other', operation: 'edit', match: {}, unitPriceUsd: 0.06 },
  ],
};

const characterMetadata: CharacterPayload['characterMetadata'] = {
  characterId: CHARACTER_ID,
  name: 'Sam',
  age: '30s',
  gender: '',
  ethnicity: '',
  physicalDescription: '',
  standardClothing: 'duster',
  looks: [],
  personality: '',
  movement: '',
  voiceDescription: '',
  voiceOnly: false,
  isPerson: true,
  rendering: 'Photoreal live action',
  consistencyTag: 'sam',
};
const locationMetadata: LocationPayload['locationMetadata'] = {
  locationId: LOCATION_ID,
  name: 'Hall',
  type: 'interior',
  description: 'A stone hall',
  architecturalStyle: 'gothic',
  keyFeatures: 'stone arches',
  ambiance: 'quiet',
  rendering: 'Photoreal live action',
  consistencyTag: 'hall',
  firstMention: { sceneId: 'scene-1', text: 'Hall', lineNumber: 1 },
};

const cases: SheetCase[] = [
  {
    name: 'character default look without a photo uses generate',
    kind: 'character',
    overrides: {},
    referenceCount: 0,
    costMicros: GENERATE_COST,
  },
  {
    name: 'character default look with a photo uses edit',
    kind: 'character',
    overrides: { referencePhotoUrl: PHOTO_URL },
    referenceCount: 1,
    costMicros: EDIT_COST,
  },
  {
    name: 'character non-default face and mock photo remain one reference',
    kind: 'character',
    overrides: {
      lookId: 'look-office',
      face: FACE,
      referencePhotoUrl: PHOTO_URL,
    },
    referenceCount: 1,
    costMicros: EDIT_COST,
  },
  {
    name: 'location without photos uses generate',
    kind: 'location',
    photos: [],
    referenceCount: 0,
    costMicros: GENERATE_COST,
  },
  {
    name: 'location with multiple photos uses every reference for edit',
    kind: 'location',
    photos: [PHOTO_URL, '/r2/location-side.png'],
    referenceCount: 2,
    costMicros: EDIT_COST,
  },
];

function models(imageRoute = route): ModelRuntimeConfiguration {
  return { ...DEFAULT_MODEL_CONFIGURATION, imageModelRouting: [imageRoute] };
}

function routeFor(testCase: SheetCase): ImageModelRoute {
  const referenceCount = testCase.referenceCount || 1;
  return {
    ...route,
    operations: {
      ...route.operations,
      edit: {
        ...EDIT_OPERATION,
        minReferenceImages: referenceCount,
        maxReferenceImages: referenceCount,
      },
    },
  };
}

async function characterPayload(
  overrides: Partial<CharacterPayload>
): Promise<CharacterPayload> {
  const fields: Omit<CharacterPayload, 'snapshotInputHash'> = {
    userId: ACTOR.userId,
    organizationId: 'org-1',
    sequenceId: null,
    characterDbId: CHARACTER_ID,
    characterName: characterMetadata.name,
    characterMetadata,
    lookId: CHARACTER_ID,
    lookVersionId: 'look-version-1',
    lookStyling: null,
    face: null,
    referencePhotoUrl: null,
    bibleVersionId: null,
    imageModel: MODEL,
    ...overrides,
  };
  return {
    ...fields,
    snapshotInputHash: await computeCharacterSheetHashFromDto(fields),
  };
}

async function locationPayload(photos: string[]): Promise<LocationPayload> {
  const fields: Omit<LocationPayload, 'snapshotInputHash'> = {
    userId: ACTOR.userId,
    organizationId: 'org-1',
    sequenceId: null,
    locationDbId: LOCATION_ID,
    locationName: locationMetadata.name,
    locationMetadata,
    bibleVersionId: null,
    imageModel: MODEL,
    referencePhotoUrls: photos,
  };
  return {
    ...fields,
    snapshotInputHash: await computeLocationSheetHashFromDto(fields),
  };
}

function emptyReferences(): PlanReferences {
  return {
    characterSheets: [],
    lookSheetsAfterDefault: [],
    locationSheets: [],
    elementSheets: null,
    voices: [],
    cost: { sheets: ZERO_MICROS, voices: ZERO_MICROS },
  };
}

function makeScopedDb(): ScopedDb {
  // Mock only the scoped DB surfaces used by direct actions and real preflight.
  return asStub<ScopedDb>({
    organizationId: 'org-1',
    characterLooks: {
      claimSheet: mockClaimSheet,
      failSheetClaim: mockFailSheetClaim,
    },
    locations: {
      claimReference: mockClaimReference,
      failReferenceClaim: mockFailReferenceClaim,
    },
    billing: {
      hasEnoughCredits: mockHasEnoughCredits,
      createReservation: mockCreateReservation,
      zeroReservation: mockZeroReservation,
    },
    apiKeys: { hasUsableKey: vi.fn(async () => true) },
  });
}

async function prepareCharacter(
  overrides: Partial<CharacterPayload>
): Promise<PreparedSheet> {
  const payload = await characterPayload(overrides);
  const scopedDb = makeScopedDb();
  mockBuildCharacterPayload.mockResolvedValue(payload);
  mockRequireLook.mockResolvedValue({ isDefault: payload.face === null });
  return {
    payload,
    references: { ...emptyReferences(), characterSheets: [payload] },
    run: () =>
      regenerateCharacterSheet(scopedDb, ACTOR, null, {
        characterId: CHARACTER_ID,
        lookId: payload.lookId,
        imageModel: REQUESTED_MODEL,
      }),
    result: { characterId: CHARACTER_ID, workflowRunId: WORKFLOW_RUN_ID },
    path: '/character-sheet',
    claim: mockClaimSheet,
    claimArgs: [
      payload.lookId,
      payload,
      { markGenerating: true, activity: null },
    ],
    failClaim: mockFailSheetClaim,
    targetId: payload.lookId,
    versionId: SHEET_VERSION_ID,
    claimFields: { sheetVersionId: SHEET_VERSION_ID },
    idempotencyKey: 'character-sheet:' + SHEET_VERSION_ID,
  };
}

async function prepareLocation(photos: string[]): Promise<PreparedSheet> {
  const payload = await locationPayload(photos);
  const scopedDb = makeScopedDb();
  mockBuildLocationPayload.mockResolvedValue(payload);
  return {
    payload,
    references: { ...emptyReferences(), locationSheets: [payload] },
    run: () =>
      regenerateLocationSheet(scopedDb, ACTOR, null, {
        locationDbId: LOCATION_ID,
        imageModel: REQUESTED_MODEL,
      }),
    result: { locationDbId: LOCATION_ID, workflowRunId: WORKFLOW_RUN_ID },
    path: '/location-sheet',
    claim: mockClaimReference,
    claimArgs: [LOCATION_ID, { markGenerating: true, activity: null }],
    failClaim: mockFailReferenceClaim,
    targetId: LOCATION_ID,
    versionId: REFERENCE_VERSION_ID,
    claimFields: { referenceVersionId: REFERENCE_VERSION_ID },
    idempotencyKey: 'location-sheet:' + REFERENCE_VERSION_ID,
  };
}

function prepare(testCase: SheetCase): Promise<PreparedSheet> {
  mockLoadModels.mockResolvedValue(models(routeFor(testCase)));
  return testCase.kind === 'character'
    ? prepareCharacter(testCase.overrides)
    : prepareLocation(testCase.photos);
}

function expectPlanQuote(sheet: PreparedSheet, testCase: SheetCase) {
  expect(referenceSheetImageRequests(sheet.references)).toEqual([
    {
      model: MODEL,
      aspectRatio: '16:9',
      referenceImageCount: testCase.referenceCount,
    },
  ]);
  const quote = quoteConfiguredPlanImages(
    {
      targets: [],
      references: sheet.references,
      aspectRatio: '9:16',
    },
    models(routeFor(testCase)).imageModelRouting
  );
  expect(quote).toEqual({
    costMicros: testCase.costMicros,
    creditFloorMicros: testCase.costMicros,
    imageSource: 'platform',
  });
  return quote;
}

function firstCallOrder(mock: Mock): number {
  const [order] = mock.mock.invocationCallOrder;
  if (order === undefined) throw new Error('Expected mock to have been called');
  return order;
}

function expectStarted(sheet: PreparedSheet, testCase: SheetCase) {
  const quote = expectPlanQuote(sheet, testCase);
  expect(mockHasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
    quote.costMicros,
    undefined
  );
  expect(sheet.claim).toHaveBeenCalledExactlyOnceWith(...sheet.claimArgs);
  expect(mockCreateReservation).toHaveBeenCalledExactlyOnceWith(
    quote.costMicros,
    {
      idempotencyKey: sheet.idempotencyKey,
      sequenceId: undefined,
    }
  );
  expect(mockTrigger).toHaveBeenCalledExactlyOnceWith(
    sheet.path,
    {
      ...sheet.payload,
      ...sheet.claimFields,
      promptLocale: ACTOR.promptLocale,
      reservationId: RESERVATION_ID,
      ownsReservation: true,
    },
    {
      deduplicationId: sheet.idempotencyKey,
      modelConfiguration: models(routeFor(testCase)),
    }
  );
  expect(firstCallOrder(mockHasEnoughCredits)).toBeLessThan(
    firstCallOrder(sheet.claim)
  );
  expect(firstCallOrder(sheet.claim)).toBeLessThan(
    firstCallOrder(mockCreateReservation)
  );
  expect(firstCallOrder(mockCreateReservation)).toBeLessThan(
    firstCallOrder(mockTrigger)
  );
}

function expectNoClaimOrWorkflow() {
  expect(mockClaimSheet).not.toHaveBeenCalled();
  expect(mockClaimReference).not.toHaveBeenCalled();
  expect(mockCreateReservation).not.toHaveBeenCalled();
  expect(mockTrigger).not.toHaveBeenCalled();
  expect(mockZeroReservation).not.toHaveBeenCalled();
  expect(mockFailSheetClaim).not.toHaveBeenCalled();
  expect(mockFailReferenceClaim).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadModels.mockResolvedValue(models());
  mockRequireCharacter.mockResolvedValue({
    id: CHARACTER_ID,
    name: characterMetadata.name,
    looks: [
      {
        id: CHARACTER_ID,
        isDefault: true,
        name: 'Default',
        sheetImageUrl: FACE.url,
        sheetStatus: 'completed',
        selectedSheetVersionId: FACE.versionId,
      },
    ],
  });
  mockRequireLocation.mockResolvedValue({
    id: LOCATION_ID,
    name: locationMetadata.name,
  });
  mockClaimSheet.mockResolvedValue({ versionId: SHEET_VERSION_ID });
  mockClaimReference.mockResolvedValue(REFERENCE_VERSION_ID);
  mockFailSheetClaim.mockResolvedValue(undefined);
  mockFailReferenceClaim.mockResolvedValue(undefined);
  mockHasEnoughCredits.mockResolvedValue(true);
  mockCreateReservation.mockResolvedValue({
    ok: true,
    reservationId: RESERVATION_ID,
  });
  mockZeroReservation.mockResolvedValue(undefined);
  mockTrigger.mockResolvedValue(WORKFLOW_RUN_ID);
});

describe('cast sheet direct entry and configured plan quote agreement', () => {
  it.each(cases)('$name', async (testCase) => {
    const sheet = await prepare(testCase);
    expect(await sheet.run()).toEqual(sheet.result);
    expectStarted(sheet, testCase);
    expect(mockZeroReservation).not.toHaveBeenCalled();
    expect(sheet.failClaim).not.toHaveBeenCalled();
  });
});

describe('cast sheet credit rejection before claim, reserve and trigger', () => {
  it.each(cases)('$name', async (testCase) => {
    const sheet = await prepare(testCase);
    const quote = expectPlanQuote(sheet, testCase);
    mockHasEnoughCredits.mockResolvedValue(false);
    await expect(sheet.run()).rejects.toThrow('Insufficient credits');
    expect(mockHasEnoughCredits).toHaveBeenCalledExactlyOnceWith(
      quote.costMicros,
      undefined
    );
    expectNoClaimOrWorkflow();
  });
});

describe('cast sheet unsupported operation rejection before side effects', () => {
  it.each(cases)('$name', async (testCase) => {
    const sheet = await prepare(testCase);
    const current = routeFor(testCase);
    const unsupported = models({
      ...current,
      operations:
        testCase.referenceCount > 0
          ? { generate: current.operations.generate }
          : { edit: current.operations.edit },
    });
    mockLoadModels.mockResolvedValue(unsupported);
    expect(() =>
      quoteConfiguredPlanImages(
        {
          targets: [],
          references: sheet.references,
          aspectRatio: '9:16',
        },
        unsupported.imageModelRouting
      )
    ).toThrow('operation');
    await expect(sheet.run()).rejects.toThrow('operation');
    expect(mockHasEnoughCredits).not.toHaveBeenCalled();
    expectNoClaimOrWorkflow();
  });
});

describe('cast sheet trigger failure releases real preflight reservation', () => {
  it.each(cases)('$name', async (testCase) => {
    const sheet = await prepare(testCase);
    const failure = new Error('Mock workflow trigger unavailable');
    mockTrigger.mockRejectedValue(failure);
    await expect(sheet.run()).rejects.toBe(failure);
    expectStarted(sheet, testCase);
    expect(mockZeroReservation).toHaveBeenCalledExactlyOnceWith(RESERVATION_ID);
    expect(sheet.failClaim).toHaveBeenCalledExactlyOnceWith(
      sheet.targetId,
      sheet.versionId,
      failure.message
    );
    expect(firstCallOrder(mockTrigger)).toBeLessThan(
      firstCallOrder(mockZeroReservation)
    );
    expect(firstCallOrder(mockZeroReservation)).toBeLessThan(
      firstCallOrder(sheet.failClaim)
    );
  });
});
