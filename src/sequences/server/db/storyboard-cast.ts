import { createCharactersMethods } from '@/cast/server/db/characters';
import { createCharacterLooksMethods } from '@/cast/server/db/character-looks';
import { createLocationsMethods } from '@/cast/server/db/locations';
import { createSequenceElementsMethods } from '@/cast/server/db/sequence-elements';
import { ValidationError } from '@/platform/errors';
import type { Database } from '@/platform/server/db/client';
import { createStoryboardCastScope } from './storyboard-cast-scope';
import { checkedStoryboardContentWrite } from './storyboard-content-writes';
import type { StoryboardContentScope } from './storyboard-content-scope';
import type { StoryboardOwner } from './storyboard-owner';

export function createStoryboardCastMethods(
  db: Database,
  organizationId: string,
  owner: StoryboardOwner
) {
  const scope = createStoryboardCastScope(db, organizationId, owner);
  const characters = createCharactersMethods(db, organizationId, scope);
  const looks = createCharacterLooksMethods(db, organizationId, scope);
  const locations = createLocationsMethods(db, organizationId, scope);
  const elements = createSequenceElementsMethods(db, scope);
  const bind = bindSequenceWriter(scope, owner.id);
  return {
    characters: {
      create: bind(characters.create, (data) => [data.sequenceId]),
    },
    characterLooks: {
      syncFromAnalysis: bind(looks.syncFromAnalysis, singleSequence),
      linkFromAnalysis: bind(looks.linkFromAnalysis, singleSequence),
    },
    locations: {
      createBulk: bind(locations.createBulk, (data) =>
        data.map((row) => row.sequenceId)
      ),
    },
    sequenceElements: {
      create: bind(elements.create, (data) => [data.sequenceId]),
    },
    withOwnership: <Result>(write: () => Promise<Result>) =>
      checkedStoryboardContentWrite(scope, write)(),
  };
}

const singleSequence = (sequenceId: string) => [sequenceId];

function bindSequenceWriter(scope: StoryboardContentScope, sequenceId: string) {
  return <Args extends unknown[], Result>(
    write: (...args: Args) => Promise<Result>,
    targets: (...args: Args) => ReadonlyArray<string | null | undefined>
  ) =>
    checkedStoryboardContentWrite(scope, async (...args: Args) => {
      if (targets(...args).some((target) => target !== sequenceId)) {
        throw new ValidationError(
          'Cast write target is outside the Storyboard sequence'
        );
      }
      return write(...args);
    });
}
