import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/platform/server/db/client';
import { appMetadata } from '@/platform/server/db/schema';
import { decryptApiKey } from '@/platform/server/crypto/api-key-encryption';
import { ConflictError, ValidationError } from '@/platform/errors';
import type { TextChannelsConfiguration } from '@/models/text-channels';
import {
  emptyTextChannelsConfiguration,
  TEXT_CHANNEL_LIMITS,
  textChannelsConfigurationSchema,
} from '@/models/text-channels';
import type {
  StoredTextChannels,
  TextChannelCredential,
} from '../text-channel-service';
import {
  createTextChannelsAdminService,
  createTextChannelsReader,
} from '../text-channel-service';

export const TEXT_CHANNELS_KEY = 'secondary-development:text-channels:v1';
export const TEXT_CHANNEL_CREDENTIAL_PREFIX =
  'secondary-development:text-channel-credential:v1:';
const MILLISECONDS_PER_SECOND = 1_000;
const encryptedCredentialSchema = z.strictObject({
  encryptedKey: z.string().min(TEXT_CHANNEL_LIMITS.requiredLength),
  keyIv: z.string().min(TEXT_CHANNEL_LIMITS.requiredLength),
  keyTag: z.string().min(TEXT_CHANNEL_LIMITS.requiredLength),
});

async function readStoredConfiguration(
  db: Database
): Promise<StoredTextChannels> {
  const [row] = await db
    .select()
    .from(appMetadata)
    .where(eq(appMetadata.key, TEXT_CHANNELS_KEY))
    .limit(1);
  if (!row)
    return {
      configuration: emptyTextChannelsConfiguration(),
      serialized: null,
    };
  try {
    return {
      configuration: textChannelsConfigurationSchema.parse(
        JSON.parse(row.value) as unknown
      ),
      serialized: row.value,
    };
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

function configurationWrite(
  db: Database,
  previous: string | null,
  serialized: string,
  now: Date
) {
  const values = { key: TEXT_CHANNELS_KEY, value: serialized, updatedAt: now };
  if (previous === null) {
    return db
      .insert(appMetadata)
      .values(values)
      .onConflictDoNothing()
      .returning({ key: appMetadata.key });
  }
  return db
    .update(appMetadata)
    .set({ value: serialized, updatedAt: now })
    .where(
      and(
        eq(appMetadata.key, TEXT_CHANNELS_KEY),
        eq(appMetadata.value, previous)
      )
    )
    .returning({ key: appMetadata.key });
}

function credentialWrite(
  db: Database,
  credential: TextChannelCredential,
  now: Date
) {
  const { id, ...encrypted } = credential;
  return db.insert(appMetadata).select(
    db
      .select({
        key: sql<string>`${TEXT_CHANNEL_CREDENTIAL_PREFIX + id}`.as('key'),
        value: sql<string>`${JSON.stringify(encrypted)}`.as('value'),
        updatedAt:
          sql<number>`${Math.floor(now.getTime() / MILLISECONDS_PER_SECOND)}`.as(
            'updated_at'
          ),
      })
      .from(appMetadata)
      .where(and(eq(appMetadata.key, TEXT_CHANNELS_KEY), sql`changes() > 0`))
  );
}

async function commitConfiguration(
  db: Database,
  previous: string | null,
  next: TextChannelsConfiguration,
  credential?: TextChannelCredential
): Promise<void> {
  const serialized = JSON.stringify(
    textChannelsConfigurationSchema.parse(next)
  );
  const now = new Date();
  const write = configurationWrite(db, previous, serialized, now);
  const rows = credential
    ? (await db.batch([write, credentialWrite(db, credential, now)]))[0]
    : await write;
  if (rows.length === 0) {
    throw new ConflictError(
      'Text channel settings changed. Reload before saving.'
    );
  }
}

function createReadStore(db: Database) {
  return {
    read: () => readStoredConfiguration(db),
    resolveSecret: (credentialId: string) =>
      resolveStoredSecret(db, credentialId),
  };
}

export function createTextChannelsReadMethods(db: Database) {
  return createTextChannelsReader(createReadStore(db));
}

export function createTextChannelsAdminMethods(db: Database) {
  return createTextChannelsAdminService({
    ...createReadStore(db),
    commit: (previous, next, credential) =>
      commitConfiguration(db, previous, next, credential),
  });
}
