/**
 * Sequence-owned style snapshot: create/style-change copy the catalog recipe
 * so later catalog edits cannot stale existing sequences.
 */
import { clearVersionRows } from '@/platform/server/test/clear-version-rows';
import { createTestDb } from '@/platform/server/db/test-d1';
import type { Database } from '@/platform/server/db/client';
import { generateId } from '@/platform/id';
import {
  characters,
  locations as locationsTable,
  locationBibleVersions,
  sequenceLocationLinks,
  sequences,
  styles,
  organization,
  user,
} from '@/platform/server/db/schema';
import { createCharactersMethods } from '@/cast/server/db/characters';
import { createCharacterLooksMethods } from '@/cast/server/db/character-looks';
import { createLocationsMethods } from '@/cast/server/db/locations';
import { createSequencesMethods } from './sequences';
import { isStyleConfigV2, parseStyleConfig } from '@/look/style-config';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { localizeTemplateStyleConfig } from '@/look/localization/style-content';
import { SUPPORTED_LOCALES } from '@/platform/i18n/locale';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const V1_A = {
  mood: 'tense and paranoid',
  artStyle: 'high-contrast neo-noir',
  lighting: 'low-key with hard shadows',
  colorPalette: ['#0a0a14', '#e8322f'],
  cameraWork: 'slow dolly, dutch angles',
  referenceFilms: ['rain-slicked neon-noir cityscapes'],
  colorGrading: 'crushed blacks, neon accents',
};

const V1_B = {
  ...V1_A,
  mood: 'bright and playful energy',
  artStyle: 'clean commercial product photography',
};

let closeDb: () => Promise<void>;
let db: Database;
let organizationId = '';
let userId = '';

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await clearVersionRows(db);
  // Nothing cascades from a sequence to its characters (#2017).
  await db.delete(characters);
  await db.delete(sequenceLocationLinks);
  await db.delete(locationBibleVersions);
  await db.delete(locationsTable);
  await db.delete(sequences);
  await db.delete(styles);
  await db.delete(organization);
  await db.delete(user);
  organizationId = generateId();
  userId = generateId();
  await db
    .insert(user)
    .values({ id: userId, name: 'U', email: 'u@example.com' });
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'T', slug: 't' });
});

async function insertStyle(name: string, config: typeof V1_A) {
  const [row] = await db
    .insert(styles)
    .values({ organizationId, name, config })
    .returning();
  if (!row) throw new Error('style insert returned nothing');
  return row;
}

async function insertPlatformTemplate() {
  const template = DEFAULT_STYLE_TEMPLATES[0];
  if (!template) throw new Error('Missing platform template');
  const [row] = await db
    .insert(styles)
    .values({ ...template, organizationId })
    .returning();
  if (!row) throw new Error('Missing inserted platform template');
  return row;
}

describe('createSequencesMethods style snapshot', () => {
  it.each(SUPPORTED_LOCALES)(
    'stores the actual %s recipe and keeps the catalog unchanged',
    async (locale) => {
      const style = await insertPlatformTemplate();
      const methods = createSequencesMethods(db, organizationId, userId);
      const config = localizeTemplateStyleConfig(style, locale);
      const sequence = await methods.create({
        generationStopAt: 'images',
        title: 'Localized sequence',
        styleId: style.id,
        resolvedStyleConfig: config,
      });
      const versions = await methods.listStyleVersions(sequence.id);
      expect(versions).toHaveLength(1);
      expect(sequence.styleConfig).toEqual(config);
      expect(versions[0]?.config).toEqual(config);
      expect(sequence.selectedStyleVersionId).toBe(versions[0]?.id);
      const [catalog] = await db
        .select()
        .from(styles)
        .where(eq(styles.id, style.id));
      expect(catalog?.config).toEqual(style.config);
      expect(parseStyleConfig(sequence.styleConfig).look.mood).toBe(
        locale === 'zh-CN'
          ? '清新、富有感官体验，自然流露时髦气息'
          : 'Fresh, sensory, and effortlessly cool'
      );
    }
  );

  it('keeps a localized snapshot through language resolution, catalog edits and unrelated saves', async () => {
    const style = await insertPlatformTemplate();
    const methods = createSequencesMethods(db, organizationId, userId);
    const chinese = localizeTemplateStyleConfig(style, 'zh-CN');
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: style.id,
      resolvedStyleConfig: chinese,
    });
    expect(localizeTemplateStyleConfig(style, 'en')).not.toEqual(chinese);
    await db
      .update(styles)
      .set({ config: V1_B })
      .where(eq(styles.id, style.id));
    const updated = await methods.update({ id: sequence.id, title: 'Renamed' });
    expect(updated.styleConfig).toEqual(chinese);
    expect(updated.selectedStyleVersionId).toBe(
      sequence.selectedStyleVersionId
    );
    expect(await methods.listStyleVersions(sequence.id)).toHaveLength(1);
  });

  it('records an explicit localized reselection in one live version and preserves the old recipe', async () => {
    const style = await insertPlatformTemplate();
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: style.id,
    });
    const chinese = localizeTemplateStyleConfig(style, 'zh-CN');
    const updated = await methods.update({
      id: sequence.id,
      styleId: style.id,
      resolvedStyleConfig: chinese,
    });
    const versions = await methods.listStyleVersions(sequence.id);
    expect(versions.map((version) => version.source)).toEqual([
      'created',
      'switched',
    ]);
    expect(versions[0]?.config).toEqual(parseStyleConfig(style.config));
    expect(versions[1]?.config).toEqual(chinese);
    expect(updated.selectedStyleVersionId).toBe(versions[1]?.id);
    expect(updated.styleConfig).toEqual(chinese);
  });

  it('rejects a resolved config without a style selection and leaves its version intact', async () => {
    const style = await insertPlatformTemplate();
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: style.id,
    });
    await expect(
      methods.update({
        id: sequence.id,
        resolvedStyleConfig: localizeTemplateStyleConfig(style, 'zh-CN'),
      })
    ).rejects.toThrow('requires a style id');
    expect(await methods.getById(sequence.id)).toMatchObject({
      selectedStyleVersionId: sequence.selectedStyleVersionId,
      styleConfig: sequence.styleConfig,
    });
    expect(await methods.listStyleVersions(sequence.id)).toHaveLength(1);
  });

  it('rejects an invalid resolved config before inserting any sequence or style version', async () => {
    const style = await insertPlatformTemplate();
    const methods = createSequencesMethods(db, organizationId, userId);
    const config = parseStyleConfig(style.config);
    await expect(
      methods.create({
        generationStopAt: 'images',
        title: 'S',
        styleId: style.id,
        resolvedStyleConfig: { ...config, look: { ...config.look, mood: '' } },
      })
    ).rejects.toThrow();
    expect(await db.select().from(sequences)).toHaveLength(0);
  });

  it('copies a parsed v2 recipe onto the sequence at create', async () => {
    const style = await insertStyle('Noir', V1_A);
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: style.id,
      analysisModel: 'anthropic/claude-haiku-4.5',
    });

    expect(sequence.styleConfig).toBeTruthy();
    expect(isStyleConfigV2(sequence.styleConfig)).toBe(true);
    expect(parseStyleConfig(sequence.styleConfig).look.mood).toBe(V1_A.mood);
  });

  it('keeps the snapshot when the catalog row is later edited', async () => {
    const style = await insertStyle('Noir', V1_A);
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: style.id,
      analysisModel: 'anthropic/claude-haiku-4.5',
    });

    await db
      .update(styles)
      .set({ config: V1_B })
      .where(eq(styles.id, style.id));

    const reread = await methods.getById(sequence.id);
    expect(parseStyleConfig(reread?.styleConfig).look.mood).toBe(V1_A.mood);
  });

  it('replaces the snapshot when the sequence changes style', async () => {
    const styleA = await insertStyle('Noir', V1_A);
    const styleB = await insertStyle('Product', V1_B);
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: styleA.id,
      analysisModel: 'anthropic/claude-haiku-4.5',
    });

    const updated = await methods.update({
      id: sequence.id,
      styleId: styleB.id,
    });
    expect(parseStyleConfig(updated.styleConfig).look.mood).toBe(V1_B.mood);
  });

  it('keeps every snapshot as a version and points at the live one (#1600)', async () => {
    const styleA = await insertStyle('Noir', V1_A);
    const styleB = await insertStyle('Product', V1_B);
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: styleA.id,
      analysisModel: 'anthropic/claude-haiku-4.5',
    });
    const updated = await methods.update({
      id: sequence.id,
      styleId: styleB.id,
    });

    const versions = await methods.listStyleVersions(sequence.id);
    expect(versions.map((v) => [v.source, v.styleId])).toEqual([
      ['created', styleA.id],
      ['switched', styleB.id],
    ]);
    expect(updated.selectedStyleVersionId).toBe(versions[1]?.id);
    expect(parseStyleConfig(versions[0]?.config).look.mood).toBe(V1_A.mood);
  });

  // A sheet reads no style (#2017 characters, #1695 locations): its
  // `rendering` is on the bible. So no style write revokes a sheet claim.
  async function claimedLocation(styleId: string, deferStyleSnapshot = false) {
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId,
      deferStyleSnapshot,
      analysisModel: 'anthropic/claude-haiku-4.5',
    });
    const locations = createLocationsMethods(db, organizationId);
    const location = await locations.create(
      {
        sequenceId: sequence.id,
        locationId: 'loc_001',
        name: 'Diner',
        rendering: 'Photoreal live action',
      },
      { source: 'analysis', createdBy: null }
    );
    const locationClaim = await locations.claimReference(location.id, {
      markGenerating: true,
      activity: null,
    });
    // A character's sheet claim is on its cast look (#2017).
    const characters = createCharactersMethods(db, organizationId);
    const character = await characters.create(
      {
        sequenceId: sequence.id,
        characterId: 'char_001',
        name: 'Ada',
        rendering: 'Photoreal live action',
      },
      { source: 'analysis', createdBy: null }
    );
    const sheet = await createCharacterLooksMethods(
      db,
      organizationId
    ).claimSheet(
      character.lookId,
      {
        lookVersionId: character.looks[0]?.lookVersionId ?? '',
        bibleVersionId: character.selectedBibleVersionId,
      },
      { markGenerating: true, activity: null }
    );
    if (!sheet.held) throw new Error('test setup: sheet claim not taken');
    const claim = { location: locationClaim, sheet: sheet.versionId };
    const liveClaim = async () => ({
      location:
        (await locations.getById(sequence.id, location.id))
          ?.pendingPromoteReferenceVersionId ?? null,
      sheet:
        (await characters.getById(sequence.id, character.id))
          ?.pendingPromoteSheetVersionId ?? null,
    });
    return { methods, sequence, claim, liveClaim };
  }

  it('keeps both sheet claims taken before the automatic style lands: a sheet reads no style (#2017, #1695)', async () => {
    // A character and a location added by hand, their sheets generating
    // against the placeholder recipe, while the first analysis derives the
    // real one.
    const style = await insertStyle('Auto', V1_A);
    const { methods, sequence, claim, liveClaim } = await claimedLocation(
      style.id,
      true
    );
    expect(await liveClaim()).toEqual(claim);
    expect(
      await methods.snapshotAutoStyle({ id: sequence.id, styleId: style.id })
    ).toBe(true);
    expect(await liveClaim()).toEqual(claim);
  });

  it('keeps sheet claims when the automatic style no longer lands', async () => {
    // The sequence was re-styled mid-run: the derived recipe is not
    // snapshotted, so it revokes nothing.
    const auto = await insertStyle('Auto', V1_A);
    const picked = await insertStyle('Product', V1_B);
    const { methods, sequence, claim, liveClaim } = await claimedLocation(
      picked.id
    );
    expect(
      await methods.snapshotAutoStyle({ id: sequence.id, styleId: auto.id })
    ).toBe(false);
    expect(await liveClaim()).toEqual(claim);
  });

  it('keeps sheet claims when the same style is saved again', async () => {
    const style = await insertStyle('Noir', V1_A);
    const { methods, sequence, claim, liveClaim } = await claimedLocation(
      style.id
    );
    await methods.update({ id: sequence.id, styleId: style.id, title: 'T' });
    expect(await liveClaim()).toEqual(claim);
  });

  it('keeps both sheet claims when the style switches', async () => {
    const styleA = await insertStyle('Noir', V1_A);
    const styleB = await insertStyle('Product', V1_B);
    const { methods, sequence, claim, liveClaim } = await claimedLocation(
      styleA.id
    );
    await methods.update({ id: sequence.id, styleId: styleB.id });
    expect(await liveClaim()).toEqual(claim);
  });

  it('keeps both sheet claims while selecting the localized platform recipe', async () => {
    const style = await insertPlatformTemplate();
    const { methods, sequence, claim, liveClaim } = await claimedLocation(
      style.id
    );
    const chinese = localizeTemplateStyleConfig(style, 'zh-CN');
    const updated = await methods.update({
      id: sequence.id,
      styleId: style.id,
      resolvedStyleConfig: chinese,
    });
    expect(updated.styleConfig).toEqual(chinese);
    expect(await liveClaim()).toEqual(claim);
  });

  it('keeps both sheet claims when the same style is re-saved with an edited recipe', async () => {
    const style = await insertStyle('Noir', V1_A);
    const { methods, sequence, claim, liveClaim } = await claimedLocation(
      style.id
    );
    await db
      .update(styles)
      .set({ config: V1_B })
      .where(eq(styles.id, style.id));
    await methods.update({ id: sequence.id, styleId: style.id });
    expect(await liveClaim()).toEqual(claim);
  });

  it('a deferred snapshot has no version until the automatic style lands', async () => {
    const style = await insertStyle('Auto', V1_A);
    const methods = createSequencesMethods(db, organizationId, userId);
    const sequence = await methods.create({
      generationStopAt: 'images',
      title: 'S',
      styleId: style.id,
      deferStyleSnapshot: true,
      analysisModel: 'anthropic/claude-haiku-4.5',
    });
    expect(sequence.styleConfig).toBeNull();
    expect(await methods.listStyleVersions(sequence.id)).toEqual([]);

    expect(
      await methods.snapshotAutoStyle({ id: sequence.id, styleId: style.id })
    ).toBe(true);
    const [derived] = await methods.listStyleVersions(sequence.id);
    expect(derived?.source).toBe('derived');
    expect((await methods.getById(sequence.id))?.selectedStyleVersionId).toBe(
      derived?.id
    );
  });
});
