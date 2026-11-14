import { vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { asStub } from '@/test/as-stub';
import { createStoryboardNotificationStub } from './storyboard-notifications.test.fixture';

// Service stub only; ownership predicates and real scoped composition have DB tests.
export function makeStoryboardRunImplDb() {
  const startWorkflowIfCurrent = vi.fn(async () => true);
  const setPosterIfCurrent = vi.fn(async () => true);
  const { methods, receipts } = createStoryboardNotificationStub();
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
    receipts,
  };
}
