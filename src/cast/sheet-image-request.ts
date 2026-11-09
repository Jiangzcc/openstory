import type { AspectRatio } from '@/models/aspect-ratios';
import { DEFAULT_IMAGE_MODEL } from '@/models/models';
import type { TextToImageModel } from '@/models/models';
import type {
  CharacterSheetWorkflowInput,
  ElementSheetWorkflowInput,
  LocationSheetWorkflowInput,
} from '@/platform/server/workflow/types';

const WIDE_SHEET_ASPECT_RATIO = '16:9';
const ELEMENT_SHEET_ASPECT_RATIO = '1:1';
const SINGLE_FACE_REFERENCE_COUNT = 1;

type SheetImageRequest = {
  model: TextToImageModel;
  aspectRatio: AspectRatio;
  referenceImageCount: number;
};

function sheetImageRequest(
  imageModel: TextToImageModel | undefined,
  aspectRatio: AspectRatio,
  referenceImageCount: number
): SheetImageRequest {
  return {
    model: imageModel ?? DEFAULT_IMAGE_MODEL,
    aspectRatio,
    referenceImageCount,
  };
}

export function characterSheetImageRequest(
  sheet: Pick<
    CharacterSheetWorkflowInput,
    'imageModel' | 'face' | 'referencePhotoUrl'
  >
): SheetImageRequest {
  return sheetImageRequest(
    sheet.imageModel,
    WIDE_SHEET_ASPECT_RATIO,
    sheet.face || sheet.referencePhotoUrl ? SINGLE_FACE_REFERENCE_COUNT : 0
  );
}

// This draft receives the default sheet as its face before dispatch.
export function lookSheetAfterDefaultImageRequest(
  sheet: Pick<CharacterSheetWorkflowInput, 'imageModel'>
): SheetImageRequest {
  return sheetImageRequest(
    sheet.imageModel,
    WIDE_SHEET_ASPECT_RATIO,
    SINGLE_FACE_REFERENCE_COUNT
  );
}

export function locationSheetImageRequest(
  sheet: Pick<LocationSheetWorkflowInput, 'imageModel' | 'referencePhotoUrls'>
): SheetImageRequest {
  return sheetImageRequest(
    sheet.imageModel,
    WIDE_SHEET_ASPECT_RATIO,
    sheet.referencePhotoUrls.length
  );
}

export function elementSheetImageRequest(
  sheet: Pick<ElementSheetWorkflowInput, 'imageModel'>
): SheetImageRequest {
  return sheetImageRequest(sheet.imageModel, ELEMENT_SHEET_ASPECT_RATIO, 0);
}
