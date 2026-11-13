import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  locations,
  locationSheetVariants,
  organization,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { clearVersionRows } from '@/platform/server/test/clear-version-rows';
import { locationSheetInputHash } from '@/shots/input-hash';
import { createLocationsMethods } from './locations';
import { createLocationSheetVariantsMethods } from './location-sheet-variants';

// Synthetic rows and storage URLs; all queries use the real D1 test adapter.
const IMAGE_MODEL = 'fixture-location-model';
const HASH_LENGTH = 64;
const INPUT_HASH = locationSheetInputHash('1'.repeat(HASH_LENGTH));
let db: Database;
let closeDb: () => Promise<void>;
let organizationId = '';
let otherOrganizationId = '';
let actorId = '';

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await clearVersionRows(db);
  await db.delete(locations);
  await db.delete(organization);
  await db.delete(user);
  actorId = generateId();
  organizationId = generateId();
  otherOrganizationId = generateId();
  await db.insert(user).values({
    id: actorId,
    name: 'Fixture',
    email: 'location-sheet@example.test',
  });
  await db.insert(organization).values([
    { id: organizationId, name: 'Own', slug: organizationId },
    { id: otherOrganizationId, name: 'Other', slug: otherOrganizationId },
  ]);
});

const locs = () => createLocationsMethods(db, organizationId);
const versions = (org = organizationId) =>
  createLocationSheetVariantsMethods(db, org);
const makeLocation = () =>
  locs().createForOrganization(
    { name: 'Fixture station', rendering: PHOTOREAL_RENDERING },
    { createdBy: actorId }
  );
const divergent = (locationId: string) => ({
  id: generateId(),
  locationId,
  model: IMAGE_MODEL,
  status: 'completed' as const,
  url: '/r2/fixture-divergent.png',
  storagePath: 'fixture-divergent.png',
  inputHash: INPUT_HASH,
  divergedAt: new Date(),
});
const landing = (locationId: string, versionId: string) => ({
  locationId,
  versionId,
  claimed: true,
  activity: null,
  url: '/r2/fixture-completed.png',
  storagePath: 'fixture-completed.png',
  inputHash: INPUT_HASH,
  bibleVersionId: null,
  model: IMAGE_MODEL,
  workflowRunId: 'fixture-run',
});
const sheetRows = (locationId: string) =>
  db
    .select()
    .from(locationSheetVariants)
    .where(eq(locationSheetVariants.locationId, locationId));

it('refuses to return another organization existing divergent version', async () => {
  const location = await makeLocation();
  const original = await versions().insertDivergent(divergent(location.id));
  const parent = await locs().getCurrent(location.id);
  await expect(
    versions(otherOrganizationId).insertDivergent(divergent(location.id))
  ).rejects.toThrow('Location not found');
  expect(await sheetRows(location.id)).toEqual([original]);
  expect(await locs().getCurrent(location.id)).toEqual(parent);
});

it('refuses a divergent insert for a missing parent without orphaning history', async () => {
  const locationId = generateId();
  await expect(
    versions().insertDivergent(divergent(locationId))
  ).rejects.toThrow('Location not found');
  expect(await sheetRows(locationId)).toEqual([]);
});

it('returns the original divergent version on a same organization retry', async () => {
  const location = await makeLocation();
  const original = await versions().insertDivergent(divergent(location.id));
  const parent = await locs().getCurrent(location.id);
  const retried = await versions().insertDivergent({
    ...divergent(location.id),
    url: '/r2/fixture-retry.png',
    storagePath: 'fixture-retry.png',
  });
  expect(retried).toEqual(original);
  expect(await sheetRows(location.id)).toEqual([original]);
  expect(await locs().getCurrent(location.id)).toEqual(parent);
});

it('converges concurrent same organization inserts onto one divergent version', async () => {
  const location = await makeLocation();
  const first = divergent(location.id);
  const second = divergent(location.id);
  const results = await Promise.all([
    versions().insertDivergent(first),
    versions().insertDivergent(second),
  ]);
  const stored = await sheetRows(location.id);
  expect(stored).toHaveLength(1);
  expect([first.id, second.id]).toContain(stored[0]?.id);
  expect(results).toEqual([stored[0], stored[0]]);
});

it('keeps divergent histories separate for two owned locations with the same hash', async () => {
  const first = await makeLocation();
  const second = await makeLocation();
  const firstVersion = await versions().insertDivergent(divergent(first.id));
  const secondVersion = await versions().insertDivergent(divergent(second.id));
  expect(firstVersion.id).not.toBe(secondVersion.id);
  expect(await sheetRows(first.id)).toEqual([firstVersion]);
  expect(await sheetRows(second.id)).toEqual([secondVersion]);
});

it('refuses a missing parent completion before appending history', async () => {
  const locationId = generateId();
  await expect(
    versions().promoteIfPending(landing(locationId, generateId()))
  ).rejects.toThrow('Location not found');
  expect(await sheetRows(locationId)).toEqual([]);
});

it('keeps the owner claim usable after refusing another organization completion', async () => {
  const location = await makeLocation();
  const claim = await locs().claimReference(location.id, {
    markGenerating: true,
  });
  const args = landing(location.id, claim);
  const parent = await locs().getCurrent(location.id);
  await expect(
    versions(otherOrganizationId).promoteIfPending(args)
  ).rejects.toThrow('Location not found');
  expect(await sheetRows(location.id)).toEqual([]);
  expect(await locs().getCurrent(location.id)).toEqual(parent);
  expect(await versions().promoteIfPending(args)).toBe('promoted');
  expect(await locs().getCurrent(location.id)).toMatchObject({
    selectedReferenceVersionId: claim,
    pendingPromoteReferenceVersionId: null,
    referenceStatus: 'completed',
  });
});

it('keeps completion retries idempotent and blocks foreign retries on existing history', async () => {
  const location = await makeLocation();
  const claim = await locs().claimReference(location.id, {
    markGenerating: true,
  });
  const args = landing(location.id, claim);
  expect(await versions().promoteIfPending(args)).toBe('promoted');
  expect(await versions().promoteIfPending(args)).toBe('promoted');
  const history = await sheetRows(location.id);
  expect(history).toHaveLength(1);
  const parent = await locs().getCurrent(location.id);
  await expect(
    versions(otherOrganizationId).promoteIfPending(args)
  ).rejects.toThrow('Location not found');
  expect(await sheetRows(location.id)).toEqual(history);
  expect(await locs().getCurrent(location.id)).toEqual(parent);
});
