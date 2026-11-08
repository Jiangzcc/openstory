import { describe, expect, it } from 'vitest';
import { imageCostHint } from '@/billing/image-cost-hint';
import type { ImageCostHintInput } from '@/billing/image-cost-hint';
import { micros } from '@/billing/money';
import { buildCharacterSheetPrompt } from '@/cast/character-prompt';
import { defaultLookFaceState } from '@/cast/look-sheet-face';
import { buildCharacterSheetDraft } from '@/cast/server/sheets/character-sheet-trigger';
import { imageCatalogFixture } from '@/models/__tests__/image-model-fixture';
import { mergeImageModelCatalog } from '@/models/image-model-catalog';
import type { ImageModelCatalogEntry } from '@/models/image-channels';
import type {
  CharacterLook,
  CharacterWithSheet,
} from '@/platform/server/db/schema';
import type { ScopedDb } from '@/platform/server/db/scoped';
import { asStub } from '@/test/as-stub';
import { characterSheetReferenceImageCount } from './character-sheet-cost';

// Rows and price cards are synthetic; the payload builder, prompt and quote modules execute.
function characterRows(
  referencePhotoUrl: string | null,
  hasDefaultSheet: boolean
) {
  const defaultLook = asStub<CharacterLook>({
    id: '01K00000000000000000000001',
    isDefault: true,
    name: 'Default',
    lookVersionId: '01K00000000000000000000002',
    clothing: 'White shirt',
    styling: null,
    sheetStatus: hasDefaultSheet ? 'completed' : 'pending',
    sheetImageUrl: hasDefaultSheet ? '/r2/mock-default-sheet.png' : null,
    selectedSheetVersionId: hasDefaultSheet
      ? '01K00000000000000000000003'
      : null,
  });
  const otherLook = asStub<CharacterLook>({
    ...defaultLook,
    id: '01K00000000000000000000004',
    isDefault: false,
    name: 'Jacket',
    lookVersionId: '01K00000000000000000000005',
    clothing: 'Blue jacket',
    sheetImageUrl: null,
    sheetStatus: 'pending',
    selectedSheetVersionId: null,
  });
  const character = asStub<CharacterWithSheet>({
    id: defaultLook.id,
    name: 'Mock character',
    voiceOnly: false,
    isPerson: true,
    rendering: 'Photoreal live action',
    referencePhotoUrl,
    selectedBibleVersionId: '01K00000000000000000000006',
    looks: [defaultLook, otherLook],
  });
  return { character, defaultLook, otherLook };
}

async function sheetHints(
  referencePhotoUrl: string | null,
  hasDefaultSheet: boolean,
  isDefault: boolean,
  configuration: ImageModelCatalogEntry = imageCatalogFixture()
) {
  const { character, defaultLook, otherLook } = characterRows(
    referencePhotoUrl,
    hasDefaultSheet
  );
  const look = isDefault ? defaultLook : otherLook;
  const { draft, liveFace, refusal } = await buildCharacterSheetDraft(
    {
      scopedDb: asStub<ScopedDb>({}),
      userId: '01K00000000000000000000007',
      organizationId: '01K00000000000000000000008',
      sequence: null,
      character,
      lookId: look.id,
      imageModel: configuration.id,
    },
    { liveVersion: null }
  );
  const { referenceUrls } = buildCharacterSheetPrompt(
    draft.characterMetadata,
    draft.lookStyling,
    liveFace?.url ?? null,
    draft.referencePhotoUrl
  );
  const referenceImageCount = characterSheetReferenceImageCount(
    look,
    character.referencePhotoUrl,
    defaultLookFaceState(character.looks)
  );
  const catalog = mergeImageModelCatalog([configuration]);
  const request = {
    model: configuration.id,
    aspectRatio: '16:9',
  } satisfies Omit<ImageCostHintInput, 'referenceImageCount'>;
  return {
    draft,
    refusal,
    referenceUrls,
    referenceImageCount,
    ui: imageCostHint({ ...request, referenceImageCount }, catalog, null),
    actual: imageCostHint(
      { ...request, referenceImageCount: referenceUrls.length },
      catalog,
      null
    ),
  };
}

describe('character sheet price hints follow the generated references', () => {
  it.each([false, true])(
    'quotes the default look reference photo as an edit with an existing sheet=%s',
    async (hasDefaultSheet) => {
      const result = await sheetHints(
        '/r2/mock-photo.png',
        hasDefaultSheet,
        true
      );
      expect(result.draft.referencePhotoUrl).toBe('/r2/mock-photo.png');
      expect(result.referenceUrls).toEqual(['/r2/mock-photo.png']);
      expect(result.ui).toEqual(result.actual);
      expect(result.ui).toEqual({ estimate: micros(200_000), issue: null });
    }
  );

  it('keeps an edit-only model available for a photographed default look', async () => {
    const configuration = imageCatalogFixture();
    delete configuration.operations.generate;
    const result = await sheetHints(
      '/r2/mock-photo.png',
      false,
      true,
      configuration
    );
    expect(result.ui).toEqual(result.actual);
    expect(result.ui).toEqual({ estimate: micros(200_000), issue: null });
  });

  it('quotes an unphotographed default look as generation even when its old sheet exists', async () => {
    const result = await sheetHints(null, true, true);
    expect(result.referenceUrls).toEqual([]);
    expect(result.ui).toEqual(result.actual);
    expect(result.ui).toEqual({ estimate: micros(100_000), issue: null });
  });

  it('quotes another look from the selected default sheet alone', async () => {
    const result = await sheetHints('/r2/mock-photo.png', true, false);
    expect(result.draft.referencePhotoUrl).toBeNull();
    expect(result.referenceUrls).toEqual(['/r2/mock-default-sheet.png']);
    expect(result.referenceImageCount).toBe(1);
    expect(result.ui).toEqual(result.actual);
    expect(result.ui).toEqual({ estimate: micros(200_000), issue: null });
  });

  it('leaves an unloaded look pending', () => {
    expect(
      characterSheetReferenceImageCount(
        undefined,
        '/r2/mock-photo.png',
        'ready'
      )
    ).toBeUndefined();
  });
});
