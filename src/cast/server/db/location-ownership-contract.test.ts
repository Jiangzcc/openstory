import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { canonicalBibleTag } from '@/cast/bible-field';
import { locationChannelId } from '@/cast/cast-channel';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  locations,
  locationSheetVariants,
  organization,
  sequenceEvents,
  sequenceLocationLinks,
  sequences,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { clearVersionRows } from '@/platform/server/test/clear-version-rows';
import { locationSheetInputHash } from '@/shots/input-hash';
import { matchLocationsToScene } from '@/shots/scene-matching';
import { createLocationsMethods } from './locations';
import { createLocationSheetVariantsMethods } from './location-sheet-variants';

// Synthetic rows and storage URLs; all database operations use the real D1 test adapter.
const IMAGE_MODEL = 'fixture-location-model';
const HASH_LENGTH = 64;
const INPUT_HASH = locationSheetInputHash('1'.repeat(HASH_LENGTH));
const ANALYSIS = { source: 'analysis' as const, createdBy: null };
let db: Database;
let closeDb: () => Promise<void>;
let organizationId = '';
let otherOrganizationId = '';
let actorId = '';
let sequenceId = '';
let secondSequenceId = '';
let foreignSequenceId = '';

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});

async function seedOrganization(id: string, title: string, ids: string[]) {
  await db.insert(organization).values({ id, name: title, slug: id });
  const [style] = await db
    .insert(styles)
    .values({
      organizationId: id,
      name: 'Fixture',
      config: {
        mood: 'neutral',
        artStyle: 'cinematic',
        lighting: 'natural',
        colorPalette: ['#000', '#fff'],
        cameraWork: 'static',
        referenceFilms: [],
        colorGrading: 'neutral',
      },
    })
    .returning();
  if (!style) throw new Error('Fixture style missing');
  await db.insert(sequences).values(
    ids.map((sequence) => ({
      id: sequence,
      organizationId: id,
      title,
      styleId: style.id,
    }))
  );
}

beforeEach(async () => {
  await clearVersionRows(db);
  await db.delete(sequenceEvents);
  await db.delete(locations);
  await db.delete(sequences);
  await db.delete(styles);
  await db.delete(organization);
  await db.delete(user);
  organizationId = generateId();
  otherOrganizationId = generateId();
  actorId = generateId();
  sequenceId = generateId();
  secondSequenceId = generateId();
  foreignSequenceId = generateId();
  await db
    .insert(user)
    .values({ id: actorId, name: 'Fixture', email: 'location@example.test' });
  await seedOrganization(organizationId, 'Own', [sequenceId, secondSequenceId]);
  await seedOrganization(otherOrganizationId, 'Other', [foreignSequenceId]);
});

const locs = () => createLocationsMethods(db, organizationId);
const versions = (org = organizationId) =>
  createLocationSheetVariantsMethods(db, org);
const makeLocation = (name: string, consistencyTag: string | null = null) =>
  locs().createForOrganization(
    { name, consistencyTag, rendering: PHOTOREAL_RENDERING },
    { createdBy: actorId }
  );
const analysisEntry = (
  boundTo: string,
  sequence = sequenceId,
  tag = 'script_station'
) => ({
  sequenceId: sequence,
  locationId: 'loc_script',
  name: 'Script station',
  rendering: PHOTOREAL_RENDERING,
  consistencyTag: tag,
  boundTo,
});
const landing = (locationId: string, versionId: string) => ({
  locationId,
  versionId,
  claimed: true,
  activity: null,
  url: '/r2/fixture-late.png',
  storagePath: 'fixture-late.png',
  inputHash: INPUT_HASH,
  bibleVersionId: null,
  model: IMAGE_MODEL,
  workflowRunId: 'fixture-run',
});
const uploadSheet = (locationDbId: string, path: string) =>
  versions().applyConvergent({
    locationDbId,
    url: '/r2/' + path,
    storagePath: path,
    inputHash: null,
    model: IMAGE_MODEL,
    personInMedia: false,
  });

async function sheetRows(id: string) {
  return db
    .select()
    .from(locationSheetVariants)
    .where(eq(locationSheetVariants.locationId, id));
}

async function twoChineseLocations() {
  const station = await makeLocation('上海车站');
  const bookshop = await makeLocation('北京书店');
  await locs().attach(sequenceId, station.id, { actorId });
  await locs().attach(sequenceId, bookshop.id, { actorId });
  return { station, bookshop, linked: await locs().list(sequenceId) };
}

it('refuses a matched binding into another organization sequence before writing a link', async () => {
  const location = await makeLocation('Own station');
  await expect(
    locs().createBulk([analysisEntry(location.id, foreignSequenceId)], ANALYSIS)
  ).rejects.toThrow('Sequence not found');
  expect(await db.select().from(sequenceLocationLinks)).toEqual([]);
  expect((await locs().getCurrent(location.id))?.selectedBibleVersionId).toBe(
    location.selectedBibleVersionId
  );
});

it('refuses a foreign organization sheet completion without appending a history row', async () => {
  const location = await makeLocation('Own station');
  const claim = await locs().claimReference(location.id, {
    markGenerating: true,
  });
  await expect(
    versions(otherOrganizationId).promoteIfPending(landing(location.id, claim))
  ).rejects.toThrow();
  expect(await sheetRows(location.id)).toEqual([]);
  expect(
    (await locs().getCurrent(location.id))?.pendingPromoteReferenceVersionId
  ).toBe(claim);
});

it('refuses a foreign organization divergent insert without leaking or appending a version', async () => {
  const location = await makeLocation('Own station');
  await expect(
    versions(otherOrganizationId).insertDivergent({
      id: generateId(),
      locationId: location.id,
      model: IMAGE_MODEL,
      status: 'completed',
      url: '/r2/foreign.png',
      storagePath: 'foreign.png',
      inputHash: INPUT_HASH,
      divergedAt: new Date(),
    })
  ).rejects.toThrow();
  expect(await sheetRows(location.id)).toEqual([]);
});

it('keeps an obsolete run in history after a no-sequence user pick shared by two sequences', async () => {
  const location = await makeLocation('Shared station');
  await locs().attach(sequenceId, location.id, { actorId });
  await locs().attach(secondSequenceId, location.id, { actorId });
  const first = await uploadSheet(location.id, 'first.png');
  const second = await uploadSheet(location.id, 'second.png');
  const claim = await locs().claimReference(location.id, {
    markGenerating: true,
  });
  const eventsBefore = await db.select().from(sequenceEvents);
  await versions().select(null, location.id, first.version.id, { actorId });
  expect(await versions().promoteIfPending(landing(location.id, claim))).toBe(
    'parked'
  );
  for (const sequence of [sequenceId, secondSequenceId]) {
    expect(
      (await locs().getById(sequence, location.id))?.selectedReferenceVersionId
    ).toBe(first.version.id);
  }
  expect(await versions().getById(claim)).toMatchObject({
    id: claim,
    status: 'completed',
  });
  expect((await versions().getById(claim))?.divergedAt).not.toBeNull();
  expect(
    (await versions().listHistoryByLocation(location.id)).map((row) => row.id)
  ).toEqual(
    expect.arrayContaining([first.version.id, second.version.id, claim])
  );
  expect(await db.select().from(sequenceEvents)).toEqual(eventsBefore);
});

it('keeps the Unicode script tag after matching and recast while preserving each own bible tag', async () => {
  const original = await makeLocation('上海车站', '上海_车站');
  const replacement = await makeLocation('北京书店', '北京_书店');
  const sheet = await uploadSheet(replacement.id, 'bookshop.png');
  const [bound] = await locs().createBulk(
    [analysisEntry(original.id, sequenceId, '雨夜_站台')],
    ANALYSIS
  );
  if (!bound) throw new Error('Fixture binding missing');
  const replaced = await locs().replace(sequenceId, bound.id, replacement.id, {
    actorId,
  });
  expect(replaced).toMatchObject({
    locationId: 'loc_script',
    consistencyTag: '雨夜_站台',
    attached: true,
    selectedReferenceVersionId: sheet.version.id,
  });
  expect(
    matchLocationsToScene(await locs().list(sequenceId), '雨夜_站台', '').map(
      (row) => row.id
    )
  ).toEqual([replacement.id]);
  expect((await locs().getCurrent(original.id))?.consistencyTag).toBe(
    '上海_车站'
  );
  expect((await locs().getCurrent(replacement.id))?.consistencyTag).toBe(
    '北京_书店'
  );
});

it('keeps nonempty distinct canonical tags for attached Unicode names without stored tags', async () => {
  const { bookshop, linked } = await twoChineseLocations();
  const tags = linked.map(canonicalBibleTag);
  expect(tags.every((tag) => tag.length > 0)).toBe(true);
  expect(new Set(tags).size).toBe(linked.length);
  const selected = linked.find((row) => row.id === bookshop.id);
  if (!selected) throw new Error('Fixture location missing');
  expect(
    matchLocationsToScene(linked, canonicalBibleTag(selected), '').map(
      (row) => row.id
    )
  ).toEqual([bookshop.id]);
});

it('matches the named Unicode location in prose when neither tag nor slugline is present', async () => {
  const { bookshop, linked } = await twoChineseLocations();
  expect(
    matchLocationsToScene(linked, '', '', '镜头转向：北京书店。').map(
      (row) => row.id
    )
  ).toEqual([bookshop.id]);
});

it('lands an unattached organization location sheet without a sequence link or event', async () => {
  const location = await makeLocation('Unattached station');
  const claim = await locs().claimReferenceIfUnmoved(location.id, {
    bibleVersionId: location.selectedBibleVersionId ?? '',
  });
  expect(claim.held).toBe(true);
  expect(
    await versions().promoteIfPending(landing(location.id, claim.versionId))
  ).toBe('promoted');
  expect(await locs().getCurrent(location.id)).toMatchObject({
    organizationId,
    selectedReferenceVersionId: claim.versionId,
    pendingPromoteReferenceVersionId: null,
    referenceStatus: 'completed',
  });
  expect(await db.select().from(sequenceLocationLinks)).toEqual([]);
  expect(await db.select().from(sequenceEvents)).toEqual([]);
  expect(locationChannelId(null, location.id)).toBe(`location:${location.id}`);
  expect(locationChannelId(sequenceId, location.id)).toBe(sequenceId);
});

it('matches a Unicode location name carried by the scene location field', async () => {
  const { bookshop, linked } = await twoChineseLocations();
  expect(
    matchLocationsToScene(linked, '', '北京书店').map((row) => row.id)
  ).toEqual([bookshop.id]);
});
