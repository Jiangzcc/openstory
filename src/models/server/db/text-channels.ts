import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import { onPrimary } from '@/platform/server/db/d1-session';
import { decryptApiKey } from '@/platform/server/crypto/api-key-encryption';
import { ValidationError } from '@/platform/errors';
import type { TextChannelsConfiguration } from '@/models/text-channels';
import {
  emptyTextChannelsConfiguration,
  TEXT_CHANNEL_LIMITS,
  textChannelsConfigurationSchema,
} from '@/models/text-channels';
import type { TextChannelCredential } from '../text-channel-service';
import {
  createTextChannelsAdminService,
  createTextChannelsReader,
} from '../text-channel-service';

export const TEXT_CHANNELS_KEY = 'secondary-development:text-channels:v1';
export const TEXT_CHANNEL_CREDENTIAL_PREFIX =
  'secondary-development:text-channel-credential:v1:';
const encryptedCredentialSchema = z.strictObject({
  encryptedKey: z.string().min(TEXT_CHANNEL_LIMITS.requiredLength),
  keyIv: z.string().min(TEXT_CHANNEL_LIMITS.requiredLength),
  keyTag: z.string().min(TEXT_CHANNEL_LIMITS.requiredLength),
});

async function readStoredConfiguration(
  db: Database
): Promise<TextChannelsConfiguration> {
  const [row] = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, TEXT_CHANNELS_KEY))
    .limit(1);
  if (!row) return emptyTextChannelsConfiguration();
  try {
    return textChannelsConfigurationSchema.parse(
      JSON.parse(row.value) as unknown
    );
  } catch {
    throw new ValidationError('Stored text channel settings are invalid.');
  }
}

async function resolveStoredSecret(
  db: Database,
  credentialId: string
): Promise<string> {
  if (!z.uuid().safeParse(credentialId).success) {
    throw new ValidationError('Text channel credential is unavailable.');
  }
  const [row] = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, TEXT_CHANNEL_CREDENTIAL_PREFIX + credentialId))
    .limit(1);
  if (!row)
    throw new ValidationError('Text channel credential is unavailable.');
  try {
    const encrypted = encryptedCredentialSchema.parse(
      JSON.parse(row.value) as unknown
    );
    return await decryptApiKey(encrypted);
  } catch {
    throw new ValidationError('Text channel credential is unavailable.');
  }
}

function credentialWrite(
  db: Database,
  credential: TextChannelCredential,
  now: Date
) {
  const { id, ...encrypted } = credential;
  return db.insert(appMetadata).values({
    key: TEXT_CHANNEL_CREDENTIAL_PREFIX + id,
    value: JSON.stringify(encrypted),
    updatedAt: now,
  });
}

async function commitConfiguration(
  db: Database,
  next: TextChannelsConfiguration,
  credential?: TextChannelCredential
): Promise<void> {
  const serialized = JSON.stringify(
    textChannelsConfigurationSchema.parse(next)
  );
  const now = new Date();
  const write = db
    .insert(appMetadata)
    .values({ key: TEXT_CHANNELS_KEY, value: serialized, updatedAt: now })
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

export function createTextChannelsReadMethods(db: Database) {
  return createTextChannelsReader(createReadStore(db));
}

export function createTextChannelsAdminMethods(db: Database) {
  return createTextChannelsAdminService({
    ...createReadStore(db),
    commit: (next, credential) => commitConfiguration(db, next, credential),
  });
}
