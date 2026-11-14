// In-memory service stub only; real D1 atomicity and ownership have separate DB tests.
import { vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';
import { generateId } from '@/platform/id';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StoryboardNotification } from '@/sequences/storyboard-notification';
import type { StoryboardOwner } from '../db/storyboard-owner';

type NotificationMethods = Pick<
  WorkflowScopedDb['sequences'],
  | 'failWorkflowIfCurrent'
  | 'completeWorkflowIfCurrent'
  | 'beginWorkflowNotificationAttempt'
  | 'confirmWorkflowNotificationDelivery'
>;
type Receipt = NonNullable<
  Awaited<ReturnType<NotificationMethods['beginWorkflowNotificationAttempt']>>
>;
type Mutation = StoryboardOwner & { notification?: StoryboardNotification };
const TERMINAL_STATUS = { failed: 'failed', completed: 'completed' } as const;

function receiptKey(owner: StoryboardOwner): string {
  return owner.id + ':' + owner.workflowRunId;
}

class MemoryNotificationReceipts {
  readonly receipts = new Map<string, Receipt>();

  record(params: Mutation, status: Receipt['sequenceStatus']): void {
    if (!params.notification || this.receipts.has(receiptKey(params))) return;
    this.receipts.set(receiptKey(params), {
      id: generateId(),
      organizationId: 'mock-organization',
      sequenceId: params.id,
      workflowRunId: params.workflowRunId,
      workflowClaimId: params.workflowClaimId ?? null,
      notification: structuredClone(params.notification),
      sequenceStatus: status,
      deliveredAt: null,
      lastAttemptAt: null,
      createdAt: new Date(),
    });
  }

  begin(owner: StoryboardOwner): Receipt | undefined {
    const receipt = this.receipts.get(receiptKey(owner));
    if (!receipt || receipt.deliveredAt) return undefined;
    receipt.lastAttemptAt = new Date();
    return structuredClone(receipt);
  }

  confirm(receipt: Receipt): boolean {
    const recorded = this.receipts.get(
      receiptKey({
        id: receipt.sequenceId,
        workflowRunId: receipt.workflowRunId,
      })
    );
    if (!recorded || recorded.id !== receipt.id || recorded.deliveredAt)
      return false;
    recorded.deliveredAt = new Date();
    return true;
  }
}

export function createStoryboardNotificationStub() {
  const state = new MemoryNotificationReceipts();
  const failWorkflowIfCurrent = vi.fn<
    NotificationMethods['failWorkflowIfCurrent']
  >(async (params) => {
    state.record(params, TERMINAL_STATUS.failed);
    return true;
  });
  const completeWorkflowIfCurrent = vi.fn<
    NotificationMethods['completeWorkflowIfCurrent']
  >(async (params) => {
    state.record(params, TERMINAL_STATUS.completed);
    return true;
  });
  const beginWorkflowNotificationAttempt = vi.fn<
    NotificationMethods['beginWorkflowNotificationAttempt']
  >(async (owner) => state.begin(owner));
  const confirmWorkflowNotificationDelivery = vi.fn<
    NotificationMethods['confirmWorkflowNotificationDelivery']
  >(async (receipt) => state.confirm(receipt));
  return {
    receipts: state.receipts,
    methods: {
      failWorkflowIfCurrent,
      completeWorkflowIfCurrent,
      beginWorkflowNotificationAttempt,
      confirmWorkflowNotificationDelivery,
    },
  };
}

export function storyboardFailureInput(
  owner: StoryboardOwner,
  error: string
): Parameters<NotificationMethods['failWorkflowIfCurrent']>[0] {
  const { id, ...workflowOwner } = owner;
  return {
    id,
    ...workflowOwner,
    error,
    notification: {
      event: 'generation.failed',
      data: { workflowOwner, message: error },
    },
  };
}

export function makeStep(
  cachedResults: ReadonlyMap<string, unknown> = new Map()
) {
  const names: string[] = [];
  // minimal WorkflowStep stub: runImpl only uses `do`
  const step = asStub<WorkflowStep>({
    do: vi.fn((_name: string, fn: () => Promise<unknown>) => {
      names.push(_name);
      if (cachedResults.has(_name))
        return Promise.resolve(cachedResults.get(_name));
      return fn();
    }),
  });
  return { step, names };
}
