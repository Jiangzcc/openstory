import { createCharacterLooksMethods } from '@/cast/server/db/character-looks';
import { createCharacterSheetVariantsMethods } from '@/cast/server/db/character-sheet-variants';
import { createLocationsMethods } from '@/cast/server/db/locations';
import { createLocationSheetVariantsMethods } from '@/cast/server/db/location-sheet-variants';
import { ValidationError } from '@/platform/errors';
import type { Database } from '@/platform/server/db/client';
import { createStoryboardSheetScope } from './storyboard-sheet-scope';
import { checkedStoryboardContentWrite } from './storyboard-content-writes';
import type { StoryboardContentScope } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';

export function createStoryboardReferenceSheetsMethods(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const scope = createStoryboardSheetScope(db, organizationId, owner);
  const looks = createCharacterLooksMethods(db, organizationId, scope);
  const locations = createLocationsMethods(db, organizationId, scope);
  const characterSheets = createCharacterSheetVariantsMethods(
    db,
    organizationId,
    scope
  );
  const locationSheets = createLocationSheetVariantsMethods(
    db,
    organizationId,
    scope
  );
  const bind = bindSheetWriter(scope, owner.id);
  return {
    characterLooks: {
      claimSheet: bind(
        looks.claimSheet,
        (_id, _snapshot, opts) => opts.activity?.sequenceId
      ),
      failSheetClaim: looks.failSheetClaim,
    },
    locations: {
      claimReference: bind(
        locations.claimReference,
        (_id, opts) => opts.activity?.sequenceId
      ),
      failReferenceClaim: locations.failReferenceClaim,
    },
    characterSheetVariants: {
      promoteIfPending: bind(
        characterSheets.promoteIfPending,
        (args) => args.activity?.sequenceId
      ),
    },
    locationSheetVariants: {
      promoteIfPending: bind(
        locationSheets.promoteIfPending,
        (args) => args.activity?.sequenceId
      ),
    },
  };
}

function bindSheetWriter(scope: StoryboardContentScope, sequenceId: string) {
  return <Args extends unknown[], Result>(
    write: (...args: Args) => Promise<Result>,
    activity: (...args: Args) => string | null | undefined
  ) =>
    checkedStoryboardContentWrite(scope, async (...args: Args) => {
      const target = activity(...args);
      if (target != null && target !== sequenceId) {
        throw new ValidationError(
          'Sheet activity is outside the Storyboard sequence'
        );
      }
      return write(...args);
    });
}
