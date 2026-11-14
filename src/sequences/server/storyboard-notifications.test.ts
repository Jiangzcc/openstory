import { and, eq, sql } from 'drizzle-orm';
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
import type { Database } from '@/platform/server/db/client';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import {
  organization,
  sequences,
  sequenceEvents,
  storyboardNotifications,
  styles,
  user,
} from '@/platform/server/db/schema';
import type { StoryboardNotification } from '@/sequences/storyboard-notification';
import { createSequencesMethods } from './db/sequences';
import { createStoryboardNotificationMethods } from './db/storyboard-notifications';

// Only realtime delivery is substituted; state, receipts, transactions and reconciliation use migrated D1.
const emit = vi.fn(
  async (_event: string, _data: unknown, _options?: unknown) => undefined
);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
}));
const { deliverStoryboardNotification } =
  await import('./storyboard-notifications');
const { reconcileStoryboardNotifications } =
  await import('./reconcile-storyboard-notifications');
const [template] = DEFAULT_STYLE_TEMPLATES;
if (!template) throw new Error('Synthetic test needs a style template');
const STYLE_CONFIG = template.config;
const STATUS = {
  processing: 'processing',
  failed: 'failed',
  completed: 'completed',
} as const;
const SQL_FAULT = 'synthetic_notification_fault';
const FAILURE_MESSAGE = 'Synthetic storyboard failure';
const DELIVERY_FAILURE = new Error('Synthetic realtime delivery failure');
let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedOwner>>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  emit.mockReset().mockResolvedValue(undefined);
  await db.delete(storyboardNotifications);
  fixture = await seedOwner();
});
afterEach(async () => {
  await db.run(sql.raw('DROP TRIGGER IF EXISTS ' + SQL_FAULT));
  vi.restoreAllMocks();
});

async function seedOwner() {
  const organizationId = generateId();
  const userId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic owner',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic writer',
    email: userId + '@example.invalid',
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Synthetic style', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Expected a style');
  const methods = createSequencesMethods(db, organizationId, userId);
  const sequence = await methods.create({
    title: 'Synthetic board',
    styleId: style.id,
    generationStopAt: 'motion',
  });
  const owner = {
    id: sequence.id,
    workflowRunId: 'synthetic-run-' + generateId(),
    workflowClaimId: 'synthetic-claim-' + generateId(),
  };
  await db
    .update(sequences)
    .set({ status: STATUS.processing, workflowRunId: owner.workflowRunId })
    .where(eq(sequences.id, sequence.id));
  return { organizationId, userId, sequence, methods, owner };
}

function failedNotification(
  owner = fixture.owner
): Extract<StoryboardNotification, { event: 'generation.failed' }> {
  const { id: _id, ...workflowOwner } = owner;
  return {
    event: 'generation.failed',
    data: { workflowOwner, message: FAILURE_MESSAGE },
  };
}

function queueFailure(owner = fixture) {
  return owner.methods.failWorkflowIfCurrent({
    ...owner.owner,
    error: FAILURE_MESSAGE,
    notification: failedNotification(owner.owner),
  });
}

async function receipts(owner = fixture) {
  return db
    .select()
    .from(storyboardNotifications)
    .where(eq(storyboardNotifications.sequenceId, owner.sequence.id));
}

async function seedParentOnlyOwner() {
  // Parent-only rows isolate this outbox from pre-existing restrict-on-delete style history.
  const organizationId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic empty organization',
    slug: organizationId,
  });
  const [style] = await db
    .insert(styles)
    .values({ organizationId, name: 'Synthetic style', config: STYLE_CONFIG })
    .returning();
  if (!style) throw new Error('Expected an orphan-test style');
  const owner = { id: generateId(), workflowRunId: 'synthetic-orphan-run' };
  await db.insert(sequences).values({
    id: owner.id,
    organizationId,
    title: 'Synthetic parent-only sequence',
    styleId: style.id,
    status: STATUS.processing,
    workflowRunId: owner.workflowRunId,
  });
  return { organizationId, owner };
}

async function stored(owner = fixture) {
  const [row] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, owner.sequence.id));
  if (!row) throw new Error('Expected a sequence');
  return row;
}

function fault(statement: string) {
  return db.run(sql.raw(statement));
}

describe('Storyboard terminal notification transactions', () => {
  it('persists a failure and its original notification together', async () => {
    expect(await queueFailure()).toBe(true);
    expect(await stored()).toMatchObject({
      status: STATUS.failed,
      statusError: FAILURE_MESSAGE,
    });
    const [receipt] = await receipts();
    expect(receipt).toMatchObject({
      organizationId: fixture.organizationId,
      workflowRunId: fixture.owner.workflowRunId,
      notification: failedNotification(),
      deliveredAt: null,
    });
    expect(receipt?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('does not commit a terminal state when notification insertion fails', async () => {
    await fault(
      "CREATE TRIGGER synthetic_notification_fault BEFORE INSERT ON storyboard_notifications BEGIN SELECT RAISE(ABORT, 'Synthetic notification insert failure'); END"
    );
    const before = await stored();
    await expect(queueFailure()).rejects.toThrow();
    expect(await stored()).toEqual(before);
    expect(await receipts()).toEqual([]);
  });

  it('rolls back the notification if the subsequent status write fails', async () => {
    await fault(
      "CREATE TRIGGER synthetic_notification_fault BEFORE UPDATE OF status ON sequences WHEN NEW.status = 'failed' BEGIN SELECT RAISE(ABORT, 'Synthetic status failure'); END"
    );
    const before = await stored();
    await expect(queueFailure()).rejects.toThrow();
    expect(await stored()).toEqual(before);
    expect(await receipts()).toEqual([]);
  });

  it('recovers a committed failure whose caller lost its result', async () => {
    const write = fixture.methods.failWorkflowIfCurrent;
    const lostReceipt = new Error('Synthetic committed D1 result loss');
    vi.spyOn(fixture.methods, 'failWorkflowIfCurrent').mockImplementationOnce(
      async (input) => {
        await write(input);
        throw lostReceipt;
      }
    );
    await expect(queueFailure()).rejects.toBe(lostReceipt);
    expect((await stored()).status).toBe(STATUS.failed);
    expect(await reconcileStoryboardNotifications(db)).toBe(1);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      'generation.failed',
      failedNotification().data,
      { requireAcknowledgement: true }
    );
    expect((await receipts())[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it('keeps the first shortfall instead of replacing it with a later generic failure', async () => {
    const { id: _id, ...workflowOwner } = fixture.owner;
    const notification: StoryboardNotification = {
      event: 'generation.reservation:short',
      data: { workflowOwner, neededUsd: 3, remainingUsd: 1, sceneCount: 2 },
    };
    expect(
      await fixture.methods.failWorkflowIfCurrent({
        ...fixture.owner,
        error: 'Synthetic shortfall',
        notification,
      })
    ).toBe(true);
    expect(await queueFailure()).toBe(false);
    await deliverStoryboardNotification(fixture.methods, fixture.owner);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      notification.event,
      notification.data,
      { requireAcknowledgement: true }
    );
    expect((await stored()).statusError).toBe('Synthetic shortfall');
    expect(await receipts()).toHaveLength(1);
  });

  it('refuses a notification whose payload belongs to another run', async () => {
    const before = await stored();
    const otherOwner = {
      ...fixture.owner,
      workflowRunId: 'synthetic-other-run',
    };
    await expect(
      fixture.methods.failWorkflowIfCurrent({
        ...fixture.owner,
        error: FAILURE_MESSAGE,
        notification: failedNotification(otherOwner),
      })
    ).rejects.toThrow('does not match');
    expect(await stored()).toEqual(before);
    expect(await receipts()).toEqual([]);
  });

  it('persists completion, history and delivery receipt in one transaction', async () => {
    const eventId = generateId();
    const { id: _id, ...workflowOwner } = fixture.owner;
    const notification: Extract<
      StoryboardNotification,
      { event: 'generation.complete' }
    > = {
      event: 'generation.complete',
      data: { workflowOwner, sequenceId: fixture.sequence.id },
    };
    const input = { ...fixture.owner, eventId, notification };
    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(true);
    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(true);
    expect((await stored()).status).toBe(STATUS.completed);
    expect(await receipts()).toHaveLength(1);
    const events = await db
      .select()
      .from(sequenceEvents)
      .where(
        and(
          eq(sequenceEvents.id, eventId),
          eq(sequenceEvents.kind, 'storyboard.completed')
        )
      );
    expect(events).toHaveLength(1);
    await deliverStoryboardNotification(fixture.methods, fixture.owner);
    expect(await fixture.methods.completeWorkflowIfCurrent(input)).toBe(true);
    expect(
      await deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).toBe(false);
    expect(emit).toHaveBeenCalledOnce();
  });

  it('rolls back completion and its history if receipt insertion fails', async () => {
    await fault(
      "CREATE TRIGGER synthetic_notification_fault BEFORE INSERT ON storyboard_notifications BEGIN SELECT RAISE(ABORT, 'Synthetic completion receipt failure'); END"
    );
    const eventId = generateId();
    const { id: _id, ...workflowOwner } = fixture.owner;
    const before = await stored();
    await expect(
      fixture.methods.completeWorkflowIfCurrent({
        ...fixture.owner,
        eventId,
        notification: {
          event: 'generation.complete',
          data: { workflowOwner, sequenceId: fixture.sequence.id },
        },
      })
    ).rejects.toThrow();
    expect(await stored()).toEqual(before);
    expect(await receipts()).toEqual([]);
    expect(
      await db
        .select()
        .from(sequenceEvents)
        .where(eq(sequenceEvents.id, eventId))
    ).toEqual([]);
  });
});

describe('Storyboard notification acknowledgement and replay', () => {
  it('keeps failed delivery pending and retries the same immutable payload', async () => {
    await queueFailure();
    emit.mockRejectedValueOnce(DELIVERY_FAILURE);
    await expect(
      deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).rejects.toBe(DELIVERY_FAILURE);
    expect((await receipts())[0]?.deliveredAt).toBeNull();
    await deliverStoryboardNotification(fixture.methods, fixture.owner);
    expect(emit.mock.calls[1]).toEqual(emit.mock.calls[0]);
    expect((await receipts())[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(
      await deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).toBe(false);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('allows duplicate acceptance after an unknown external acknowledgement', async () => {
    await queueFailure();
    const accepted: unknown[] = [];
    emit.mockImplementationOnce(async (_event, data) => {
      accepted.push(data);
      throw DELIVERY_FAILURE;
    });
    await expect(
      deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).rejects.toBe(DELIVERY_FAILURE);
    emit.mockImplementationOnce(async (_event, data) => {
      accepted.push(data);
    });
    await deliverStoryboardNotification(fixture.methods, fixture.owner);
    expect(accepted).toHaveLength(2);
    expect(accepted[1]).toEqual(accepted[0]);
    expect((await receipts())[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it('retries delivery if the D1 acknowledgement write did not commit', async () => {
    await queueFailure();
    await fault(
      "CREATE TRIGGER synthetic_notification_fault BEFORE UPDATE OF delivered_at ON storyboard_notifications BEGIN SELECT RAISE(ABORT, 'Synthetic acknowledgement failure'); END"
    );
    await expect(
      deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).rejects.toThrow();
    expect(emit).toHaveBeenCalledOnce();
    expect((await receipts())[0]?.deliveredAt).toBeNull();
    await fault('DROP TRIGGER synthetic_notification_fault');
    await deliverStoryboardNotification(fixture.methods, fixture.owner);
    expect(emit).toHaveBeenCalledTimes(2);
    expect((await receipts())[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it('does not send again when the acknowledgement committed but its result was lost', async () => {
    await queueFailure();
    const confirm = fixture.methods.confirmWorkflowNotificationDelivery;
    const lostReceipt = new Error('Synthetic acknowledgement result loss');
    vi.spyOn(
      fixture.methods,
      'confirmWorkflowNotificationDelivery'
    ).mockImplementationOnce(async (receipt) => {
      await confirm(receipt);
      throw lostReceipt;
    });
    await expect(
      deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).rejects.toBe(lostReceipt);
    expect((await receipts())[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(
      await deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).toBe(false);
    expect(emit).toHaveBeenCalledOnce();
  });

  it('delivers the same receipt across raw-claim publication', async () => {
    await db
      .update(sequences)
      .set({ workflowRunId: fixture.owner.workflowClaimId })
      .where(eq(sequences.id, fixture.sequence.id));
    await queueFailure();
    emit.mockRejectedValueOnce(DELIVERY_FAILURE);
    await expect(
      deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).rejects.toBe(DELIVERY_FAILURE);
    await db
      .update(sequences)
      .set({ workflowRunId: fixture.owner.workflowRunId })
      .where(eq(sequences.id, fixture.sequence.id));
    await deliverStoryboardNotification(fixture.methods, fixture.owner);
    expect(emit.mock.calls[1]).toEqual(emit.mock.calls[0]);
    expect(emit.mock.calls[1]?.[1]).toEqual(failedNotification().data);
  });

  it('refuses a foreign organization at both attempt and acknowledgement writes', async () => {
    await queueFailure();
    const [receipt] = await receipts();
    if (!receipt) throw new Error('Expected a receipt');
    const foreign = createStoryboardNotificationMethods(db, generateId());
    expect(await deliverStoryboardNotification(foreign, fixture.owner)).toBe(
      false
    );
    expect(await foreign.confirmWorkflowNotificationDelivery(receipt)).toBe(
      false
    );
    expect((await receipts())[0]?.deliveredAt).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not let a late acknowledgement consume a newer run notification', async () => {
    await queueFailure();
    let continueSend: () => void = () => {
      throw new Error('Delivery was not started');
    };
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    emit.mockImplementationOnce(async () => {
      signalStarted();
      await new Promise<void>((resolve) => {
        continueSend = resolve;
      });
    });
    const first = deliverStoryboardNotification(fixture.methods, fixture.owner);
    await started;
    const next = {
      ...fixture,
      owner: {
        ...fixture.owner,
        workflowRunId: 'synthetic-next-run',
        workflowClaimId: 'synthetic-next-claim',
      },
    };
    await db
      .update(sequences)
      .set({
        workflowRunId: next.owner.workflowRunId,
        status: STATUS.processing,
      })
      .where(eq(sequences.id, fixture.sequence.id));
    await queueFailure(next);
    continueSend();
    await first;
    const current = (await receipts()).find(
      (row) => row.workflowRunId === next.owner.workflowRunId
    );
    expect(current?.deliveredAt).toBeNull();
    await deliverStoryboardNotification(fixture.methods, next.owner);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe('Overlapping notification senders', () => {
  it('allows duplicate acceptance while acknowledging only the same immutable receipt', async () => {
    await queueFailure();
    let release: () => void = () => undefined;
    let bothStarted: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    let attempts = 0;
    emit.mockImplementation(async () => {
      attempts++;
      if (attempts === 2) bothStarted();
      await waiting;
    });
    const sends = [
      deliverStoryboardNotification(fixture.methods, fixture.owner),
      deliverStoryboardNotification(fixture.methods, fixture.owner),
    ];
    await started;
    release();
    expect(await Promise.all(sends)).toEqual([true, true]);
    expect(await receipts()).toHaveLength(1);
    expect((await receipts())[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]).toEqual(emit.mock.calls[1]);
    expect(
      await deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).toBe(false);
  });
});

describe('Scheduled notification recovery', () => {
  it('delivers a queued terminal state without another workflow invocation', async () => {
    await queueFailure();
    expect(await reconcileStoryboardNotifications(db)).toBe(1);
    expect(await reconcileStoryboardNotifications(db)).toBe(0);
    expect(emit).toHaveBeenCalledOnce();
  });

  it('rotates failed attempts so one pending row does not starve the next', async () => {
    await queueFailure();
    const second = await seedOwner();
    await queueFailure(second);
    emit.mockRejectedValueOnce(DELIVERY_FAILURE);
    await expect(
      reconcileStoryboardNotifications(db, 1)
    ).rejects.toBeInstanceOf(AggregateError);
    expect(await reconcileStoryboardNotifications(db, 1)).toBe(1);
    expect(emit.mock.calls[1]?.[1]).toEqual(
      failedNotification(second.owner).data
    );
    expect((await receipts())[0]?.deliveredAt).toBeNull();
    expect(await reconcileStoryboardNotifications(db, 1)).toBe(1);
  });

  it('continues other rows when an earlier external delivery fails', async () => {
    await queueFailure();
    const second = await seedOwner();
    await queueFailure(second);
    emit.mockRejectedValueOnce(DELIVERY_FAILURE);
    await expect(reconcileStoryboardNotifications(db)).rejects.toBeInstanceOf(
      AggregateError
    );
    expect(emit).toHaveBeenCalledTimes(2);
    expect((await receipts())[0]?.deliveredAt).toBeNull();
    expect((await receipts(second))[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it('removes a superseded pending event without changing its new owner', async () => {
    await queueFailure();
    await db
      .update(sequences)
      .set({
        status: STATUS.processing,
        workflowRunId: 'synthetic-superseding-root',
      })
      .where(eq(sequences.id, fixture.sequence.id));
    const before = await stored();
    expect(
      await deliverStoryboardNotification(fixture.methods, fixture.owner)
    ).toBe(false);
    expect(await reconcileStoryboardNotifications(db)).toBe(0);
    expect(await receipts()).toEqual([]);
    expect(await stored()).toEqual(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it('removes a queued failure that no longer matches the terminal status', async () => {
    await queueFailure();
    await db
      .update(sequences)
      .set({ status: STATUS.completed })
      .where(eq(sequences.id, fixture.sequence.id));
    expect(await reconcileStoryboardNotifications(db)).toBe(0);
    expect(await receipts()).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('cleans a receipt after its synthetic parent-only organization graph is deleted', async () => {
    const { organizationId, owner } = await seedParentOnlyOwner();
    await createSequencesMethods(
      db,
      organizationId,
      fixture.userId
    ).failWorkflowIfCurrent({
      ...owner,
      error: FAILURE_MESSAGE,
      notification: {
        event: 'generation.failed',
        data: {
          workflowOwner: { workflowRunId: owner.workflowRunId },
          message: FAILURE_MESSAGE,
        },
      },
    });
    await db.delete(organization).where(eq(organization.id, organizationId));
    expect(
      await db
        .select()
        .from(storyboardNotifications)
        .where(eq(storyboardNotifications.sequenceId, owner.id))
    ).toHaveLength(1);
    expect(await reconcileStoryboardNotifications(db)).toBe(0);
    expect(
      await db
        .select()
        .from(storyboardNotifications)
        .where(eq(storyboardNotifications.sequenceId, owner.id))
    ).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('cleans up the pending row through the actual scoped sequence deletion', async () => {
    await queueFailure();
    await fixture.methods.delete(fixture.sequence.id, { releasedVoiceIds: [] });
    expect(await receipts()).toEqual([]);
    expect(await reconcileStoryboardNotifications(db)).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});
