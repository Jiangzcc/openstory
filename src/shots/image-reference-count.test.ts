import { describe, expect, it } from 'vitest';
import type {
  CharacterLookMinimal,
  CharacterMinimal,
  SequenceLocationMinimal,
  SequenceElementMinimal,
} from '@/platform/server/db/schema';
import {
  matchedImageReferenceCount,
  shotImageReferenceCount,
} from './image-reference-count';

type ReferenceInput = Parameters<typeof shotImageReferenceCount>[0];
// Synthetic stored media identities; no uploads, remote reads or provider calls.
function character(
  name: string,
  overrides: Partial<CharacterMinimal> = {}
): CharacterMinimal {
  return {
    id: name,
    characterId: name.toLowerCase(),
    name,
    sheetImageUrl: '/r2/' + name + '.png',
    sheetStatus: 'completed',
    sheetInputHash: null,
    selectedSheetVersionId: null,
    physicalDescription: null,
    voiceOnly: false,
    isPerson: true,
    consistencyTag: null,
    lookId: name,
    lookName: 'Default',
    looks: [],
    ...overrides,
  };
}
function location(name: string): SequenceLocationMinimal {
  return {
    id: name,
    locationId: name.toLowerCase(),
    name,
    referenceImageUrl: '/r2/' + name + '.png',
    referencePersonInMedia: false,
    referenceStatus: 'completed',
    referenceInputHash: null,
    selectedReferenceVersionId: null,
    description: null,
    consistencyTag: name.toLowerCase(),
  };
}
function element(
  token: string,
  kind: SequenceElementMinimal['kind'] = 'image'
): SequenceElementMinimal {
  return {
    id: token,
    token,
    description: null,
    imageUrl: '/r2/' + token + '.png',
    consistencyTag: token.toLowerCase(),
    kind,
    durationSeconds: null,
    personInMedia: false,
  };
}
function count(overrides: Partial<ReferenceInput> = {}) {
  return shotImageReferenceCount({
    scene: null,
    prompt: '',
    characters: [],
    locations: [],
    elements: [],
    ...overrides,
  });
}
const scene = {
  continuity: {
    characterTags: ['jack', 'nora'],
    environmentTag: 'studio',
    elementTags: ['LOGO'],
    lightingSetup: '',
    styleTag: '',
  },
  location: 'Studio',
  script: { extract: 'JACK and NORA see LOGO in the studio.', dialogue: [] },
} satisfies NonNullable<ReferenceInput['scene']>;
const uniform: CharacterLookMinimal = {
  id: 'uniform',
  name: 'Uniform',
  isDefault: false,
  clothing: 'Uniform',
  styling: null,
  sheetImageUrl: '/r2/uniform.png',
  sheetStatus: 'completed',
  sheetInputHash: null,
  selectedSheetVersionId: null,
};

describe('matched still references frozen for billing', () => {
  it('counts only references accepted by the actual still assemblers', () => {
    expect(
      matchedImageReferenceCount({
        characters: [
          character('JACK'),
          character('NARRATOR', { voiceOnly: true }),
          character('FINN', { sheetImageUrl: null }),
        ],
        locations: [
          location('Studio'),
          { ...location('Beach'), referenceImageUrl: null },
        ],
        elements: [
          element('LOGO'),
          element('CLIP', 'video'),
          element('AUDIO', 'audio'),
        ],
      })
    ).toBe(3);
  });
  it('includes matching images this plan will create without double-counting existing images', () => {
    expect(
      matchedImageReferenceCount(
        {
          characters: [
            character('JACK'),
            character('FINN', { sheetImageUrl: null, lookId: 'finn-uniform' }),
            character('NARRATOR', { voiceOnly: true }),
          ],
          locations: [{ ...location('Studio'), referenceImageUrl: null }],
          elements: [
            { ...element('LOGO'), imageUrl: null },
            element('CLIP', 'video'),
            element('AUDIO', 'audio'),
          ],
        },
        {
          characterLookIds: new Set([
            'JACK',
            'finn-uniform',
            'NARRATOR',
            'unmatched-look',
          ]),
          locationIds: new Set(['Studio', 'unmatched-location']),
          elementIds: new Set(['LOGO', 'CLIP', 'AUDIO', 'unmatched-element']),
        }
      )
    ).toBe(4);
  });
  it('does not infer a future image from an unscheduled or different look', () => {
    expect(
      matchedImageReferenceCount(
        {
          characters: [
            character('JACK', { sheetImageUrl: null, lookId: 'uniform' }),
          ],
          locations: [],
          elements: [{ ...element('LOGO'), imageUrl: null }],
        },
        {
          characterLookIds: new Set(['JACK']),
          locationIds: new Set(),
          elementIds: new Set(),
        }
      )
    ).toBe(0);
  });
});

describe('shot still reference counts for price hints', () => {
  it('counts the matched still inputs rather than the entire scene roster', () => {
    expect(
      count({
        scene,
        prompt: 'JACK holds LOGO in the Studio.',
        characters: [character('JACK'), character('NORA')],
        locations: [location('Studio'), location('Beach')],
        elements: [element('LOGO'), element('BOTTLE')],
      })
    ).toBe(3);
  });

  it('preserves the actual still matcher tag fallback for an unnamed visual subject', () => {
    expect(
      count({
        scene: {
          ...scene,
          location: '',
          continuity: {
            ...scene.continuity,
            characterTags: ['jack'],
            environmentTag: '',
          },
        },
        prompt: 'A misty wide view.',
        characters: [character('JACK'), character('NORA')],
      })
    ).toBe(1);
  });

  it('counts the scene-picked look rather than a ready default sheet', () => {
    const jack = character('JACK', { sheetImageUrl: null, looks: [uniform] });
    const picked = {
      ...scene,
      continuity: {
        ...scene.continuity,
        characterTags: ['jack'],
        environmentTag: '',
        characterLooks: { jack: uniform.id },
      },
    };
    expect(
      count({ scene: picked, prompt: 'JACK walks.', characters: [jack] })
    ).toBe(1);
    expect(
      count({
        scene: picked,
        prompt: 'JACK walks.',
        characters: [
          {
            ...jack,
            sheetImageUrl: '/r2/default.png',
            looks: [{ ...uniform, sheetImageUrl: null }],
          },
        ],
      })
    ).toBe(0);
  });

  it('excludes voice-only characters, absent sheets and video or audio elements', () => {
    expect(
      count({
        prompt: 'JACK, NORA and FINN watch LOGO, CLIP and MUSIC.',
        characters: [
          character('JACK'),
          character('NORA', { voiceOnly: true }),
          character('FINN', { sheetImageUrl: null }),
        ],
        elements: [
          element('LOGO'),
          element('CLIP', 'video'),
          element('MUSIC', 'audio'),
        ],
      })
    ).toBe(2);
  });

  it('uses the scene extract and location when the visual prompt has not been written', () => {
    expect(
      count({
        scene,
        characters: [character('JACK'), character('NORA')],
        locations: [location('Studio')],
        elements: [element('LOGO')],
      })
    ).toBe(4);
  });

  it('does not cap or drop inputs before the configured model capability check', () => {
    const characters = Array.from({ length: 10 }, (_, index) =>
      character('ACTOR' + index)
    );
    expect(
      count({
        characters,
        prompt: characters.map((entry) => entry.name).join(', '),
      })
    ).toBe(10);
  });

  it('distinguishes pending reference data from a loaded empty list', () => {
    expect(count()).toBe(0);
    expect(count({ scene: undefined })).toBeUndefined();
    expect(count({ characters: undefined })).toBeUndefined();
    expect(count({ locations: undefined })).toBeUndefined();
    expect(count({ elements: undefined })).toBeUndefined();
  });
});
