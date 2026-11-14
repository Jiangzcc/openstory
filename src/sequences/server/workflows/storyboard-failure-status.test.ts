import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import type { StyleConfig } from '@/look/style-config';
import {
  organization,
  sequences,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from '../db/sequences';

const RUN_A = 'synthetic-storyboard-instance-A';
const RUN_B = 'synthetic-storyboard-instance-B';
const CLAIM_A = 'synthetic-storyboard-claim-A';
const FAILURE_MESSAGE = 'Synthetic storyboard parent failure';
const CHILD_FAILURE = 'Synthetic specific child failure';
const WRITE_FAILURE = 'Synthetic storyboard status write failure';
const STYLE_CONFIG: StyleConfig = {
  version: 2,
  look: {
    mood: 'neutral',
    artStyle: 'cinematic',
    lighting: 'natural',
    colorPalette: ['#000', '#fff'],
    colorGrading: 'neutral',
  },
  motion: { camera: 'static' },
  references: [],
};

const emit = vi.fn(async (_event: string, _payload: unknown) => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));
const { StoryboardWorkflow } = await import('./storyboard-workflow');

class FailureProbe extends StoryboardWorkflow {
  invoke(
    event: Readonly<WorkflowEvent<StoryboardWorkflowInput>>,
    scopedDb: WorkflowScopedDb
  ) {
    return this.onFailure({ event, error: FAILURE_MESSAGE, scopedDb });
  }
}

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedSequence>>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
beforeEach(async () => {
  emit.mockReset();
  fixture = await seedSequence();
});
afterEach(
  async () =>
    await db.run(
      sql.raw('DROP TRIGGER IF EXISTS synthetic_storyboard_status_failure')
    )
);

async function seedSequence() {
  const organizationId = generateId();
  const actorId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Storyboard owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Storyboard writer',
    email: actorId + '@example.invalid',
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Storyboard test', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Missing test style');
  const methods = createSequencesMethods(db, organizationId, actorId);
  const sequence = await methods.create({
    title: 'Storyboard test',
    styleId: style.id,
    generationStopAt: 'images',
  });
  await db
    .update(sequences)
    .set({ status: 'processing', workflowRunId: RUN_A })
    .where(eq(sequences.id, sequence.id));
  const captured = await methods.getForUser({ sequenceId: sequence.id });
  // This host-side read substitute holds the real pre-interleaving DB result.
  const getForUser = vi.fn(async () => captured);
  const scopedDb = asStub<WorkflowScopedDb>({
    organizationId,
    userId: actorId,
    models: DEFAULT_MODEL_CONFIGURATION,
    sequences: methods,
    sequence: (id: string) => createSequenceMethods(db, id),
    liveRead: { sequences: { getForUser } },
    billing: { zeroReservation: vi.fn(async () => undefined) },
  });
  return { sequence, organizationId, actorId, methods, getForUser, scopedDb };
}

function eventFor(
  includeClaim = true
): Readonly<WorkflowEvent<StoryboardWorkflowInput>> {
  // The failure hook only reads identity and reservation fields from this event stub.
  return asStub<Readonly<WorkflowEvent<StoryboardWorkflowInput>>>({
    instanceId: RUN_A,
    payload: {
      sequenceId: fixture.sequence.id,
      organizationId: fixture.organizationId,
      userId: fixture.actorId,
      promptLocale: 'en',
      ...(includeClaim ? { workflowClaimId: CLAIM_A } : {}),
    },
  });
}

function workflow() {
  type Args = ConstructorParameters<typeof FailureProbe>;
  return new FailureProbe(asStub<Args[0]>(undefined), asStub<Args[1]>({}));
}

async function storedSequence() {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, fixture.sequence.id));
  if (!row) throw new Error('Missing test sequence');
  return row;
}

describe('Storyboard failure status with real database writes', () => {
  it.each(['completed', 'failed'] as const)(
    'preserves %s committed after the old status read',
    async (status) => {
      await db
        .update(sequences)
        .set({
          status,
          statusError: status === 'failed' ? CHILD_FAILURE : null,
        })
        .where(eq(sequences.id, fixture.sequence.id));
      const before = await storedSequence();

      await workflow().invoke(eventFor(), fixture.scopedDb);

      expect(await storedSequence()).toEqual(before);
      expect(emit).not.toHaveBeenCalled();
    }
  );

  it('preserves a newer run claimed after the old status read', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: RUN_B })
      .where(eq(sequences.id, fixture.sequence.id));
    const before = await storedSequence();

    await workflow().invoke(eventFor(), fixture.scopedDb);

    expect(await storedSequence()).toEqual(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects the old failure even when a fresh read would see the newer run', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: RUN_B })
      .where(eq(sequences.id, fixture.sequence.id));
    fixture.getForUser.mockResolvedValue(
      await fixture.methods.getForUser({ sequenceId: fixture.sequence.id })
    );
    const before = await storedSequence();

    await workflow().invoke(eventFor(), fixture.scopedDb);

    expect(await storedSequence()).toEqual(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it('fails its current run without reading mutable status first', async () => {
    await workflow().invoke(eventFor(), fixture.scopedDb);

    expect(await storedSequence()).toMatchObject({
      status: 'failed',
      statusError: FAILURE_MESSAGE,
      workflowRunId: RUN_A,
    });
    expect(fixture.getForUser).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      message: FAILURE_MESSAGE,
    });
  });

  it('recognizes its snapshotted claim before the launcher persists the instance id', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: CLAIM_A })
      .where(eq(sequences.id, fixture.sequence.id));

    await workflow().invoke(eventFor(), fixture.scopedDb);

    expect(await storedSequence()).toMatchObject({
      status: 'failed',
      statusError: FAILURE_MESSAGE,
      workflowRunId: CLAIM_A,
    });
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      message: FAILURE_MESSAGE,
    });
  });

  it('accepts the actual instance id when an older payload has no claim snapshot', async () => {
    await workflow().invoke(eventFor(false), fixture.scopedDb);

    expect(await storedSequence()).toMatchObject({
      status: 'failed',
      statusError: FAILURE_MESSAGE,
    });
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      message: FAILURE_MESSAGE,
    });
  });

  it('does not guess ownership of another claim for an older payload', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: CLAIM_A })
      .where(eq(sequences.id, fixture.sequence.id));
    const before = await storedSequence();

    await workflow().invoke(eventFor(false), fixture.scopedDb);

    expect(await storedSequence()).toEqual(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it('propagates a synthetic SQL write failure after attempting the existing failure notification', async () => {
    await db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_storyboard_status_failure BEFORE UPDATE OF status ON sequences WHEN NEW.status = 'failed' BEGIN SELECT RAISE(ABORT, 'Synthetic storyboard status write failure'); END"
      )
    );
    const before = await storedSequence();
    const operation = workflow()
      .invoke(eventFor(), fixture.scopedDb)
      .catch((error: unknown) => {
        throw error instanceof Error && error.cause instanceof Error
          ? error.cause
          : error;
      });

    await expect(operation).rejects.toThrow(WRITE_FAILURE);
    expect(await storedSequence()).toEqual(before);
    expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
      message: FAILURE_MESSAGE,
    });
  });
});

describe('Storyboard failure guard database boundaries', () => {
  it('updates its current instance once and preserves the first failure on replay', async () => {
    const input = {
      id: fixture.sequence.id,
      workflowRunId: RUN_A,
      error: CHILD_FAILURE,
    };
    expect(await fixture.methods.failWorkflowIfCurrent(input)).toBe(true);
    const failed = await storedSequence();

    expect(
      await fixture.methods.failWorkflowIfCurrent({
        ...input,
        error: FAILURE_MESSAGE,
      })
    ).toBe(false);
    expect(await storedSequence()).toEqual(failed);
    expect(failed).toMatchObject({
      status: 'failed',
      statusError: CHILD_FAILURE,
      workflowRunId: RUN_A,
    });
  });

  it.each(['completed', 'failed'] as const)(
    'refuses a terminal %s even when the raw claim still matches',
    async (status) => {
      await db
        .update(sequences)
        .set({ workflowRunId: CLAIM_A, status, statusError: CHILD_FAILURE })
        .where(eq(sequences.id, fixture.sequence.id));
      const before = await storedSequence();

      expect(
        await fixture.methods.failWorkflowIfCurrent({
          id: fixture.sequence.id,
          workflowRunId: RUN_A,
          workflowClaimId: CLAIM_A,
          error: FAILURE_MESSAGE,
        })
      ).toBe(false);
      expect(await storedSequence()).toEqual(before);
    }
  );

  it('refuses a sequence with no workflow owner', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: null })
      .where(eq(sequences.id, fixture.sequence.id));
    const before = await storedSequence();

    expect(
      await fixture.methods.failWorkflowIfCurrent({
        id: fixture.sequence.id,
        workflowRunId: RUN_A,
        workflowClaimId: CLAIM_A,
        error: FAILURE_MESSAGE,
      })
    ).toBe(false);
    expect(await storedSequence()).toEqual(before);
  });

  it('refuses a missing sequence without changing another sequence', async () => {
    const before = await storedSequence();

    expect(
      await fixture.methods.failWorkflowIfCurrent({
        id: generateId(),
        workflowRunId: RUN_A,
        workflowClaimId: CLAIM_A,
        error: FAILURE_MESSAGE,
      })
    ).toBe(false);
    expect(await storedSequence()).toEqual(before);
  });

  it.each([RUN_A, CLAIM_A])(
    'refuses a matching owner %s from another organization',
    async (owner) => {
      const other = await seedSequence();
      await db
        .update(sequences)
        .set({ workflowRunId: owner })
        .where(eq(sequences.id, fixture.sequence.id));
      const before = await storedSequence();

      expect(
        await other.methods.failWorkflowIfCurrent({
          id: fixture.sequence.id,
          workflowRunId: RUN_A,
          workflowClaimId: CLAIM_A,
          error: FAILURE_MESSAGE,
        })
      ).toBe(false);
      expect(await storedSequence()).toEqual(before);
    }
  );
});
