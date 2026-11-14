import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { UserWorkflowContext } from './types';
import { isEngineAbortError } from './errors';
import { runFailureActions } from './failure-actions';
import { asStub } from '@/test/as-stub';

const cleanup = vi.fn(async () => undefined);
const emit = vi.fn(async () => undefined);
const notifyParentOfFailure = vi.fn(async () => undefined);
const original = new Error('provider request failed');
vi.doMock('#env', () => ({ getEnv: () => ({ E2E_TEST: undefined }) }));
vi.doMock('#db-client', () => ({ getDb: vi.fn() }));
vi.doMock('@/platform/server/db/scoped', () => ({
  createScopedDb: () => ({}),
}));
vi.doMock('@/billing/server/seed-model-pricing', () => ({
  ensureE2eModelPricing: vi.fn(),
}));
vi.doMock('@/models/server/fal-config', () => ({
  configureFalProxyFromEnv: vi.fn(),
}));
vi.doMock('@/platform/server/observability/flush-analytics', () => ({
  flushAnalytics: vi.fn(),
}));
vi.doMock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
vi.doMock('./await-child', () => ({
  notifyParent: vi.fn(),
  notifyParentOfFailure,
}));

const { OpenStoryWorkflowEntrypoint } = await import('./base-workflow');

class FailureProbe extends OpenStoryWorkflowEntrypoint<UserWorkflowContext> {
  protected override readonly failureLabel = 'Synthetic failure probe';
  protected override async runImpl(): Promise<unknown> {
    throw original;
  }
  protected override onFailure(): Promise<void> {
    return runFailureActions([cleanup, emit]);
  }
}

function makeProbe(): FailureProbe {
  type Ctor = ConstructorParameters<typeof FailureProbe>;
  return new FailureProbe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function event(): Readonly<WorkflowEvent<UserWorkflowContext>> {
  return asStub({
    instanceId: 'synthetic-child',
    payload: {
      userId: 'user-1',
      organizationId: 'organization-1',
      promptLocale: 'en',
      _parent: {
        bindingName: 'STORYBOARD_WORKFLOW',
        parentInstanceId: 'synthetic-parent',
        eventType: 'done-child',
      },
    },
  });
}

// Host-side step double: only ordinary failure-step errors get one retry.
function retryingStep() {
  const checkpointed: string[] = [];
  const step = asStub<WorkflowStep>({
    do: async (name: string, action: () => Promise<unknown>) => {
      try {
        const result = await action();
        checkpointed.push(name);
        return result;
      } catch (error) {
        if (name !== 'emit-failure' || isEngineAbortError(error)) throw error;
        const result = await action();
        checkpointed.push(name);
        return result;
      }
    },
  });
  return { step, checkpointed };
}

describe('failure actions inside the real workflow base', () => {
  beforeEach(() => {
    cleanup.mockReset().mockResolvedValue(undefined);
    emit.mockReset().mockResolvedValue(undefined);
    notifyParentOfFailure.mockReset().mockResolvedValue(undefined);
  });

  it('retries cleanup after attempting notification and retains the original run error', async () => {
    cleanup.mockRejectedValueOnce(new Error('D1 unavailable'));
    const { step, checkpointed } = retryingStep();
    await expect(makeProbe().run(event(), step)).rejects.toBe(original);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(checkpointed).toContain('emit-failure');
    expect(notifyParentOfFailure).toHaveBeenCalledOnce();
    expect(notifyParentOfFailure.mock.invocationCallOrder[0]).toBeGreaterThan(
      emit.mock.invocationCallOrder[1] ?? 0
    );
  });

  it('retries a failed notification instead of checkpointing it as successful', async () => {
    emit.mockRejectedValueOnce(new Error('channel unavailable'));
    const { step, checkpointed } = retryingStep();
    await expect(makeProbe().run(event(), step)).rejects.toBe(original);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(checkpointed).toContain('emit-failure');
  });

  it('exhausts cleanup retries before the base preserves the original error and notifies the parent', async () => {
    cleanup.mockRejectedValue(new Error('D1 unavailable'));
    const { step, checkpointed } = retryingStep();
    await expect(makeProbe().run(event(), step)).rejects.toBe(original);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(checkpointed).not.toContain('emit-failure');
    expect(notifyParentOfFailure).toHaveBeenCalledOnce();
  });

  it('leaves cleanup uncheckpointed and the parent unnotified on an engine abort', async () => {
    const abort = new Error('Aborting engine: Grace period complete');
    cleanup.mockRejectedValueOnce(abort);
    const { step, checkpointed } = retryingStep();
    await expect(makeProbe().run(event(), step)).rejects.toBe(abort);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(emit).not.toHaveBeenCalled();
    expect(checkpointed).not.toContain('emit-failure');
    expect(notifyParentOfFailure).not.toHaveBeenCalled();
  });

  it('preserves an engine abort from notification even after a cleanup error', async () => {
    const abort = new Error(
      'Durable Object reset because its code was updated.'
    );
    cleanup.mockRejectedValueOnce(new Error('D1 unavailable'));
    emit.mockRejectedValueOnce(abort);
    const { step, checkpointed } = retryingStep();
    await expect(makeProbe().run(event(), step)).rejects.toBe(abort);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
    expect(checkpointed).not.toContain('emit-failure');
    expect(notifyParentOfFailure).not.toHaveBeenCalled();
  });
});
