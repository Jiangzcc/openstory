import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import { appMetadata } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { micros } from '@/billing/money';
import { createImageGenerationAttemptsMethods } from './image-generation-attempts';
import type { StoredChannelGeneration } from '../configured-image-attempt';

let db: Database;
let closeDb: () => Promise<void>;
const organizationId = generateId();
const identity = {
  id: generateId(),
  model: 'custom-image:mock',
  inputHash: 'a'.repeat(64),
};
const stored: StoredChannelGeneration = {
  stored: [{ url: '/r2/mock/image.png', path: 'mock/image.png' }],
  via: 'compatible',
  metadata: {
    prompt: 'Mock prompt',
    model: 'custom-image:mock',
    endpointId: 'mock-image',
    dimensions: [{ width: 512, height: 512 }],
    file_sizes: [100],
    cost: micros(20_000),
    usedOwnKey: false,
  },
};

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  await db.delete(appMetadata);
});

describe('configured image attempt persistence', () => {
  it('allows exactly one submission for a stable request', async () => {
    const attempts = createImageGenerationAttemptsMethods(db, organizationId);
    const first = await attempts.claim(identity);
    const second = await attempts.claim(identity);
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.attempt.status).toBe('submitted');
  });

  it('recovers stored metadata after a step loses its checkpoint', async () => {
    const attempts = createImageGenerationAttemptsMethods(db, organizationId);
    await attempts.claim(identity);
    await attempts.complete(identity, stored);
    const recovered = await attempts.claim(identity);
    expect(recovered.claimed).toBe(false);
    expect(recovered.attempt.status).toBe('stored');
    expect(recovered.attempt.result).toEqual(stored);
  });

  it('retries completion idempotently but refuses a different stored result', async () => {
    const attempts = createImageGenerationAttemptsMethods(db, organizationId);
    await attempts.claim(identity);
    await attempts.complete(identity, stored);
    await expect(attempts.complete(identity, stored)).resolves.toBeUndefined();
    const changed = {
      ...stored,
      stored: [{ url: '/r2/other.png', path: 'other.png' }],
    };
    await expect(attempts.complete(identity, changed)).rejects.toThrow(
      'state changed'
    );
  });

  it('reads only this organization and the exact attempt identity', async () => {
    const attempts = createImageGenerationAttemptsMethods(db, organizationId);
    await expect(attempts.getById(identity)).resolves.toBeUndefined();
    await attempts.claim(identity);
    expect((await attempts.getById(identity))?.status).toBe('submitted');
    await expect(
      attempts.getById({ ...identity, inputHash: 'b'.repeat(64) })
    ).rejects.toThrow('different request');
    await expect(
      createImageGenerationAttemptsMethods(db, generateId()).getById(identity)
    ).resolves.toBeUndefined();
  });

  it('keeps unknown results from being submitted again', async () => {
    const attempts = createImageGenerationAttemptsMethods(db, organizationId);
    await attempts.claim(identity);
    await attempts.markUnknown(identity);
    expect((await attempts.claim(identity)).attempt.status).toBe('unknown');
    await expect(attempts.complete(identity, stored)).rejects.toThrow(
      'state changed'
    );
  });

  it('separates organizations and rejects an id reused for a different input', async () => {
    const attempts = createImageGenerationAttemptsMethods(db, organizationId);
    await attempts.claim(identity);
    const other = createImageGenerationAttemptsMethods(db, generateId());
    expect((await other.claim(identity)).claimed).toBe(true);
    await expect(
      attempts.claim({ ...identity, inputHash: 'b'.repeat(64) })
    ).rejects.toThrow('different request');
  });
});
