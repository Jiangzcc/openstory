import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import type { WorkflowEvent } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { AnalyzeScriptWorkflowInput } from '@/platform/server/workflow/types';
import type { StyleConfig } from '@/look/style-config';
import {
  organization,
  sequences,
  styles,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';
import { createSequenceMethods, createSequencesMethods } from '../db/sequences';

const ROOT_RUN = 'synthetic-storyboard-root-A';
const CHILD_RUN = 'synthetic-analyze-child-A';
const RAW_CLAIM = 'synthetic-storyboard-claim-A';
const NEW_ROOT_RUN = 'synthetic-storyboard-root-B';
const NEW_RAW_CLAIM = 'synthetic-storyboard-claim-B';
const RESERVATION_ID = 'synthetic-analysis-reservation';
const FAILURE_MESSAGE = 'Synthetic analysis failure';
const PRIOR_ERROR = 'Synthetic existing terminal error';
const SQL_FAILURE = 'Synthetic analysis status SQL failure';
const SQL_FAILURE_TRIGGER = 'synthetic_analyze_failure_status';
const STATUS = {
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
} as const;
const STORYBOARD_OWNER = {
  workflowRunId: ROOT_RUN,
  workflowClaimId: RAW_CLAIM,
};
const PARENT_HINT = {
  bindingName: 'STORYBOARD_WORKFLOW',
  parentInstanceId: ROOT_RUN,
  eventType: 'synthetic-analyze-done',
} satisfies NonNullable<AnalyzeScriptWorkflowInput['_parent']>;
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

// Only external services are substituted; the guard and sequence writes use real D1 SQL.
const emit = vi.fn(async (_event: string, _payload: unknown) => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
}));
const { AnalyzeScriptWorkflow } = await import('./analyze-script-workflow');

class FailureProbe extends AnalyzeScriptWorkflow {
  invoke(
    event: Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>,
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
  emit.mockResolvedValue(undefined);
  fixture = await seedSequence();
});
afterEach(async () => {
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAILURE_TRIGGER));
});

async function seedOrganization() {
  const organizationId = generateId();
  const actorId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic analysis owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: actorId,
    name: 'Synthetic analysis writer',
    email: actorId + '@example.invalid',
  });
  return { organizationId, actorId };
}

function failureScope(organizationId: string, actorId: string) {
  const methods = createSequencesMethods(db, organizationId, actorId);
  const guard = vi.spyOn(methods, 'failWorkflowIfCurrent');
  const sequenceMethod = vi.fn((id: string) => createSequenceMethods(db, id));
  const zeroReservation = vi.fn(async () => undefined);
  const markKeyInvalid = vi.fn(async () => undefined);
  const scopedDb = asStub<WorkflowScopedDb>({
    organizationId,
    userId: actorId,
    sequences: methods,
    sequence: sequenceMethod,
    billing: { zeroReservation },
    apiKeys: { markKeyInvalid },
  });
  return { methods, guard, sequenceMethod, zeroReservation, scopedDb };
}

async function seedSequence() {
  const identity = await seedOrganization();
  const [style] = await db
    .insert(styles)
    .values({
      organizationId: identity.organizationId,
      name: 'Synthetic analysis style',
      config: STYLE_CONFIG,
    })
    .returning();
  if (!style) throw new Error('Missing synthetic style');
  const scope = failureScope(identity.organizationId, identity.actorId);
  const sequence = await scope.methods.create({
    title: 'Synthetic analysis sequence',
    styleId: style.id,
    generationStopAt: 'script',
  });
  await db
    .update(sequences)
    .set({ status: STATUS.processing, workflowRunId: ROOT_RUN })
    .where(eq(sequences.id, sequence.id));
  return { ...identity, ...scope, sequence };
}

function workflow() {
  type Args = ConstructorParameters<typeof FailureProbe>;
  return new FailureProbe(asStub<Args[0]>(undefined), asStub<Args[1]>({}));
}

function eventFor(
  extras: Partial<AnalyzeScriptWorkflowInput> = {},
  scope = fixture
): Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>> {
  // Synthetic failure-only event; no generation or provider call is executed.
  return asStub<Readonly<WorkflowEvent<AnalyzeScriptWorkflowInput>>>({
    instanceId: CHILD_RUN,
    payload: {
      promptLocale: 'en',
      organizationId: scope.organizationId,
      userId: scope.actorId,
      sequenceId: scope.sequence.id,
      reservationId: RESERVATION_ID,
      storyboardOwner: STORYBOARD_OWNER,
      _parent: PARENT_HINT,
      ...extras,
    },
  });
}

type SequenceState = Partial<
  Pick<
    typeof sequences.$inferSelect,
    'status' | 'statusError' | 'workflowRunId'
  >
>;

async function setSequence(values: SequenceState) {
  await db
    .update(sequences)
    .set(values)
    .where(eq(sequences.id, fixture.sequence.id));
}

async function storedSequence(id = fixture.sequence.id) {
  const [row] = await db.select().from(sequences).where(eq(sequences.id, id));
  if (!row) throw new Error('Missing synthetic sequence');
  return row;
}

async function expectRejectedFailure(event: ReturnType<typeof eventFor>) {
  const before = await storedSequence();
  await workflow().invoke(event, fixture.scopedDb);
  expect(await storedSequence()).toEqual(before);
  expect(fixture.guard).toHaveBeenCalledOnce();
  expect(fixture.sequenceMethod).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(fixture.zeroReservation).toHaveBeenCalledExactlyOnceWith(
    RESERVATION_ID
  );
}

test('uses the Storyboard root and raw claim rather than the child instance id', async () => {
  await workflow().invoke(eventFor(), fixture.scopedDb);
  expect(fixture.guard).toHaveBeenCalledExactlyOnceWith({
    id: fixture.sequence.id,
    ...STORYBOARD_OWNER,
    error: FAILURE_MESSAGE,
  });
  expect(await storedSequence()).toMatchObject({
    status: STATUS.failed,
    statusError: FAILURE_MESSAGE,
    workflowRunId: ROOT_RUN,
  });
  expect(fixture.sequenceMethod).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
    message: FAILURE_MESSAGE,
  });
});

test('recognizes the raw claim before the launcher publishes its root instance id', async () => {
  await setSequence({ workflowRunId: RAW_CLAIM });
  await workflow().invoke(eventFor(), fixture.scopedDb);
  expect(await storedSequence()).toMatchObject({
    workflowRunId: RAW_CLAIM,
    status: STATUS.failed,
    statusError: FAILURE_MESSAGE,
  });
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
    message: FAILURE_MESSAGE,
  });
});

test('uses the explicit server owner even when the notify parent is different', async () => {
  await workflow().invoke(
    eventFor({
      _parent: { ...PARENT_HINT, parentInstanceId: NEW_ROOT_RUN },
    }),
    fixture.scopedDb
  );
  expect(fixture.guard).toHaveBeenCalledExactlyOnceWith({
    id: fixture.sequence.id,
    ...STORYBOARD_OWNER,
    error: FAILURE_MESSAGE,
  });
  expect((await storedSequence()).status).toBe(STATUS.failed);
});

test('does not accept a slot owned only by the AnalyzeScript child id', async () => {
  await setSequence({ workflowRunId: CHILD_RUN });
  await expectRejectedFailure(eventFor());
});

test.each([NEW_ROOT_RUN, NEW_RAW_CLAIM])(
  'preserves a newer owner %s and suppresses the stale failure event',
  async (workflowRunId) => {
    await setSequence({ workflowRunId });
    await expectRejectedFailure(eventFor());
  }
);

test.each([STATUS.completed, STATUS.failed])(
  'preserves the existing %s terminal state and error',
  async (status) => {
    await setSequence({ status, statusError: PRIOR_ERROR });
    await expectRejectedFailure(eventFor());
  }
);

test.each([ROOT_RUN, RAW_CLAIM])(
  'refuses a matching owner %s through another organization scope',
  async (workflowRunId) => {
    await setSequence({ workflowRunId });
    const other = await seedSequence();
    const before = await storedSequence();
    const otherBefore = await storedSequence(other.sequence.id);
    await workflow().invoke(
      eventFor(
        {
          sequenceId: fixture.sequence.id,
        },
        other
      ),
      other.scopedDb
    );
    expect(await storedSequence()).toEqual(before);
    expect(await storedSequence(other.sequence.id)).toEqual(otherBefore);
    expect(other.guard).toHaveBeenCalledOnce();
    expect(other.sequenceMethod).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(other.zeroReservation).toHaveBeenCalledExactlyOnceWith(
      RESERVATION_ID
    );
  }
);

test('a legacy Storyboard child guards its real parent without inventing a raw claim', async () => {
  await workflow().invoke(
    eventFor({ storyboardOwner: undefined }),
    fixture.scopedDb
  );
  expect(fixture.guard).toHaveBeenCalledExactlyOnceWith({
    id: fixture.sequence.id,
    workflowRunId: ROOT_RUN,
    error: FAILURE_MESSAGE,
  });
  expect((await storedSequence()).status).toBe(STATUS.failed);
  expect(fixture.sequenceMethod).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledOnce();
});

test('a legacy child cannot claim the unpublished raw slot without a snapshot', async () => {
  await setSequence({ workflowRunId: RAW_CLAIM });
  await expectRejectedFailure(eventFor({ storyboardOwner: undefined }));
});

test('an unknown parent without an owner skips terminal writes and failure events', async () => {
  const before = await storedSequence();
  await workflow().invoke(
    eventFor({
      storyboardOwner: undefined,
      _parent: { ...PARENT_HINT, bindingName: 'MOTION_BATCH_WORKFLOW' },
    }),
    fixture.scopedDb
  );
  expect(await storedSequence()).toEqual(before);
  expect(fixture.guard).not.toHaveBeenCalled();
  expect(fixture.sequenceMethod).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(fixture.zeroReservation).toHaveBeenCalledExactlyOnceWith(
    RESERVATION_ID
  );
});

test('preserves standalone CLI failure behavior without proving concurrent ownership', async () => {
  await workflow().invoke(
    eventFor({
      storyboardOwner: undefined,
      _parent: undefined,
    }),
    fixture.scopedDb
  );
  expect(fixture.guard).not.toHaveBeenCalled();
  expect(fixture.sequenceMethod).toHaveBeenCalledExactlyOnceWith(
    fixture.sequence.id
  );
  expect(await storedSequence()).toMatchObject({
    status: STATUS.failed,
    statusError: FAILURE_MESSAGE,
  });
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
    message: FAILURE_MESSAGE,
  });
});

test('an event without a sequence still releases its reservation', async () => {
  await workflow().invoke(
    eventFor({ sequenceId: undefined }),
    fixture.scopedDb
  );
  expect(fixture.guard).not.toHaveBeenCalled();
  expect(fixture.sequenceMethod).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(fixture.zeroReservation).toHaveBeenCalledExactlyOnceWith(
    RESERVATION_ID
  );
});

test('does not adopt a sequence whose owner slot is empty', async () => {
  await setSequence({ workflowRunId: null });
  await expectRejectedFailure(eventFor());
});

test('does not fall back to an unconditional write for a missing sequence', async () => {
  await expectRejectedFailure(eventFor({ sequenceId: generateId() }));
});

test('propagates a real SQL guard failure after attempting the notification', async () => {
  await db.run(
    sql.raw(
      'CREATE TRIGGER ' +
        SQL_FAILURE_TRIGGER +
        " BEFORE UPDATE OF status ON sequences WHEN NEW.status = '" +
        STATUS.failed +
        "' BEGIN SELECT RAISE(ABORT, '" +
        SQL_FAILURE +
        "'); END"
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
  await expect(operation).rejects.toThrow(SQL_FAILURE);
  expect(await storedSequence()).toEqual(before);
  expect(fixture.guard).toHaveBeenCalledOnce();
  expect(fixture.sequenceMethod).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.failed', {
    message: FAILURE_MESSAGE,
  });
});
