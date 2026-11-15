import { vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { WorkflowStep } from 'cloudflare:workers';
import { asStub } from '@/test/as-stub';
import type { StoryboardOwner } from '../db/storyboard-owner';

// In-memory lifecycle substitute; real ownership predicates have DB tests.
export function createStoryboardLifecycleStub() {
  return {
    failWorkflowIfCurrent: vi.fn<
      WorkflowScopedDb['sequences']['failWorkflowIfCurrent']
    >(async () => true),
    completeWorkflowIfCurrent: vi.fn<
      WorkflowScopedDb['sequences']['completeWorkflowIfCurrent']
    >(async () => true),
  };
}

export function storyboardFailureInput(owner: StoryboardOwner, error: string) {
  return { ...owner, error };
}

export function makeStep(
  cachedResults: ReadonlyMap<string, unknown> = new Map()
) {
  const names: string[] = [];
  // Minimal WorkflowStep stub: runImpl only uses do.
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

// Service stub only; ownership predicates and real scoped composition have DB tests.
export function makeStoryboardRunImplDb() {
  const startWorkflowIfCurrent = vi.fn(async () => true);
  const setPosterIfCurrent = vi.fn(async () => true);
  const methods = createStoryboardLifecycleStub();
  const deleteBySequence = vi.fn();
  const getForUser = vi.fn(async () => ({ id: 'seq_1', status: 'processing' }));
  const update = vi.fn();
  const scopedDb = asStub<WorkflowScopedDb>({
    models: DEFAULT_MODEL_CONFIGURATION,
    liveRead: { sequences: { getForUser } },
    shots: { deleteBySequence },
    credentials: {},
    sequences: {
      ...methods,
      update,
      setPosterIfCurrent,
      startWorkflowIfCurrent,
    },
  });
  return {
    scopedDb,
    deleteBySequence,
    update,
    setPosterIfCurrent,
    startWorkflowIfCurrent,
    ...methods,
  };
}
