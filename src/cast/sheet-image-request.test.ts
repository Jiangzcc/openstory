import { describe, expect, it } from 'vitest';
import { buildCharacterSheetPrompt } from '@/cast/character-prompt';
import { buildLocationSheetPrompt } from '@/cast/location-prompt';
import { populatedDefaultSheet } from '@/cast/look-sheet-face';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { finishCharacterSheetPayload } from '@/cast/server/workflows/sheet-snapshots';
import type { CharacterSheetDraft } from '@/cast/server/workflows/sheet-snapshots';
import { DEFAULT_IMAGE_MODEL } from '@/models/models';
import type { TextToImageModel } from '@/models/models';
import type {
  CharacterBibleEntry,
  LocationBibleEntry,
} from '@/shots/scene-analysis.schema';
import {
  characterSheetImageRequest,
  elementSheetImageRequest,
  locationSheetImageRequest,
  lookSheetAfterDefaultImageRequest,
} from './sheet-image-request';

const IMAGE_MODEL: TextToImageModel = 'nano_banana_2';
const CHARACTER_ID = '01K00000000000000000000001';
const LOOK_ID = '01K00000000000000000000002';
const LOOK_VERSION_ID = '01K00000000000000000000003';
const PHOTO_URL = '/r2/synthetic-character-photo.png';
const FACE_URL = '/r2/synthetic-default-sheet.png';
const LOCATION_PHOTO_A = '/r2/synthetic-location-a.png';
const LOCATION_PHOTO_B = '/r2/synthetic-location-b.png';

// Synthetic bibles and DTOs; reference builders and snapshot finishing execute for real.
const CHARACTER_BIBLE: CharacterBibleEntry = {
  characterId: 'synthetic-character',
  name: 'Synthetic Character',
  age: '30s',
  gender: '',
  ethnicity: '',
  physicalDescription: 'Short dark hair',
  standardClothing: 'A red coat',
  looks: [],
  personality: '',
  movement: '',
  voiceDescription: '',
  voiceOnly: false,
  isPerson: true,
  rendering: PHOTOREAL_RENDERING,
  consistencyTag: 'synthetic-character',
};

const LOCATION_BIBLE: LocationBibleEntry = {
  locationId: 'synthetic-location',
  name: 'Synthetic Workshop',
  type: 'interior',
  description: 'A small workshop with a wooden bench',
  architecturalStyle: 'Industrial',
  keyFeatures: 'A wide window',
  ambiance: 'Quiet',
  rendering: PHOTOREAL_RENDERING,
  consistencyTag: 'synthetic-location',
  firstMention: {
    sceneId: 'synthetic-scene',
    text: 'A workshop',
    lineNumber: 1,
  },
};

const FACE = populatedDefaultSheet({
  id: CHARACTER_ID,
  sheetImageUrl: FACE_URL,
  selectedSheetVersionId: CHARACTER_ID,
});

const CHARACTER_CASES = [
  {
    name: 'default look without a photo',
    face: null,
    referencePhotoUrl: null,
    expectedReferences: [],
  },
  {
    name: 'default look with a photo',
    face: null,
    referencePhotoUrl: PHOTO_URL,
    expectedReferences: [PHOTO_URL],
  },
  {
    name: 'non-default look with a populated face',
    face: FACE,
    referencePhotoUrl: null,
    expectedReferences: [FACE_URL],
  },
  {
    name: 'face and photo together use the face alone',
    face: FACE,
    referencePhotoUrl: PHOTO_URL,
    expectedReferences: [FACE_URL],
  },
];

const LOCATION_CASES = [
  { name: 'no photos', referencePhotoUrls: [] },
  { name: 'one photo', referencePhotoUrls: [LOCATION_PHOTO_A] },
  {
    name: 'multiple photos',
    referencePhotoUrls: [LOCATION_PHOTO_B, LOCATION_PHOTO_A],
  },
  {
    name: 'duplicate photo URLs remain separate references',
    referencePhotoUrls: [LOCATION_PHOTO_A, LOCATION_PHOTO_A, LOCATION_PHOTO_B],
  },
];

const MODEL_CASES = [
  {
    name: 'character sheet',
    project: (imageModel?: TextToImageModel) =>
      characterSheetImageRequest({
        imageModel,
        face: null,
        referencePhotoUrl: null,
      }),
  },
  {
    name: 'deferred look',
    project: (imageModel?: TextToImageModel) =>
      lookSheetAfterDefaultImageRequest({ imageModel }),
  },
  {
    name: 'location sheet',
    project: (imageModel?: TextToImageModel) =>
      locationSheetImageRequest({ imageModel, referencePhotoUrls: [] }),
  },
  {
    name: 'element sheet',
    project: (imageModel?: TextToImageModel) =>
      elementSheetImageRequest({ imageModel }),
  },
];

function deferredDraft(imageModel?: TextToImageModel): CharacterSheetDraft {
  return {
    userId: '01K00000000000000000000004',
    organizationId: '01K00000000000000000000005',
    sequenceId: null,
    characterDbId: CHARACTER_ID,
    lookId: LOOK_ID,
    lookVersionId: LOOK_VERSION_ID,
    lookStyling: null,
    referencePhotoUrl: null,
    characterName: CHARACTER_BIBLE.name,
    characterMetadata: CHARACTER_BIBLE,
    bibleVersionId: null,
    imageModel,
  };
}

describe('character sheet reference projection', () => {
  it.each(CHARACTER_CASES)(
    'matches the prompt references for $name',
    ({ face, referencePhotoUrl, expectedReferences }) => {
      const { referenceUrls } = buildCharacterSheetPrompt(
        CHARACTER_BIBLE,
        null,
        face === null ? null : face.url,
        referencePhotoUrl
      );
      expect(referenceUrls).toEqual(expectedReferences);
      expect(
        characterSheetImageRequest({
          imageModel: IMAGE_MODEL,
          face,
          referencePhotoUrl,
        })
      ).toEqual({
        model: IMAGE_MODEL,
        aspectRatio: '16:9',
        referenceImageCount: referenceUrls.length,
      });
    }
  );
});

describe('location sheet reference projection', () => {
  it.each(LOCATION_CASES)(
    'matches the prompt references for $name',
    ({ referencePhotoUrls }) => {
      const { referenceUrls } = buildLocationSheetPrompt(
        LOCATION_BIBLE,
        referencePhotoUrls
      );
      expect(referenceUrls).toEqual(referencePhotoUrls);
      expect(
        locationSheetImageRequest({
          imageModel: IMAGE_MODEL,
          referencePhotoUrls,
        })
      ).toEqual({
        model: IMAGE_MODEL,
        aspectRatio: '16:9',
        referenceImageCount: referenceUrls.length,
      });
    }
  );
});

describe('sheet request model selection', () => {
  it.each(MODEL_CASES)(
    '$name uses the default when no model is supplied',
    ({ project }) => {
      expect(project(undefined).model).toBe(DEFAULT_IMAGE_MODEL);
    }
  );

  it.each(MODEL_CASES)('$name preserves the explicit model', ({ project }) => {
    expect(project(IMAGE_MODEL).model).toBe(IMAGE_MODEL);
  });
});

describe('deferred look reference projection', () => {
  it.each([undefined, IMAGE_MODEL])(
    'reserves one face before finishing the draft with model %s',
    async (imageModel) => {
      const draft = deferredDraft(imageModel);
      const projected = lookSheetAfterDefaultImageRequest(draft);
      expect(draft).not.toHaveProperty('face');
      expect(projected).toEqual({
        model: imageModel ?? DEFAULT_IMAGE_MODEL,
        aspectRatio: '16:9',
        referenceImageCount: 1,
      });
      const finished = await finishCharacterSheetPayload(draft, FACE);
      const { referenceUrls } = buildCharacterSheetPrompt(
        finished.characterMetadata,
        finished.lookStyling,
        finished.face === null ? null : finished.face.url,
        finished.referencePhotoUrl
      );
      expect(referenceUrls).toEqual([FACE_URL]);
      expect(characterSheetImageRequest(finished)).toEqual(projected);
      expect(projected.referenceImageCount).toBe(referenceUrls.length);
    }
  );
});

describe('element sheet image request', () => {
  it('generates a square sheet without input reference images', () => {
    expect(elementSheetImageRequest({ imageModel: IMAGE_MODEL })).toEqual({
      model: IMAGE_MODEL,
      aspectRatio: '1:1',
      referenceImageCount: 0,
    });
  });
});
