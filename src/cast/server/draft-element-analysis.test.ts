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
import {
  AttestationRequiredError,
  InsufficientCreditsError,
  ValidationError,
} from '@/platform/errors';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { asStub } from '@/test/as-stub';
import { analyzeDraftElementFn } from '@/cast/sequence-elements.fn';

// Real handler and D1 ledger; trusted context, Start builder and paid work are stubs.
const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  resolveLlmKey: vi.fn(),
  hasEnoughCredits: vi.fn(),
  deductCredits: vi.fn(),
  vision: vi.fn(),
  missingCost: vi.fn(),
}));
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      validator: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock('@/platform/middleware.fn', () => ({
  authWithOrganizationMiddleware: {},
  sequenceAccessMiddleware: {},
}));
vi.mock('#storage', () => ({ getSignedUploadUrl: vi.fn() }));
vi.mock('@/cast/server/cast-edit', () => ({
  deleteElement: vi.fn(),
  renameElementToken: vi.fn(),
  restoreElement: vi.fn(),
  setElementDescription: vi.fn(),
}));
vi.mock('@/cast/server/sequence-elements/attach-element-upload', () => ({
  attachElementUpload: vi.fn(),
  elementKindOrThrow: vi.fn(),
  replaceElementUpload: vi.fn(),
}));
vi.mock('@/cast/server/sequence-elements/media-duration', () => ({
  withMeasuredDurations: vi.fn(),
}));
vi.mock('@/cast/server/element-vision', () => ({
  describeElementImage: mocks.vision,
}));
vi.mock('@/billing/billing-observability', () => ({
  reportMissingBillingCost: mocks.missingCost,
}));

const COST_MICROS = 4_000;
const model = DEFAULT_MODEL_CONFIGURATION.vision;
const organizationId = generateId();
const otherOrganizationId = generateId();
const userId = generateId();
let db: Database;
let closeDb: () => Promise<void>;
let scopedDb: ScopedDb;
let uploadUrl: string;
const description = {
  description: 'A brass lantern',
  consistencyTag: 'brass_lantern',
  suggestedToken: 'lantern',
};
const analyze = asStub<
  (input: {
    context: {
      scopedDb: ScopedDb;
      organizationId: string;
      user: { id: string };
      promptLocale: 'zh-CN' | 'en';
    };
    data: { publicUrl: string; filename: string };
  }) => Promise<typeof description>
>(analyzeDraftElementFn);

function scope(ownerId: string): ScopedDb {
  return asStub<ScopedDb>({
    organizationId: ownerId,
    userId,
    compliance: createComplianceMethods(db, ownerId, userId),
    modelConfiguration: { get: mocks.configuration },
    apiKeys: { resolveLlmKey: mocks.resolveLlmKey },
    billing: {
      hasEnoughCredits: mocks.hasEnoughCredits,
      deductCredits: mocks.deductCredits,
    },
  });
}

async function verdict(
  url: string,
  statement: AttestationStatement,
  target = scopedDb
) {
  await target.compliance.attestations.record({
    subjectType: 'uploaded_image',
    subjectId: await sha256Hex(url),
    statementVersion: statement.version,
    statementSha256: await statementHash(statement),
    depictsRealPerson: statement !== LIKENESS_CLEARED_V1,
  });
}

function describeDraft(promptLocale: 'zh-CN' | 'en' = 'zh-CN') {
  return analyze({
    context: { scopedDb, organizationId, user: { id: userId }, promptLocale },
    data: { publicUrl: uploadUrl, filename: '灯笼.png' },
  });
}

function expectNoPaidWork() {
  expect(mocks.configuration).not.toHaveBeenCalled();
  expect(mocks.resolveLlmKey).not.toHaveBeenCalled();
  expect(mocks.hasEnoughCredits).not.toHaveBeenCalled();
  expect(mocks.vision).not.toHaveBeenCalled();
  expect(mocks.deductCredits).not.toHaveBeenCalled();
  expect(mocks.missingCost).not.toHaveBeenCalled();
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  await db.insert(organization).values(
    [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: id,
      slug: id,
    }))
  );
  await db
    .insert(user)
    .values({ id: userId, name: 'Owner', email: `${userId}@example.test` });
});
afterAll(async () => closeDb());
beforeEach(() => {
  vi.clearAllMocks();
  scopedDb = scope(organizationId);
  uploadUrl = `/r2/elements/${organizationId}/uploads/${generateId()}.png`;
  mocks.configuration.mockResolvedValue(DEFAULT_MODEL_CONFIGURATION);
  mocks.resolveLlmKey.mockResolvedValue({
    key: 'stub-key',
    source: 'platform',
    via: 'openrouter',
  });
  mocks.hasEnoughCredits.mockResolvedValue(true);
  mocks.vision.mockResolvedValue({
    ...description,
    model,
    costMicros: COST_MICROS,
    usedOwnKey: false,
  });
});

describe('draft element analysis upload gate', () => {
  it('refuses another organization object even with a local cleared verdict', async () => {
    uploadUrl = `/r2/elements/${otherOrganizationId}/uploads/${generateId()}.png`;
    await verdict(uploadUrl, LIKENESS_CLEARED_V1);
    await expect(describeDraft()).rejects.toBeInstanceOf(ValidationError);
    expectNoPaidWork();
  });

  it('refuses traversal-shaped stored URLs before resolving any paid collaborator', async () => {
    uploadUrl = `/r2/elements/${organizationId}/uploads/%2e%2e/${otherOrganizationId}/photo.png`;
    await verdict(uploadUrl, LIKENESS_CLEARED_V1);
    await expect(describeDraft()).rejects.toBeInstanceOf(ValidationError);
    expectNoPaidWork();
  });

  it('refuses an unchecked upload before configuration, credentials, vision or debit', async () => {
    await expect(describeDraft()).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expectNoPaidWork();
  });

  it('refuses an unsigned portrait before configuration, credentials, vision or debit', async () => {
    await verdict(uploadUrl, LIKENESS_DETECTED_V1);
    await expect(describeDraft()).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expectNoPaidWork();
  });

  it('does not adopt a likeness verdict from another organization', async () => {
    await verdict(uploadUrl, LIKENESS_CLEARED_V1, scope(otherOrganizationId));
    await expect(describeDraft()).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expectNoPaidWork();
  });

  it.each([LIKENESS_CLEARED_V1, PORTRAIT_RIGHTS_V1])(
    'preserves configured vision and billing for $version uploads',
    async (statement) => {
      await verdict(uploadUrl, statement);
      await expect(describeDraft()).resolves.toEqual(description);
      expect(mocks.configuration).toHaveBeenCalledOnce();
      expect(mocks.resolveLlmKey).toHaveBeenCalledExactlyOnceWith(model);
      expect(mocks.vision).toHaveBeenCalledWith(
        expect.objectContaining({
          promptLocale: 'zh-CN',
          model,
          imageUrl: uploadUrl,
          filename: '灯笼.png',
          observability: {
            userId,
            tags: ['vision', 'draft'],
            metadata: { draft: true },
          },
        })
      );
      const request = mocks.vision.mock.calls[0]?.[0];
      await request.resolveLlmKey(model);
      expect(mocks.resolveLlmKey).toHaveBeenLastCalledWith(model);
      expect(mocks.deductCredits).toHaveBeenCalledExactlyOnceWith(COST_MICROS, {
        description: `Element vision (${model})`,
        metadata: { model, draft: true },
        idempotencyKey: `draft-vision:${uploadUrl}`,
      });
    }
  );

  it('preserves English instructions and the existing organization-key billing rule', async () => {
    await verdict(uploadUrl, LIKENESS_CLEARED_V1);
    mocks.resolveLlmKey.mockResolvedValue({
      key: 'stub-key',
      source: 'organization',
      via: 'openrouter',
    });
    mocks.vision.mockResolvedValue({
      ...description,
      model,
      costMicros: COST_MICROS,
      usedOwnKey: true,
    });
    await expect(describeDraft('en')).resolves.toEqual(description);
    expect(mocks.vision).toHaveBeenCalledWith(
      expect.objectContaining({ promptLocale: 'en' })
    );
    expect(mocks.hasEnoughCredits).not.toHaveBeenCalled();
    expect(mocks.deductCredits).not.toHaveBeenCalled();
  });

  it('still refuses an unchecked upload when an organization key is configured', async () => {
    mocks.resolveLlmKey.mockResolvedValue({
      key: 'stub-key',
      source: 'organization',
      via: 'openrouter',
    });
    await expect(describeDraft()).rejects.toBeInstanceOf(
      AttestationRequiredError
    );
    expectNoPaidWork();
  });

  it('preserves the insufficient-credit refusal after the rights gate', async () => {
    await verdict(uploadUrl, LIKENESS_CLEARED_V1);
    mocks.hasEnoughCredits.mockResolvedValue(false);
    await expect(describeDraft()).rejects.toBeInstanceOf(
      InsufficientCreditsError
    );
    expect(mocks.vision).not.toHaveBeenCalled();
    expect(mocks.deductCredits).not.toHaveBeenCalled();
  });

  it('keeps missing-cost reporting without debiting a zero-cost answer', async () => {
    await verdict(uploadUrl, LIKENESS_CLEARED_V1);
    mocks.vision.mockResolvedValue({
      ...description,
      model,
      costMicros: 0,
      usedOwnKey: false,
    });
    await expect(describeDraft()).resolves.toEqual(description);
    expect(mocks.deductCredits).not.toHaveBeenCalled();
    expect(mocks.missingCost).toHaveBeenCalledWith({
      source: 'draft-element-vision',
      modelId: model,
      metadata: { draft: true, publicUrl: uploadUrl },
    });
  });
});
