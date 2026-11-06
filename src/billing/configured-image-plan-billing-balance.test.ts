import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { estimatePlanImageCost } from './configured-image-plan-billing';
import { quoteConfiguredImageRequest } from './configured-image-billing';
import { micros, ZERO_MICROS } from './money';
import { requireCredits, reserveRunCredits } from './server/preflight';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import type { UpdateStalePlan } from '@/shots/server/update-stale-plan';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { createTestDb } from '@/platform/server/db/test-d1';
import { credits, organization, user } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';

vi.doMock('@/platform/realtime', () => ({
  getBillingChannel: () => ({ emit: async () => {} }),
}));
const { createBillingMethods } = await import('./server/db/billing');
const { gateStoryboardRenders } =
  await import('./server/storyboard-render-gate');

const MOCK_IMAGE_COST = micros(70000);
const mockRouting = createImageModelRoutingSnapshot(
  imageConfigurationFixture()
);
const mockRoute = mockRouting[0];
if (!mockRoute) throw new Error('Mock image routing is required.');
const MOCK_MODEL_IDS = ['custom-image:mock-a', 'custom-image:mock-b'] as const;
const routes = MOCK_MODEL_IDS.map((modelId) => ({
  ...mockRoute,
  modelId,
  priceCards: mockRoute.priceCards.map((card) => ({
    ...card,
    unitPriceUsd: 0.07,
  })),
}));
const mockPlan = asStub<UpdateStalePlan>({
  aspectRatio: '16:9',
  sequence: { resolution: '720p' },
  targets: [
    {
      imageModel: routes[0]?.modelId,
      regenImage: true,
      referenceIds: [],
      imageReferenceCount: 0,
    },
  ],
  references: null,
  renderOptions: { imageModels: routes.map((route) => route.modelId) },
});
let fixture: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  fixture = await createTestDb();
});
afterAll(async () => {
  await fixture.close();
});
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Billing regressions forbid provider and network requests.')
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function billingWithBalance(balance: number) {
  const organizationId = generateId();
  const userId = generateId();
  await fixture.db.insert(organization).values({
    id: organizationId,
    name: 'Mock billing organization',
    slug: organizationId,
  });
  await fixture.db
    .insert(user)
    .values({ id: userId, name: 'Mock user', email: userId + '@mock.invalid' });
  await fixture.db.insert(credits).values({ organizationId, balance });
  return {
    organizationId,
    billing: createBillingMethods(fixture.db, organizationId, userId),
  };
}

async function reserve(
  billing: ReturnType<typeof createBillingMethods>,
  idempotencyKey: string
) {
  const hold = await billing.createReservation(MOCK_IMAGE_COST, {
    idempotencyKey,
  });
  if (!hold.ok) throw new Error('Mock reservation could not be created.');
  return hold.reservationId;
}

async function captureFanout(
  billing: ReturnType<typeof createBillingMethods>,
  reservationId: string
) {
  const costs = routes.map(
    (route) =>
      quoteConfiguredImageRequest({
        model: route.modelId,
        imageModelRouting: routes,
        operation: 'generate',
        aspectRatio: '16:9',
        imageCount: 1,
      }).costMicros
  );
  expect(
    await Promise.all(
      costs.map((cost) => billing.hasEnoughCredits(cost, reservationId))
    )
  ).toEqual([true, true]);
  const captured = await Promise.all(
    costs.map((cost, index) =>
      billing.captureReservation(reservationId, cost, {
        idempotencyKey: 'mock-image:' + index,
      })
    )
  );
  expect(captured).toEqual([
    { ok: true, captured: MOCK_IMAGE_COST, skippedDeltaMicros: undefined },
    { ok: true, captured: MOCK_IMAGE_COST, skippedDeltaMicros: undefined },
  ]);
}

describe('image fanout budget with real in-memory D1 accounting', () => {
  it.each([0, 100_000_000])(
    'runs a verified zero-price request without a reservation (balance %s)',
    async (balance) => {
      const { billing } = await billingWithBalance(balance);
      const freeRoutes = routes.map((route) => ({
        ...route,
        priceCards: route.priceCards.map((card) => ({
          ...card,
          unitPriceUsd: 0,
        })),
      }));
      const quote = estimatePlanImageCost(mockPlan, freeRoutes, {});
      expect(quote.costMicros).toBe(ZERO_MICROS);
      const scopedDb = {
        billing,
        apiKeys: { hasUsableKey: vi.fn().mockResolvedValue(false) },
      };
      await requireCredits(scopedDb, quote.costMicros, {
        imageSource: 'platform',
      });
      await expect(
        reserveRunCredits(scopedDb, quote.costMicros, {
          imageSource: 'platform',
        })
      ).resolves.toBeUndefined();
      expect(await billing.getAvailable()).toMatchObject({
        balance,
        reserved: 0,
      });
      expect((await billing.getTransactionHistory()).transactions).toHaveLength(
        0
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it('refuses two-model fanout when only one image can be funded', async () => {
    const { billing, organizationId } =
      await billingWithBalance(MOCK_IMAGE_COST);
    const reservationId = await reserve(billing, 'mock-underfunded-board');
    const quote = estimatePlanImageCost(mockPlan, routes, {});
    expect(quote.costMicros).toBe(2 * MOCK_IMAGE_COST);
    const gate = await gateStoryboardRenders({
      scopedDb: asStub<WorkflowScopedDb>({ billing, organizationId }),
      reservationId,
      remainingWork: quote.costMicros,
      sceneCount: 1,
    });
    expect(gate.spawnRenders).toBe(false);
    expect(await billing.getAvailable()).toMatchObject({
      balance: MOCK_IMAGE_COST,
      reserved: 0,
    });
    expect((await billing.getTransactionHistory()).transactions).toHaveLength(
      0
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('funds and captures both concurrent images without consuming a competing hold', async () => {
    const { billing, organizationId } = await billingWithBalance(
      3 * MOCK_IMAGE_COST
    );
    const [reservationId, competingId] = await Promise.all([
      reserve(billing, 'mock-board'),
      reserve(billing, 'mock-independent-run'),
    ]);
    const quote = estimatePlanImageCost(mockPlan, routes, {});
    const gate = await gateStoryboardRenders({
      scopedDb: asStub<WorkflowScopedDb>({ billing, organizationId }),
      reservationId,
      remainingWork: quote.costMicros,
      sceneCount: 1,
    });
    expect(gate.spawnRenders).toBe(true);
    expect(await billing.getAvailable()).toMatchObject({
      reserved: 3 * MOCK_IMAGE_COST,
      available: 0,
    });
    await captureFanout(billing, reservationId);
    await billing.captureReservation(reservationId, MOCK_IMAGE_COST, {
      idempotencyKey: 'mock-image:0',
    });
    expect((await billing.getTransactionHistory()).transactions).toHaveLength(
      2
    );
    expect(await billing.growReservation(competingId, micros(0))).toMatchObject(
      { remaining: MOCK_IMAGE_COST }
    );
    expect(await billing.getAvailable()).toMatchObject({
      balance: MOCK_IMAGE_COST,
      reserved: MOCK_IMAGE_COST,
      available: 0,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
