import type {
  CharacterMinimal,
  SequenceLocationMinimal,
  SequenceElementMinimal,
  SceneRow,
} from '@/platform/server/db/schema';
import type { Scene } from './scene-analysis.schema';
import {
  matchCharactersToShotImage,
  matchLocationsToScene,
  matchElementsToShotImage,
} from './scene-matching';
import { buildCharacterReferenceImages } from '@/cast/character-prompt';
import { buildLocationReferenceImages } from '@/cast/location-prompt';
import { buildElementStillReferences } from '@/cast/element-prompt';

type MatchedImageReferences = {
  characters: CharacterMinimal[];
  locations: SequenceLocationMinimal[];
  elements: SequenceElementMinimal[];
};
export type PlannedImageReferences = {
  characterLookIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
  elementIds: ReadonlySet<string>;
};
function countImages<T>(
  rows: T[],
  assemble: (rows: T[]) => unknown[],
  idOf: (row: T) => string,
  plannedIds?: ReadonlySet<string>,
  canGenerate: (row: T) => boolean = () => true
): number {
  return rows.reduce(
    (total, row) =>
      total +
      Math.max(
        assemble([row]).length,
        plannedIds?.has(idOf(row)) && canGenerate(row) ? 1 : 0
      ),
    0
  );
}
export function matchedImageReferenceCount(
  refs: MatchedImageReferences,
  planned?: PlannedImageReferences
): number {
  return (
    countImages(
      refs.characters,
      buildCharacterReferenceImages,
      (character) => character.lookId,
      planned?.characterLookIds,
      (character) => !character.voiceOnly
    ) +
    countImages(
      refs.locations,
      buildLocationReferenceImages,
      (location) => location.id,
      planned?.locationIds
    ) +
    countImages(
      refs.elements,
      buildElementStillReferences,
      (element) => element.id,
      planned?.elementIds,
      (element) => element.kind === 'image'
    )
  );
}

type ImageReferenceScene = Pick<SceneRow, 'continuity' | 'location'> & {
  script: Scene['originalScript'] | null;
};
export function shotImageReferenceCount(input: {
  scene: ImageReferenceScene | null | undefined;
  prompt: string;
  characters: CharacterMinimal[] | undefined;
  locations: SequenceLocationMinimal[] | undefined;
  elements: SequenceElementMinimal[] | undefined;
}): number | undefined {
  const { scene, characters, locations, elements } = input;
  if (scene === undefined || !characters || !locations || !elements)
    return undefined;
  const matchedCharacters = matchCharactersToShotImage(characters, {
    characterTags: scene?.continuity?.characterTags,
    characterLooks: scene?.continuity?.characterLooks,
    visualPrompt: input.prompt,
  });
  const matchedLocations = matchLocationsToScene(
    locations,
    scene?.continuity?.environmentTag ?? '',
    scene?.location ?? '',
    scene?.script?.extract,
    input.prompt
  );
  const matchedElements = matchElementsToShotImage(elements, {
    visualPrompt: input.prompt,
    elementTags: scene?.continuity?.elementTags,
    sceneExtract: scene?.script?.extract,
  });
  return matchedImageReferenceCount({
    characters: matchedCharacters,
    locations: matchedLocations,
    elements: matchedElements,
  });
}
