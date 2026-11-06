/**
 * Which resolution tiers a *selection* of models can deliver (#1449).
 *
 * A sequence renders stills and clips from different catalogs under one tier,
 * so the picker offers a tier when any model in play can use it — dropping 4K
 * because the video model stops at 1080p would also take away 4K stills. What
 * the tier can't reach is named in {@link resolutionCeilingNote} instead of
 * being silently rounded off.
 *
 * Client-safe: no env, no adapters.
 */

import type { TFunction } from 'i18next';
import { IMAGE_TO_VIDEO_MODELS } from '@/models/models';
import {
  getImageModelDefinition,
  imageModelDisplayName,
} from '@/models/image-model-catalog';
import type { ImageModelDefinition } from '@/models/image-model-catalog';
import type { ImageToVideoModel, TextToImageModel } from '@/models/models';
import { DEFAULT_ASPECT_RATIO, type AspectRatio } from '@/models/aspect-ratios';
import {
  RESOLUTION_OPTIONS,
  RESOLUTIONS,
  type Resolution,
} from '@/models/resolutions';
import { imageResolutionTiers } from '@/stills/build-image-request';
import { motionResolutionTiers } from '@/motion/model-capabilities';

const NAMED_MODEL_LIMIT = 2;

type Selection = {
  imageModels?: readonly TextToImageModel[];
  imageCatalog?: readonly ImageModelDefinition[];
  /** Omit (or pass none) when motion is off — an absent render can't widen
   *  the choice. */
  videoModels?: readonly ImageToVideoModel[];
  aspectRatio?: AspectRatio;
};

/** Tiers at least one selected model can deliver, low to high. */
export function availableResolutions(selection: Selection): Resolution[] {
  const aspectRatio = selection.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const found = new Set<Resolution>();
  for (const model of selection.imageModels ?? []) {
    if (
      getImageModelDefinition(model, selection.imageCatalog)?.source !==
      'builtin'
    )
      continue;
    for (const tier of imageResolutionTiers(model, aspectRatio))
      found.add(tier);
  }
  for (const model of selection.videoModels ?? []) {
    for (const tier of motionResolutionTiers(model)) found.add(tier);
  }
  return RESOLUTIONS.filter((tier) => found.has(tier));
}

/**
 * The one-line caption under the pills: which selected models won't give you
 * the chosen tier, and why.
 *
 * Three reasons, kept apart because they aren't the same fact:
 *
 *   - *below* — the model's ceiling is under the tier (Seedance 2.5 at 4K).
 *   - *above* — its floor is over it, so the shot costs more than was asked
 *     for, not less (a model whose floor is 1080p cannot serve a 720p ask).
 *   - *a fixed size* — the tier can't move this model at all, so it is not
 *     "lower than 720p", it is outside the scale. Either it takes no size we
 *     can steer (Nano Banana 2 Lite, and the models publishing no range we'd
 *     rather not guess at), or every token it does advertise lands in one tier
 *     (H3 Max's 480P and 768P are both 720p). One reachable tier is no more of
 *     a choice than none, so both read the same way to the user.
 *
 * Null when every model serves the tier. Names at most two models per clause;
 * "and N more" is the honest way to say a whole selection is short without
 * wrapping a one-line caption.
 */
export function resolutionCeilingNote(
  resolution: Resolution,
  selection: Selection,
  translate?: TFunction<'interface'>
): string | null {
  const aspectRatio = selection.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const configured: string[] = [];
  const fixed: string[] = [];
  const lower: string[] = [];
  const higher: string[] = [];
  const index = RESOLUTIONS.indexOf(resolution);
  const sort = (name: string, tiers: readonly Resolution[]) => {
    // One reachable tier means the tier never moves this model, so say that
    // rather than staying silent when the ask happens to match it.
    if (tiers.length < 2) {
      fixed.push(name);
      return;
    }
    if (tiers.includes(resolution)) return;
    // A model can miss the tier from either side. A model whose floor is 1080p
    // renders a 720p ask *above* it — saying "below" there tells the user they
    // are getting less while they are billed for more. `tiers` is non-empty
    // here (the fixed case returned above) and ordered low to high, so its
    // first entry is the model's floor.
    const floor = tiers[0];
    const floorIsAbove =
      floor !== undefined && RESOLUTIONS.indexOf(floor) > index;
    (floorIsAbove ? higher : lower).push(name);
  };
  for (const model of selection.imageModels ?? []) {
    const name = imageModelDisplayName(model, selection.imageCatalog);
    if (
      getImageModelDefinition(model, selection.imageCatalog)?.source !==
      'builtin'
    ) {
      configured.push(name);
      continue;
    }
    sort(name, imageResolutionTiers(model, aspectRatio));
  }
  for (const model of selection.videoModels ?? []) {
    sort(IMAGE_TO_VIDEO_MODELS[model].name, motionResolutionTiers(model));
  }

  const label =
    RESOLUTION_OPTIONS.find((option) => option.value === resolution)?.label ??
    resolution;
  const clauses = [
    lower.length > 0 && resolutionClause(lower, 'below', label, translate),
    higher.length > 0 && resolutionClause(higher, 'above', label, translate),
    fixed.length > 0 && resolutionClause(fixed, 'fixed', label, translate),
    configured.length > 0 && configuredSizeNote(configured, translate),
  ].filter((clause): clause is string => clause !== false);
  return clauses.length > 0 ? clauses.join(' · ') : null;
}

/** "X renders" / "X and Y render" / "X and Y and 2 more render". */
function subject(names: string[]): string {
  const named = names.slice(0, NAMED_MODEL_LIMIT).join(' and ');
  const rest = names.length - NAMED_MODEL_LIMIT;
  const who = rest > 0 ? `${named} and ${rest} more` : named;
  return `${who} render${names.length === 1 ? 's' : ''}`;
}

function resolutionClause(
  names: string[],
  relation: 'below' | 'above' | 'fixed',
  tier: string,
  translate?: TFunction<'interface'>
): string {
  if (!translate) {
    const reason =
      relation === 'fixed' ? 'at a fixed size' : `${relation} ${tier}`;
    return `${subject(names)} ${reason}`;
  }
  const named = names.slice(0, NAMED_MODEL_LIMIT).join(translate(' and '));
  const rest = names.length - NAMED_MODEL_LIMIT;
  const models =
    rest > 0
      ? translate('{{value1}} and {{count}} more', {
          value1: named,
          count: rest,
        })
      : named;
  const values = { value1: models, value2: tier, count: names.length };
  if (relation === 'fixed')
    return translate('{{value1}} renders at a fixed size', values);
  return relation === 'below'
    ? translate('{{value1}} renders below {{value2}}', values)
    : translate('{{value1}} renders above {{value2}}', values);
}

function configuredSizeNote(
  names: readonly string[],
  translate?: TFunction<'interface'>
): string {
  const value1 = names.join(translate?.(' and ') ?? ' and ');
  return (
    translate?.('{{value1}} uses image channel size settings.', { value1 }) ??
    value1 + ' uses image channel size settings.'
  );
}
