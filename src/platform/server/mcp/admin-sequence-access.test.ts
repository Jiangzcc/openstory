/**
 * #2288: a system admin's `osk_` key can open another organisation's
 * sequence. Anyone else, including that admin on an OAuth token, cannot.
 */
import { createTestDb } from '@/platform/server/db/test-d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
// oxlint-disable-next-line boundaries/no-raw-db -- substitute the isolated in-memory DB at the factory boundary
import { getDb } from '#db-client';
import type { Database } from '@/platform/server/db/client';
import * as scopedDbModule from '@/platform/server/db/scoped';
import { getSequenceByIdUnscoped } from '@/platform/server/db/scoped';
// oxlint-disable-next-line boundaries/no-scoped-factory -- exercise real organization-scoped repositories
import { createScopedDb } from '@/platform/server/db/scoped';
import { generateId } from '@/platform/id';
import { organization, sequences, styles } from '@/platform/server/db/schema';
import { productionAccess } from '@/sequences/server/production-access';
import { asStub } from '@/test/as-stub';
import {
  adoptForeignSequence,
  adminSequenceAccessFor,
  openstoryTool,
  type ReadToolContext,
} from './tool-context';

vi.mock('#db-client', () => ({ getDb: vi.fn() }));

const ADMIN = 'admin@openstory.dev';

function context(
  scopedDb: ReturnType<typeof createScopedDb>,
  access: ReadToolContext['adminSequenceAccess']
): ReadToolContext {
  return {
    promptLocale: 'en',
    scopedDb,
    origin: 'http://localhost',
    userId: 'user_admin',
    request: { ipAddress: null, userAgent: null },
    adminSequenceAccess: access,
  };
}

function contextProbe(
  scope: 'sequences:read' | 'sequences:write' | 'generate'
) {
  return openstoryTool({
    name: `admin_scope_probe_${scope.replaceAll(':', '_')}`,
    description: 'Inspect the adopted context without starting work.',
    scope,
    annotations: {
      readOnlyHint: scope === 'sequences:read',
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: z.object({ sequenceId: z.string() }),
    outputSchema: z.object({
      title: z.string(),
      organizationId: z.string(),
      userId: z.string(),
      promptLocale: z.string(),
    }),
    run: async (input, adopted) => {
      const sequence = await productionAccess(adopted.scopedDb).sequence(
        input.sequenceId
      );
      return {
        data: {
          title: sequence.title,
          organizationId: adopted.scopedDb.organizationId,
          userId: adopted.userId,
          promptLocale: adopted.promptLocale,
        },
        summary: 'Inspected the adopted context.',
      };
    },
  });
}

describe('admin sequence access', () => {
  let closeDb: () => Promise<void>;
  let db: Database;
  let homeId: string;
  let otherId: string;
  let foreignSequenceId: string;

  beforeAll(async () => {
    ({ db, close: closeDb } = await createTestDb());
    vi.mocked(getDb).mockReturnValue(db);
    vi.stubEnv('ADMIN_EMAILS', ADMIN);
    homeId = generateId();
    otherId = generateId();
    foreignSequenceId = generateId();
    await db.insert(organization).values([
      { id: homeId, name: 'Home', slug: homeId },
      { id: otherId, name: 'Other', slug: otherId },
    ]);
    const styleId = generateId();
    await db.insert(styles).values({
      id: styleId,
      organizationId: otherId,
      name: 'Noir',
      config: {
        mood: 'neutral',
        artStyle: 'cinematic',
        lighting: 'natural',
        colorPalette: ['#000'],
        cameraWork: 'static',
        referenceFilms: [],
        colorGrading: 'neutral',
      },
    });
    await db.insert(sequences).values({
      id: foreignSequenceId,
      organizationId: otherId,
      title: 'Theirs',
      styleId,
      status: 'completed',
      generateStartFrames: true,
    });
  });

  afterAll(async () => {
    await closeDb();
    vi.unstubAllEnvs();
  });

  it('requires the api_key auth kind and a system admin email', () => {
    const openOrganization = vi.fn();
    expect(
      adminSequenceAccessFor({
        kind: 'api_key',
        email: ADMIN,
        openOrganization,
      })
    ).toBe(openOrganization);
    expect(
      adminSequenceAccessFor({
        kind: 'oauth',
        email: ADMIN,
        openOrganization,
      })
    ).toBeUndefined();
    expect(
      adminSequenceAccessFor({
        kind: 'session',
        email: ADMIN,
        openOrganization,
      })
    ).toBeUndefined();
    expect(
      adminSequenceAccessFor({
        kind: 'api_key',
        email: 'member@example.com',
        openOrganization,
      })
    ).toBeUndefined();
  });

  it('leaves a non-admin on not found and does not read unscoped', async () => {
    const spy = vi.spyOn(scopedDbModule, 'getSequenceByIdUnscoped');
    const ctx = context(createScopedDb(homeId, 'user_member'), undefined);
    await adoptForeignSequence(ctx, { sequenceId: foreignSequenceId });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await expect(
      productionAccess(ctx.scopedDb).sequence(foreignSequenceId)
    ).rejects.toThrow('Sequence not found.');
    expect(ctx.scopedDb.organizationId).toBe(homeId);
  });

  it.each(['oauth', 'session'] as const)(
    'keeps a system admin using %s in the original organisation',
    async (kind) => {
      const unscopedRead = vi.spyOn(scopedDbModule, 'getSequenceByIdUnscoped');
      const openOrganization = vi.fn();
      const scopedDb = createScopedDb(homeId, 'user_admin');
      const ctx = context(
        scopedDb,
        adminSequenceAccessFor({ kind, email: ADMIN, openOrganization })
      );

      await adoptForeignSequence(ctx, { sequenceId: foreignSequenceId });

      expect(openOrganization).not.toHaveBeenCalled();
      expect(unscopedRead).not.toHaveBeenCalled();
      unscopedRead.mockRestore();
      expect(ctx.scopedDb).toBe(scopedDb);
      await expect(
        productionAccess(ctx.scopedDb).sequence(foreignSequenceId)
      ).rejects.toThrow('Sequence not found.');
    }
  );

  it('rebinds an admin api key onto the owning organisation', async () => {
    const ctx = context(
      createScopedDb(homeId, 'user_admin'),
      (organizationId) => createScopedDb(organizationId, 'user_admin')
    );
    await adoptForeignSequence(ctx, { sequenceId: foreignSequenceId });
    expect(ctx.scopedDb.organizationId).toBe(otherId);
    const sequence = await productionAccess(ctx.scopedDb).sequence(
      foreignSequenceId
    );
    expect(sequence.title).toBe('Theirs');
    expect(await getSequenceByIdUnscoped(foreignSequenceId)).toMatchObject({
      organizationId: otherId,
    });
  });

  it('does not rebind when the sequence is already in the key organisation', async () => {
    const unscopedRead = vi.spyOn(scopedDbModule, 'getSequenceByIdUnscoped');
    const openOrganization = vi.fn();
    const ctx = context(
      createScopedDb(otherId, 'user_admin'),
      openOrganization
    );
    await adoptForeignSequence(ctx, { sequenceId: foreignSequenceId });
    expect(openOrganization).not.toHaveBeenCalled();
    expect(unscopedRead).not.toHaveBeenCalled();
    unscopedRead.mockRestore();
    expect(ctx.scopedDb.organizationId).toBe(otherId);
  });

  it('keeps the original scope when the sequence does not exist', async () => {
    const scopedDb = createScopedDb(homeId, 'user_admin');
    const openOrganization = vi.fn();
    const ctx = context(scopedDb, openOrganization);
    const sequenceId = generateId();

    await adoptForeignSequence(ctx, { sequenceId });

    expect(openOrganization).not.toHaveBeenCalled();
    expect(ctx.scopedDb).toBe(scopedDb);
    await expect(
      productionAccess(ctx.scopedDb).sequence(sequenceId)
    ).rejects.toThrow('Sequence not found.');
  });

  it('retains the caller identity, request and prompt language after rebinding', async () => {
    const ctx = context(
      createScopedDb(homeId, 'user_admin'),
      (organizationId) => createScopedDb(organizationId, 'user_admin')
    );
    ctx.promptLocale = 'zh-CN';
    const request = ctx.request;

    await adoptForeignSequence(ctx, { sequenceId: foreignSequenceId });

    expect(ctx.scopedDb.organizationId).toBe(otherId);
    expect(ctx.userId).toBe('user_admin');
    expect(ctx.promptLocale).toBe('zh-CN');
    expect(ctx.origin).toBe('http://localhost');
    expect(ctx.request).toBe(request);
  });

  it.each(['sequences:read', 'sequences:write', 'generate'] as const)(
    'adopts the sequence organisation before a %s tool executes',
    async (scope) => {
      const openOrganization = vi.fn((organizationId: string) =>
        createScopedDb(organizationId, 'user_admin')
      );
      const ctx = context(
        createScopedDb(homeId, 'user_admin'),
        openOrganization
      );
      const probe = contextProbe(scope);
      if (!probe.execute) throw new Error('Probe has no execute handler');

      const result = await probe.execute(
        { sequenceId: foreignSequenceId },
        asStub({ context: { scoped: () => ctx } })
      );

      expect(result).toMatchObject({
        structuredContent: {
          title: 'Theirs',
          organizationId: otherId,
          userId: 'user_admin',
          promptLocale: 'en',
        },
      });
      expect(openOrganization).toHaveBeenCalledExactlyOnceWith(otherId);
    }
  );
});
