import { and, eq } from 'drizzle-orm';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import { onPrimary } from '@/platform/server/db/d1-session';
import { ConflictError, ValidationError } from '@/platform/errors';
import {
  IMAGE_ATTEMPT_LIMITS,
  IMAGE_ATTEMPT_STATUS,
  imageAttemptIdentitySchema,
  imageGenerationAttemptSchema,
  storedChannelGenerationSchema,
} from '../configured-image-attempt';
import type {
  ImageAttemptIdentity,
  ImageGenerationAttempt,
  StoredChannelGeneration,
} from '../configured-image-attempt';

const IMAGE_ATTEMPT_PREFIX = 'secondary-development:image-attempt:v1:';

function attemptKey(organizationId: string, id: string): string {
  return IMAGE_ATTEMPT_PREFIX + organizationId + ':' + id;
}

async function findAttempt(
  db: Database,
  key: string
): Promise<ImageGenerationAttempt | undefined> {
  const [row] = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, key))
    .limit(1);
  if (!row) return undefined;
  return imageGenerationAttemptSchema.parse(JSON.parse(row.value) as unknown);
}

async function findMatchingAttempt(
  db: Database,
  key: string,
  identity: ImageAttemptIdentity
): Promise<ImageGenerationAttempt | undefined> {
  const attempt = await findAttempt(db, key);
  if (
    attempt &&
    (attempt.inputHash !== identity.inputHash ||
      attempt.model !== identity.model)
  ) {
    throw new ConflictError('Image attempt belongs to a different request.');
  }
  return attempt;
}

async function claimAttempt(
  db: Database,
  key: string,
  input: ImageAttemptIdentity
): Promise<{ claimed: boolean; attempt: ImageGenerationAttempt }> {
  const submitted = { ...input, status: IMAGE_ATTEMPT_STATUS.submitted };
  const inserted = await db
    .insert(appMetadata)
    .values({
      key,
      value: JSON.stringify(submitted),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ key: appMetadata.key });
  if (inserted.length > 0) return { claimed: true, attempt: submitted };
  const attempt = await findAttempt(db, key);
  if (!attempt) throw new ConflictError('Image attempt is unavailable.');
  if (attempt.inputHash !== input.inputHash || attempt.model !== input.model) {
    throw new ConflictError('Image attempt belongs to a different request.');
  }
  return { claimed: false, attempt };
}

async function updateAttempt(
  db: Database,
  key: string,
  identity: ImageAttemptIdentity,
  changes: Pick<ImageGenerationAttempt, 'status' | 'result' | 'error'>
): Promise<void> {
  const previous = JSON.stringify({
    ...identity,
    status: IMAGE_ATTEMPT_STATUS.submitted,
  });
  const value = JSON.stringify({ ...identity, ...changes });
  if (
    new TextEncoder().encode(value).byteLength >
    IMAGE_ATTEMPT_LIMITS.resultBytes
  ) {
    throw new ValidationError('Image attempt metadata is too large.');
  }
  const rows = await db
    .update(appMetadata)
    .set({ value, updatedAt: new Date() })
    .where(and(eq(appMetadata.key, key), eq(appMetadata.value, previous)))
    .returning({ key: appMetadata.key });
  if (rows.length > 0) return;
  const current = await findAttempt(db, key);
  if (current && JSON.stringify(current) === value) return;
  throw new ConflictError('Image attempt state changed.');
}

export function createImageGenerationAttemptsMethods(
  db: Database,
  organizationId: string
) {
  return {
    getById(input: ImageAttemptIdentity) {
      const identity = imageAttemptIdentitySchema.parse(input);
      return onPrimary(() =>
        findMatchingAttempt(
          db,
          attemptKey(organizationId, identity.id),
          identity
        )
      );
    },
    claim(input: ImageAttemptIdentity) {
      const identity = imageAttemptIdentitySchema.parse(input);
      return onPrimary(() =>
        claimAttempt(db, attemptKey(organizationId, identity.id), identity)
      );
    },
    complete(input: ImageAttemptIdentity, value: StoredChannelGeneration) {
      const identity = imageAttemptIdentitySchema.parse(input);
      const result = storedChannelGenerationSchema.parse(value);
      return onPrimary(() =>
        updateAttempt(db, attemptKey(organizationId, identity.id), identity, {
          status: IMAGE_ATTEMPT_STATUS.stored,
          result,
        })
      );
    },
    markUnknown(input: ImageAttemptIdentity) {
      const identity = imageAttemptIdentitySchema.parse(input);
      return onPrimary(() =>
        updateAttempt(db, attemptKey(organizationId, identity.id), identity, {
          status: IMAGE_ATTEMPT_STATUS.unknown,
          error: 'Submitted image generation did not complete locally.',
        })
      );
    },
  };
}
