import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import { onPrimary } from '@/platform/server/db/d1-session';
import { decryptApiKey } from '@/platform/server/crypto/api-key-encryption';
import { ValidationError } from '@/platform/errors';
import type { ImageChannelsConfiguration } from '@/models/image-channels';
import {
  emptyImageChannelsConfiguration,
  imageChannelsConfigurationSchema,
  IMAGE_CHANNEL_LIMITS,
} from '@/models/image-channels';
import type { ImageChannelCredential } from '../image-channel-service';
import {
  createImageChannelsAdminService,
  createImageChannelsReader,
} from '../image-channel-service';

export const IMAGE_CHANNELS_KEY = 'secondary-development:image-channels:v1';
export const IMAGE_CHANNEL_CREDENTIAL_PREFIX =
  'secondary-development:image-channel-credential:v1:';
const encryptedCredentialSchema = z.strictObject({
  encryptedKey: z.string().min(IMAGE_CHANNEL_LIMITS.requiredLength),
  keyIv: z.string().min(IMAGE_CHANNEL_LIMITS.requiredLength),
  keyTag: z.string().min(IMAGE_CHANNEL_LIMITS.requiredLength),
});

async function readStoredConfiguration(
  db: Database
): Promise<ImageChannelsConfiguration> {
  const [row] = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, IMAGE_CHANNELS_KEY))
    .limit(1);
  if (!row) return emptyImageChannelsConfiguration();
  try {
    return imageChannelsConfigurationSchema.parse(
      JSON.parse(row.value) as unknown
    );
  } catch {
    throw new ValidationError('Stored image channel settings are invalid.');
  }
}

async function resolveStoredSecret(
  db: Database,
  credentialId: string
): Promise<string> {
  if (!z.ulid().safeParse(credentialId).success)
    throw new ValidationError('Image channel credential is unavailable.');
  const [row] = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, IMAGE_CHANNEL_CREDENTIAL_PREFIX + credentialId))
    .limit(1);
  if (!row)
    throw new ValidationError('Image channel credential is unavailable.');
  try {
    return await decryptApiKey(
      encryptedCredentialSchema.parse(JSON.parse(row.value) as unknown)
    );
  } catch {
    throw new ValidationError('Image channel credential is unavailable.');
  }
}

function credentialWrite(
  db: Database,
  credential: ImageChannelCredential,
  now: Date
) {
  const { id, ...encrypted } = credential;
  return db.insert(appMetadata).values({
    key: IMAGE_CHANNEL_CREDENTIAL_PREFIX + id,
    value: JSON.stringify(encrypted),
    updatedAt: now,
  });
}

async function commitConfiguration(
  db: Database,
  next: ImageChannelsConfiguration,
  credential?: ImageChannelCredential
): Promise<void> {
  const serialized = JSON.stringify(
    imageChannelsConfigurationSchema.parse(next)
  );
  const now = new Date();
  const write = db
    .insert(appMetadata)
    .values({ key: IMAGE_CHANNELS_KEY, value: serialized, updatedAt: now })
    .onConflictDoUpdate({
      target: appMetadata.key,
      set: { value: serialized, updatedAt: now },
    });
  if (credential) await db.batch([write, credentialWrite(db, credential, now)]);
  else await write;
}

function createReadStore(db: Database) {
  return {
    read: () => onPrimary(() => readStoredConfiguration(db)),
    resolveSecret: (credentialId: string) =>
      onPrimary(() => resolveStoredSecret(db, credentialId)),
  };
}

export function createImageChannelsReadMethods(db: Database) {
  return createImageChannelsReader(createReadStore(db));
}

export function createImageChannelsAdminMethods(db: Database) {
  return createImageChannelsAdminService({
    ...createReadStore(db),
    commit: (next, credential) => commitConfiguration(db, next, credential),
  });
}
