import { describe, expect, it } from 'vitest';
import {
  canonicalBibleTag,
  identityToken,
  nextIdentityToken,
  slugifyTag,
} from './bible-field';
import { matchLocationsToScene } from '@/shots/scene-matching';
import {
  computeLocationSheetInputHash,
  hashVisualPromptInput,
  type VisualPromptHashInput,
} from '@/shots/input-hash';
import { narrowShotPromptContext } from '@/shots/server/prompt-context';
import { migrateStyleConfigV1ToV2 } from '@/look/style-config';
import type { LocationBibleEntry } from '@/shots/scene-analysis.schema';

describe('slugifyTag', () => {
  it('lowercases and joins with underscores', () => {
    expect(slugifyTag('Maya Chen')).toBe('maya_chen');
    expect(slugifyTag('  The Office  ')).toBe('the_office');
  });

  it('strips punctuation', () => {
    expect(slugifyTag("O'Brien")).toBe('o_brien');
    expect(slugifyTag('???')).toBe('');
  });
});

describe('identityToken', () => {
  it('prefixes a shortened name', () => {
    expect(identityToken('char', 'Maya')).toBe('char_maya');
    expect(identityToken('loc', 'Night Office')).toBe('loc_night_office');
  });

  it('falls back when the name has no latin slug', () => {
    expect(identityToken('char', '???')).toBe('char_character');
    expect(identityToken('loc', '你好')).toBe('loc_location');
  });
});

describe('nextIdentityToken', () => {
  it('returns the base when free', () => {
    expect(nextIdentityToken('char_maya', new Set())).toBe('char_maya');
  });

  it('suffixes _2, _3 on collision', () => {
    expect(nextIdentityToken('char_maya', new Set(['char_maya']))).toBe(
      'char_maya_2'
    );
    expect(
      nextIdentityToken('char_maya', new Set(['char_maya', 'char_maya_2']))
    ).toBe('char_maya_3');
  });
});

describe('canonicalBibleTag', () => {
  it.each(['rainy_platform', '雨夜_站台', '  loc_001: OLD-Tag  ', ' '])(
    'preserves the stored tag verbatim: %j',
    (consistencyTag) => {
      expect(canonicalBibleTag({ name: '上海车站', consistencyTag })).toBe(
        consistencyTag
      );
    }
  );

  it.each([
    ['Maya Chen', 'maya_chen'],
    ['  The Office  ', 'the_office'],
    ["O'Brien", 'o_brien'],
    ['北京 Studio 2 号', 'studio_2'],
    ['Café', 'caf'],
  ])('keeps the existing nonempty ASCII fallback for %s', (name, tag) => {
    expect(canonicalBibleTag({ name, consistencyTag: null })).toBe(tag);
    expect(canonicalBibleTag({ name, consistencyTag: '' })).toBe(tag);
  });

  it.each([
    ['上海车站', '上海车站'],
    ['北京书店', '北京书店'],
    ['  【上海 车站】  ', '上海_车站'],
  ])(
    'uses a Unicode fallback only when the ASCII slug is empty: %s',
    (name, tag) => {
      expect(canonicalBibleTag({ name, consistencyTag: null })).toBe(tag);
      expect(canonicalBibleTag({ name, consistencyTag: '' })).toBe(tag);
    }
  );

  it('leaves names without letters or numbers empty', () => {
    expect(canonicalBibleTag({ name: '???', consistencyTag: null })).toBe('');
  });

  it('round-trips distinct Chinese selector tags through the scene matcher', () => {
    const locations = ['上海车站', '北京书店'].map((name, index) => ({
      name,
      locationId: 'loc_' + index,
      consistencyTag: null,
    }));
    const tags = locations.map(canonicalBibleTag);
    expect(tags).toEqual(['上海车站', '北京书店']);
    for (const location of locations) {
      expect(
        matchLocationsToScene(locations, canonicalBibleTag(location), '')
      ).toEqual([location]);
    }
  });
});

// Synthetic bible/scene DTOs exercise real selectors and hashes without I/O.
function locationFixture(
  name: string,
  consistencyTag: string
): LocationBibleEntry {
  return {
    name,
    locationId: 'loc_001',
    consistencyTag,
    type: 'interior',
    description: 'A bookshop with wooden shelves',
    architecturalStyle: 'Traditional',
    keyFeatures: 'Reading desks',
    ambiance: 'Quiet',
    rendering: 'Photoreal live action',
    firstMention: { sceneId: 'scene_001', text: name, lineNumber: 1 },
  };
}

function promptFixture(location: LocationBibleEntry) {
  return {
    scene: {
      sceneId: 'scene_001',
      sceneNumber: 1,
      originalScript: { extract: '镜头转向：北京书店。', dialogue: [] },
      metadata: {
        title: 'Synthetic scene',
        durationSeconds: 5,
        location: '',
        timeOfDay: 'day',
        storyBeat: '',
      },
      continuity: {
        characterTags: [],
        environmentTag: canonicalBibleTag(location),
        colorPalette: '',
        lightingSetup: '',
        styleTag: '',
      },
    },
    styleConfig: migrateStyleConfigV1ToV2({
      mood: 'neutral',
      artStyle: 'cinematic',
      lighting: 'natural',
      colorPalette: ['neutral'],
      cameraWork: 'static',
      referenceFilms: [],
      colorGrading: 'neutral',
    }),
    characterBible: [],
    locationBible: [
      location,
      {
        ...location,
        name: '北京书店',
        locationId: 'loc_002',
        consistencyTag: 'bookshop',
      },
    ],
    elementBible: [],
    aspectRatio: '16:9',
    analysisModel: 'synthetic-analysis',
  } satisfies VisualPromptHashInput;
}

describe('canonical tag hash compatibility', () => {
  it.each([
    ['上海车站', '雨夜_站台'],
    ['Night Office', ''],
  ])(
    'preserves the selected bible and prompt digest for %s',
    async (name, tag) => {
      const location = locationFixture(name, tag);
      const ctx = promptFixture(location);
      const narrowed = narrowShotPromptContext(ctx, {
        channel: 'visual',
        prompt: '镜头转向：北京书店。',
      });
      expect(narrowed.locationBible).toEqual([location]);
      const digest = await hashVisualPromptInput(narrowed);
      expect(digest).toBe(
        await hashVisualPromptInput({ ...ctx, locationBible: [location] })
      );
      expect(digest).toBe(
        'f1de54ea3a378dfe8d3d0f9c035e1ed9f89ed7e54444cfce69d46319c963367d'
      );
    }
  );

  it('keeps the sheet digest when a missing Chinese tag is resolved', async () => {
    const location = locationFixture('上海车站', '');
    const input = {
      locationBible: location,
      referencePhotoHashes: [],
      imageModel: 'synthetic-image',
    };
    const digest = await computeLocationSheetInputHash(input);
    const tagged = { ...location, consistencyTag: canonicalBibleTag(location) };
    expect(
      await computeLocationSheetInputHash({
        ...input,
        locationBible: tagged,
      })
    ).toBe(digest);
    expect(digest).toBe(
      '5e2ae58671e8816fb52329ac8c200bd54006844f216f3edd7955ef6d16a5f93a'
    );
  });

  it('uses the same Chinese selection when stamping and verifying', async () => {
    const location = locationFixture('上海车站', '');
    const ctx = promptFixture(location);
    const view = { channel: 'visual' as const, prompt: null };
    const stamp = narrowShotPromptContext(ctx, view);
    const verify = narrowShotPromptContext(structuredClone(ctx), view);
    expect(stamp.locationBible).toEqual([location]);
    expect(verify.locationBible).toEqual([location]);
    expect(await hashVisualPromptInput(stamp)).toBe(
      await hashVisualPromptInput(verify)
    );
  });
});

it('changes a formerly empty prompt dependency only when Chinese prose gains its location', async () => {
  const location = locationFixture('上海车站', '');
  const ctx = promptFixture(location);
  ctx.scene.continuity.environmentTag = '';
  ctx.scene.originalScript.extract = '镜头转向：上海车站。';
  const previousEmptyDigest = await hashVisualPromptInput({
    ...ctx,
    locationBible: [],
  });
  const corrected = narrowShotPromptContext(ctx, {
    channel: 'visual',
    prompt: null,
  });
  expect(corrected.locationBible).toEqual([location]);
  const correctedDigest = await hashVisualPromptInput(corrected);
  expect(correctedDigest).not.toBe(previousEmptyDigest);
  expect(correctedDigest).toBe(
    await hashVisualPromptInput({ ...ctx, locationBible: [location] })
  );
});

it('preserves an untagged Chinese location already selected by its scene location', async () => {
  const location = locationFixture('上海车站', '');
  const ctx = promptFixture(location);
  ctx.scene.continuity.environmentTag = '';
  ctx.scene.metadata.location = location.name;
  const narrowed = narrowShotPromptContext(ctx, {
    channel: 'visual',
    prompt: '北京书店。',
  });
  expect(narrowed.locationBible).toEqual([location]);
  expect(await hashVisualPromptInput(narrowed)).toBe(
    await hashVisualPromptInput({ ...ctx, locationBible: [location] })
  );
});
