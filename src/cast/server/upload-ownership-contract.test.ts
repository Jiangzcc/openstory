import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createTestDb } from '@/platform/server/db/test-d1';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { createComplianceMethods } from '@/platform/server/db/scoped/compliance';
import { createLocationsMethods } from './db/locations';
import { organization, user } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { sha256Hex } from '@/platform/compliance/hash';
import {
  LIKENESS_CLEARED_V1,
  LIKENESS_DETECTED_V1,
  PORTRAIT_RIGHTS_V1,
  statementHash,
} from '@/platform/compliance/attestations';
import type { AttestationStatement } from '@/platform/compliance/attestations';
import { AttestationRequiredError, ValidationError } from '@/platform/errors';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { asStub } from '@/test/as-stub';
import { createOrganizationLocation } from './locations/organization-locations';
import { describeUpload } from './describe-upload';

// Real D1 ledger and location writes; storage, sheet dispatch and vision are stubs.
const mocks = vi.hoisted(() => ({
  sheet: vi.fn(),
  vision: vi.fn(),
  fileExists: vi.fn(),
  resolveLlmKey: vi.fn(),
  hasEnoughCredits: vi.fn(),
  deductCredits: vi.fn(),
}));
vi.mock('#storage', () => ({ fileExists: mocks.fileExists }));
vi.mock('./cast-generation', () => ({ regenerateLocationSheet: mocks.sheet }));
vi.mock('@/models/server/llm-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callLLMStream: mocks.vision,
}));
vi.mock('@/platform/server/storage/external-url', () => ({
  toVisionImageSource: async (value: string) => ({ type: 'url', value }),
}));

const SCENARIO = {
  UNCHECKED: 'unchecked',
  DETECTED: 'unsigned portrait',
  FOREIGN_LEDGER: 'another organization verdict',
  FOREIGN_OBJECT: 'another organization object with a local verdict',
} as const;
type Scenario = (typeof SCENARIO)[keyof typeof SCENARIO];
const rejectionCases = Object.values(SCENARIO);
let db: Database;
let closeDb: () => Promise<void>;
let scopedDb: ScopedDb;
let otherOrganizationId: string;
let uploadUrl: string;

function scope(organizationId: string, userId: string): ScopedDb {
  return asStub<ScopedDb>({
    organizationId,
    userId,
    locations: createLocationsMethods(db, organizationId),
    compliance: createComplianceMethods(db, organizationId, userId),
    modelConfiguration: { get: async () => DEFAULT_MODEL_CONFIGURATION },
    apiKeys: { resolveLlmKey: mocks.resolveLlmKey },
    billing: {
      hasEnoughCredits: mocks.hasEnoughCredits,
      deductCredits: mocks.deductCredits,
    },
  });
}

async function verdict(
  target: ScopedDb,
  url: string,
  statement: AttestationStatement
) {
  return target.compliance.attestations.record({
    subjectType: 'uploaded_image',
    subjectId: await sha256Hex(url),
    statementVersion: statement.version,
    statementSha256: await statementHash(statement),
    depictsRealPerson: statement !== LIKENESS_CLEARED_V1,
  });
}

async function prepareRejection(scenario: Scenario) {
  if (scenario === SCENARIO.DETECTED) {
    await verdict(scopedDb, uploadUrl, LIKENESS_DETECTED_V1);
  }
  if (scenario === SCENARIO.FOREIGN_LEDGER) {
    await verdict(
      scope(otherOrganizationId, scopedDb.userId),
      uploadUrl,
      LIKENESS_CLEARED_V1
    );
  }
  if (scenario === SCENARIO.FOREIGN_OBJECT) {
    uploadUrl = `/r2/locations/${otherOrganizationId}/uploads/photo.png`;
    await verdict(scopedDb, uploadUrl, LIKENESS_CLEARED_V1);
  }
}

function createLocation(photoUrls = [uploadUrl]) {
  return createOrganizationLocation(
    scopedDb,
    {
      name: '青岛·海边 café',
      description: null,
      rendering: 'Photoreal',
      photoUrls,
    },
    {
      userId: scopedDb.userId,
      organizationId: scopedDb.organizationId,
      promptLocale: 'zh-CN',
      triggerSheet: true,
    }
  );
}

function describePhoto() {
  return describeUpload({
    promptLocale: 'zh-CN',
    scopedDb,
    userId: scopedDb.userId,
    url: uploadUrl,
    filename: '海边.png',
    subject: 'location',
  });
}

function expectNoPaidWork() {
  expect(mocks.sheet).not.toHaveBeenCalled();
  expect(mocks.vision).not.toHaveBeenCalled();
  expect(mocks.resolveLlmKey).not.toHaveBeenCalled();
  expect(mocks.hasEnoughCredits).not.toHaveBeenCalled();
  expect(mocks.deductCredits).not.toHaveBeenCalled();
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => closeDb());
beforeEach(async () => {
  vi.clearAllMocks();
  const organizationId = generateId();
  const userId = generateId();
  otherOrganizationId = generateId();
  await db.insert(organization).values(
    [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: id,
      slug: id,
    }))
  );
  await db
    .insert(user)
    .values({ id: userId, name: 'Owner', email: userId + '@example.test' });
  scopedDb = scope(organizationId, userId);
  uploadUrl = `/r2/locations/${organizationId}/uploads/photo.png`;
  mocks.fileExists.mockResolvedValue(true);
  mocks.sheet.mockImplementation(async (_db, _actor, _sequence, data) => ({
    locationDbId: data.locationDbId,
    workflowRunId: 'stub-sheet-run',
  }));
  mocks.resolveLlmKey.mockResolvedValue({
    key: 'stub-key',
    source: 'platform',
    via: 'openrouter',
  });
  mocks.hasEnoughCredits.mockResolvedValue(true);
  mocks.vision.mockImplementation(async function* () {
    yield {
      done: true,
      parsed: { description: 'A seaside café', isCharacterSheet: false },
      model: DEFAULT_MODEL_CONFIGURATION.vision,
      via: 'openrouter',
      usage: { cost: 0.004 },
    };
  });
});

describe('real upload ledger at service boundaries', () => {
  it.each(rejectionCases)(
    'refuses location creation for %s before writes or sheet dispatch',
    async (scenario) => {
      await prepareRejection(scenario);
      const error =
        scenario === SCENARIO.FOREIGN_OBJECT
          ? ValidationError
          : AttestationRequiredError;
      await expect(createLocation()).rejects.toBeInstanceOf(error);
      expect(await scopedDb.locations.listOrganization()).toEqual([]);
      expectNoPaidWork();
    }
  );

  it.each(rejectionCases)(
    'refuses vision for %s before credentials, balance and model calls',
    async (scenario) => {
      await prepareRejection(scenario);
      const error =
        scenario === SCENARIO.FOREIGN_OBJECT
          ? ValidationError
          : AttestationRequiredError;
      await expect(describePhoto()).rejects.toBeInstanceOf(error);
      expectNoPaidWork();
    }
  );
});

describe('photo batch and owned dispatch', () => {
  it('refuses an entire photo batch when a later photo lacks a verdict', async () => {
    await verdict(scopedDb, uploadUrl, LIKENESS_CLEARED_V1);
    const unchecked = uploadUrl.replace('photo.png', 'unchecked.png');
    await expect(createLocation([uploadUrl, unchecked])).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expect(await scopedDb.locations.listOrganization()).toEqual([]);
    expect(mocks.fileExists).not.toHaveBeenCalled();
    expectNoPaidWork();
  });

  it.each([LIKENESS_CLEARED_V1, PORTRAIT_RIGHTS_V1])(
    'accepts $version for an owned photo and keeps the organization-only dispatch',
    async (statement) => {
      await verdict(scopedDb, uploadUrl, statement);
      const location = await createLocation();
      expect(location.organizationId).toBe(scopedDb.organizationId);
      expect(await scopedDb.locations.listPhotos(location.id)).toMatchObject([
        { url: uploadUrl },
      ]);
      expect(mocks.sheet).toHaveBeenCalledExactlyOnceWith(
        scopedDb,
        { userId: scopedDb.userId, promptLocale: 'zh-CN' },
        null,
        { locationDbId: location.id }
      );
      expect(
        await createLocationsMethods(db, otherOrganizationId).getCurrent(
          location.id
        )
      ).toBeNull();
    }
  );
});

describe('portrait sign-off before vision', () => {
  it('uses the later portrait sign-off through the real ledger before vision billing', async () => {
    await verdict(scopedDb, uploadUrl, LIKENESS_DETECTED_V1);
    await expect(describePhoto()).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expectNoPaidWork();
    await verdict(scopedDb, uploadUrl, PORTRAIT_RIGHTS_V1);
    await expect(describePhoto()).resolves.toEqual({
      description: 'A seaside café',
      isCharacterSheet: null,
    });
    expect(mocks.vision).toHaveBeenCalledOnce();
    expect(mocks.deductCredits).toHaveBeenCalledWith(4000, expect.any(Object));
  });
});
