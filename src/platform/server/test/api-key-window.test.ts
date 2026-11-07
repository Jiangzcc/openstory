import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateId } from '@/platform/id';
import { apikey } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';

const { db, close } = await createTestDb();
vi.doMock('#db-client', () => ({ getDb: () => db }));
vi.doMock('@/platform/server/db/scoped', () => ({
  getSequenceByIdUnscoped: vi.fn(),
}));
const { extendTestApiKeyRateLimitWindow } = await import('./seed');

afterAll(close);

async function createKey(referenceId: string, rateLimitMax = 10) {
  const id = generateId();
  await db.insert(apikey).values({
    id,
    referenceId,
    name: 'Synthetic burst-test key',
    key: `synthetic-test-hash-${id}`,
    rateLimitMax,
    rateLimitTimeWindow: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function readWindow(id: string) {
  return db
    .select({
      rateLimitMax: apikey.rateLimitMax,
      rateLimitTimeWindow: apikey.rateLimitTimeWindow,
      requestCount: apikey.requestCount,
      lastRequest: apikey.lastRequest,
    })
    .from(apikey)
    .where(eq(apikey.id, id))
    .get();
}

describe('burst-test API key window', () => {
  it('extends only the requested owned key and preserves the threshold', async () => {
    const userId = generateId();
    const keyId = await createKey(userId);
    const siblingId = await createKey(userId);

    expect(await extendTestApiKeyRateLimitWindow(userId, keyId)).toEqual({
      id: keyId,
      rateLimitMax: 10,
      rateLimitTimeWindow: 60_000,
    });
    expect(await readWindow(keyId)).toEqual({
      rateLimitMax: 10,
      rateLimitTimeWindow: 60_000,
      requestCount: 0,
      lastRequest: null,
    });
    expect((await readWindow(siblingId))?.rateLimitTimeWindow).toBe(1000);
  });

  it('refuses a key belonging to another user', async () => {
    const keyId = await createKey(generateId());

    expect(
      await extendTestApiKeyRateLimitWindow(generateId(), keyId)
    ).toBeUndefined();
    expect((await readWindow(keyId))?.rateLimitTimeWindow).toBe(1000);
  });

  it('refuses a key whose default threshold differs', async () => {
    const userId = generateId();
    const keyId = await createKey(userId, 11);

    expect(
      await extendTestApiKeyRateLimitWindow(userId, keyId)
    ).toBeUndefined();
    expect((await readWindow(keyId))?.rateLimitTimeWindow).toBe(1000);
  });
});
