import { vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import { micros } from '@/billing/money';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import { asStub } from '@/test/as-stub';

// Synthetic engine, billing and transport; no provider, wallet or network writes.
export const OWNER = {
  id: 'synthetic-poster-sequence',
  workflowRunId: 'synthetic-poster-root-A',
  workflowClaimId: 'synthetic-poster-claim-A',
};
export const POSTER = {
  url: '/r2/synthetic-poster.png',
  metadata: {
    prompt: 'Synthetic poster',
    model: DEFAULT_MODEL_CONFIGURATION.poster,
    endpointId: 'synthetic-poster-endpoint',
    cost: micros(100_000),
    usedOwnKey: false,
    unitsBilled: 1,
    numImages: 1,
    requestId: 'synthetic-request',
    dimensions: [],
    file_sizes: [],
  } satisfies ImageGenerationResult['metadata'],
};
export const STEP = {
  usage: 'record-fal-usage-poster',
  deduct: 'deduct-poster-credits',
  save: 'save-poster',
  release: 'zero-reservation',
} as const;
export const emit = vi.fn(async (_event: string, _data: unknown) => {});
export const deduct = vi.fn(async (_input: unknown) => {});
export const recordUsage = vi.fn(async (_usage: unknown) => {});

vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: vi.fn(() => ({ emit })),
}));
vi.doMock('@/billing/server/workflow-deduction', async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import('@/billing/server/workflow-deduction')
    >();
  return {
    ...real,
    deductWorkflowCredits: deduct,
  };
});

export function checkpointStep(checkpoints = new Map<string, unknown>()) {
  const names: string[] = [];
  const execute = async (name: string, callback: () => Promise<unknown>) => {
    names.push(name);
    if (checkpoints.has(name)) return structuredClone(checkpoints.get(name));
    const result = await callback();
    checkpoints.set(name, structuredClone(result));
    return result;
  };
  return { step: asStub<WorkflowStep>({ do: execute }), names, checkpoints };
}

export function posterArgs(checkpoints?: Map<string, unknown>) {
  const setPosterIfCurrent = vi.fn<
    WorkflowScopedDb['sequences']['setPosterIfCurrent']
  >(async () => true);
  const zeroReservation = vi.fn(async (_id: string) => {});
  const modelUsage = { record: recordUsage };
  const scopedDb = asStub<WorkflowScopedDb>({
    models: DEFAULT_MODEL_CONFIGURATION,
    modelUsage,
    sequences: { setPosterIfCurrent },
    billing: { zeroReservation },
  });
  const execution = checkpointStep(checkpoints);
  return {
    ...execution,
    setPosterIfCurrent,
    zeroReservation,
    args: {
      step: execution.step,
      scopedDb,
      owner: OWNER,
      poster: structuredClone(POSTER),
      reservationId: 'synthetic-poster-reservation',
    },
  };
}
