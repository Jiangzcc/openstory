import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import {
  characterVoiceVersions,
  characters,
  organization,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { createCharactersMethods } from './characters';

const FAILURE_MESSAGE = 'Synthetic voice design failure';
const STATUS_WRITE_ERROR = 'Synthetic voice status write failure';
const LIVE_STATUSES = ['pending', 'generating'] as const;

let db: Database;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
afterEach(async () => {
  await db.run(
    sql.raw('DROP TRIGGER IF EXISTS synthetic_voice_status_failure')
  );
});

async function seedClaim() {
  const organizationId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Voice claim test',
    slug: organizationId,
  });
  const actorId = generateId();
  await db.insert(user).values({
    id: actorId,
    name: 'Voice claim writer',
    email: actorId + '@example.invalid',
  });
  const methods = createCharactersMethods(db, organizationId);
  const character = await methods.createForOrganization(
    { name: 'Maya', rendering: PHOTOREAL_RENDERING, standardClothing: 'coat' },
    { createdBy: actorId }
  );
  const { version } = await methods.createPendingVoiceClaim(
    character.id,
    null,
    {
      activity: null,
    }
  );
  return { methods, character, version };
}

async function storedCharacter(characterId: string) {
  const [row] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId));
  if (!row) throw new Error('Missing test character');
  return row;
}

async function storedVersion(versionId: string) {
  const [row] = await db
    .select()
    .from(characterVoiceVersions)
    .where(eq(characterVoiceVersions.id, versionId));
  if (!row) throw new Error('Missing test voice version');
  return row;
}

async function expectWriteFailure(action: Promise<unknown>, message: string) {
  await expect(
    action.catch((error: unknown) => {
      throw error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    })
  ).rejects.toThrow(message);
}

async function failStatusWrites() {
  await db.run(
    sql.raw(
      "CREATE TRIGGER synthetic_voice_status_failure BEFORE UPDATE OF status ON character_voice_versions WHEN NEW.status = 'failed' BEGIN SELECT RAISE(ABORT, 'Synthetic voice status write failure'); END"
    )
  );
}

describe('voice claim terminal lifecycle', () => {
  it.each(LIVE_STATUSES)(
    'marks a %s claim failed and clears its pending pointer',
    async (status) => {
      const { methods, character, version } = await seedClaim();
      await db
        .update(characterVoiceVersions)
        .set({ status })
        .where(eq(characterVoiceVersions.id, version.id));
      expect(
        await methods.markVoiceClaimTerminal(
          version.id,
          'failed',
          FAILURE_MESSAGE
        )
      ).toMatchObject({
        id: version.id,
        status: 'failed',
        error: FAILURE_MESSAGE,
      });
      expect(
        (await storedCharacter(character.id)).pendingPromoteVoiceVersionId
      ).toBeNull();
    }
  );

  it('preserves the claim and pointer when its status write fails', async () => {
    const { methods, character, version } = await seedClaim();
    const beforeCharacter = await storedCharacter(character.id);
    const beforeVersion = await storedVersion(version.id);
    await failStatusWrites();

    await expectWriteFailure(
      methods.markVoiceClaimTerminal(version.id, 'failed', FAILURE_MESSAGE),
      STATUS_WRITE_ERROR
    );
    expect(await storedVersion(version.id)).toEqual(beforeVersion);
    expect(await storedCharacter(character.id)).toEqual(beforeCharacter);
  });

  it('returns null on repeat without rewriting the terminal error or character', async () => {
    const { methods, character, version } = await seedClaim();
    await methods.markVoiceClaimTerminal(version.id, 'failed', FAILURE_MESSAGE);
    const beforeCharacter = await storedCharacter(character.id);
    const beforeVersion = await storedVersion(version.id);

    expect(
      await methods.markVoiceClaimTerminal(
        version.id,
        'failed',
        'Retry message'
      )
    ).toBeNull();
    expect(await storedCharacter(character.id)).toEqual(beforeCharacter);
    expect(await storedVersion(version.id)).toEqual(beforeVersion);
  });

  it('preserves a newer claim when an older failure is retried', async () => {
    const { methods, character, version } = await seedClaim();
    await db
      .update(characterVoiceVersions)
      .set({ status: 'failed', error: FAILURE_MESSAGE })
      .where(eq(characterVoiceVersions.id, version.id));
    const newer = await methods.createPendingVoiceClaim(character.id, null, {
      activity: null,
    });
    const beforeCharacter = await storedCharacter(character.id);

    expect(
      await methods.markVoiceClaimTerminal(
        version.id,
        'failed',
        'Retry message'
      )
    ).toBeNull();
    expect(await storedCharacter(character.id)).toEqual(beforeCharacter);
    expect(await storedVersion(newer.version.id)).toEqual(newer.version);
  });

  it('keeps a user-selected voice when the demoted live claim fails', async () => {
    const { methods, character, version } = await seedClaim();
    const picked = await methods.updateVoice(
      character.id,
      { voiceId: 'synthetic-library-voice' },
      'library',
      null,
      null
    );
    const beforeCharacter = await storedCharacter(character.id);

    expect(picked.voiceId).toBe('synthetic-library-voice');
    expect(
      await methods.markVoiceClaimTerminal(
        version.id,
        'failed',
        FAILURE_MESSAGE
      )
    ).toMatchObject({ status: 'failed' });
    expect(await storedCharacter(character.id)).toEqual(beforeCharacter);
  });

  it('leaves a completed claim available for its guarded promotion', async () => {
    const { methods, character, version } = await seedClaim();
    await methods.completeVoiceClaimIfLive(
      version.id,
      { voiceId: 'synthetic-designed-voice' },
      null
    );
    const beforeCharacter = await storedCharacter(character.id);
    const beforeVersion = await storedVersion(version.id);

    expect(
      await methods.markVoiceClaimTerminal(
        version.id,
        'failed',
        FAILURE_MESSAGE
      )
    ).toBeNull();
    expect(await storedCharacter(character.id)).toEqual(beforeCharacter);
    expect(await storedVersion(version.id)).toEqual(beforeVersion);
    expect(
      await methods.promoteVoiceClaimIfPending(character.id, version.id)
    ).toMatchObject({ voiceId: 'synthetic-designed-voice' });
  });

  it('returns null for a missing claim without changing an existing one', async () => {
    const { methods, character, version } = await seedClaim();
    const beforeCharacter = await storedCharacter(character.id);

    expect(
      await methods.markVoiceClaimTerminal(
        generateId(),
        'failed',
        FAILURE_MESSAGE
      )
    ).toBeNull();
    expect(await storedCharacter(character.id)).toEqual(beforeCharacter);
    expect(await storedVersion(version.id)).toEqual(version);
  });
});
