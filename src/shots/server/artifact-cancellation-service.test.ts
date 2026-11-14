import { beforeEach, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/platform/errors';
import { asStub } from '@/test/as-stub';
import { cancelPendingArtifact } from './shot-content-edit';

const terminate = vi.hoisted(() =>
  vi.fn<(runId: string | null) => Promise<boolean>>()
);
vi.mock('@/platform/server/workflow/run-outcome', () => ({
  terminateSingleArtifactRun: terminate,
}));
vi.mock('./regenerate-shot-prompt', () => ({
  loadShotSpecState: vi.fn(),
  regenerateShotPrompt: vi.fn(),
}));
vi.mock('./shot-preview', () => ({ redrawShotPreview: vi.fn() }));

type CancellationContext = Parameters<typeof cancelPendingArtifact>[0];
type CancellationMethods =
  CancellationContext['scopedDb']['artifactCancellations'];
type CancellationResult = Awaited<
  ReturnType<CancellationMethods['cancelImage']>
>;
const FRAME_ID = 'synthetic-frame';
const SHOT_ID = 'synthetic-shot';
const VERSION_ID = 'synthetic-version';
const OTHER_FRAME_ID = 'synthetic-other-frame';
const WORKFLOW_RUN_IDS: Array<string | null> = [
  'synthetic-image-run',
  null,
  'synthetic-prompt-run',
];

// Explicit service substitutes observe commit and termination ordering.
const scopedDb = {
  framePromptVersions: { getByIdForFrame: vi.fn() },
  frameVariants: { getById: vi.fn() },
  shotPromptVersions: { getByIdForShot: vi.fn(), markTerminal: vi.fn() },
  artifactCancellations: {
    cancelVisualPrompt: vi.fn<CancellationMethods['cancelVisualPrompt']>(),
    cancelImage: vi.fn<CancellationMethods['cancelImage']>(),
  },
};
const context = asStub<CancellationContext>({
  scopedDb,
  frame: { id: FRAME_ID },
  shot: { id: SHOT_ID },
});
const AGGREGATE_CASES = [
  {
    artifact: 'visual-prompt',
    method: 'cancelVisualPrompt',
    lookup: scopedDb.framePromptVersions.getByIdForFrame,
    lookupArgs: [VERSION_ID, FRAME_ID],
  },
  {
    artifact: 'image',
    method: 'cancelImage',
    lookup: scopedDb.frameVariants.getById,
    lookupArgs: [VERSION_ID],
  },
] as const;
const NOT_FOUND_CASES = [
  {
    artifact: 'visual-prompt',
    lookup: scopedDb.framePromptVersions.getByIdForFrame,
    message: 'Prompt version not found for this shot',
  },
  {
    artifact: 'motion-prompt',
    lookup: scopedDb.shotPromptVersions.getByIdForShot,
    message: 'Prompt version not found for this shot',
  },
  {
    artifact: 'image',
    lookup: scopedDb.frameVariants.getById,
    message: 'Image version not found for this shot',
  },
] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  scopedDb.framePromptVersions.getByIdForFrame.mockResolvedValue({
    id: VERSION_ID,
  });
  scopedDb.frameVariants.getById.mockResolvedValue({
    id: VERSION_ID,
    frameId: FRAME_ID,
  });
  scopedDb.shotPromptVersions.getByIdForShot.mockResolvedValue({
    id: VERSION_ID,
    workflowRunId: WORKFLOW_RUN_IDS[0],
  });
  scopedDb.shotPromptVersions.markTerminal.mockResolvedValue(true);
  scopedDb.artifactCancellations.cancelVisualPrompt.mockResolvedValue({
    cancelled: true,
    workflowRunIds: [],
  });
  scopedDb.artifactCancellations.cancelImage.mockResolvedValue({
    cancelled: true,
    workflowRunIds: [],
  });
  terminate.mockResolvedValue(false);
});

function expectNoAggregateCancellation() {
  expect(
    scopedDb.artifactCancellations.cancelVisualPrompt
  ).not.toHaveBeenCalled();
  expect(scopedDb.artifactCancellations.cancelImage).not.toHaveBeenCalled();
}

it.each(AGGREGATE_CASES)(
  '$artifact waits for commit, then awaits each termination in order',
  async ({ artifact, method, lookup, lookupArgs }) => {
    const commit = deferred<CancellationResult>();
    const entered = deferred<void>();
    const firstTermination = deferred<boolean>();
    const terminationStarted = deferred<void>();
    const aggregate = scopedDb.artifactCancellations[method];
    aggregate.mockImplementationOnce(() => {
      entered.resolve();
      return commit.promise;
    });
    terminate.mockImplementationOnce(() => {
      terminationStarted.resolve();
      return firstTermination.promise;
    });

    const pending = cancelPendingArtifact(context, {
      artifact,
      versionId: VERSION_ID,
    });
    await entered.promise;
    expect(terminate).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledExactlyOnceWith(...lookupArgs);
    expect(aggregate).toHaveBeenCalledExactlyOnceWith({
      versionId: VERSION_ID,
      frameId: FRAME_ID,
    });
    commit.resolve({ cancelled: true, workflowRunIds: WORKFLOW_RUN_IDS });
    await terminationStarted.promise;
    expect(terminate.mock.calls).toEqual([[WORKFLOW_RUN_IDS[0]]]);
    firstTermination.resolve(false);

    await expect(pending).resolves.toEqual({ cancelled: true });
    expect(terminate.mock.calls).toEqual(
      WORKFLOW_RUN_IDS.map((runId) => [runId])
    );
  }
);

it.each(AGGREGATE_CASES)(
  '$artifact terminates historical repair runs even when the target reports false',
  async ({ artifact, method }) => {
    scopedDb.artifactCancellations[method].mockResolvedValueOnce({
      cancelled: false,
      workflowRunIds: WORKFLOW_RUN_IDS,
    });

    await expect(
      cancelPendingArtifact(context, { artifact, versionId: VERSION_ID })
    ).resolves.toEqual({ cancelled: false });
    expect(terminate.mock.calls).toEqual(
      WORKFLOW_RUN_IDS.map((runId) => [runId])
    );
  }
);

it.each(AGGREGATE_CASES)(
  '$artifact propagates a failed commit without terminating workflows',
  async ({ artifact, method }) => {
    const failure = new Error('Synthetic aggregate commit failure');
    scopedDb.artifactCancellations[method].mockRejectedValueOnce(failure);

    await expect(
      cancelPendingArtifact(context, { artifact, versionId: VERSION_ID })
    ).rejects.toBe(failure);
    expect(terminate).not.toHaveBeenCalled();
  }
);

it.each([
  { artifact: 'visual-prompt', method: 'cancelVisualPrompt', cancelled: true },
  { artifact: 'visual-prompt', method: 'cancelVisualPrompt', cancelled: false },
  { artifact: 'image', method: 'cancelImage', cancelled: true },
  { artifact: 'image', method: 'cancelImage', cancelled: false },
] as const)(
  '$artifact preserves cancelled=$cancelled when no runs need termination',
  async ({ artifact, method, cancelled }) => {
    scopedDb.artifactCancellations[method].mockResolvedValueOnce({
      cancelled,
      workflowRunIds: [],
    });

    await expect(
      cancelPendingArtifact(context, { artifact, versionId: VERSION_ID })
    ).resolves.toEqual({ cancelled });
    expect(terminate).not.toHaveBeenCalled();
  }
);

it.each(NOT_FOUND_CASES)(
  '$artifact retains its original missing-version error',
  async ({ artifact, lookup, message }) => {
    lookup.mockResolvedValueOnce(null);
    const pending = cancelPendingArtifact(context, {
      artifact,
      versionId: VERSION_ID,
    });

    await expect(pending).rejects.toBeInstanceOf(NotFoundError);
    await expect(pending).rejects.toThrow(message);
    expectNoAggregateCancellation();
    expect(scopedDb.shotPromptVersions.markTerminal).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  }
);

it('rejects an image belonging to a different frame before cancellation', async () => {
  scopedDb.frameVariants.getById.mockResolvedValueOnce({
    id: VERSION_ID,
    frameId: OTHER_FRAME_ID,
  });
  const pending = cancelPendingArtifact(context, {
    artifact: 'image',
    versionId: VERSION_ID,
  });

  await expect(pending).rejects.toBeInstanceOf(NotFoundError);
  await expect(pending).rejects.toThrow(
    'Image version not found for this shot'
  );
  expectNoAggregateCancellation();
  expect(terminate).not.toHaveBeenCalled();
});

it.each([true, false])(
  'motion-prompt keeps its single-write behavior when cancelled=%s',
  async (cancelled) => {
    scopedDb.shotPromptVersions.markTerminal.mockResolvedValueOnce(cancelled);

    await expect(
      cancelPendingArtifact(context, {
        artifact: 'motion-prompt',
        versionId: VERSION_ID,
      })
    ).resolves.toEqual({ cancelled });
    expect(scopedDb.shotPromptVersions.getByIdForShot).toHaveBeenCalledWith(
      VERSION_ID,
      SHOT_ID
    );
    expect(
      scopedDb.shotPromptVersions.markTerminal
    ).toHaveBeenCalledExactlyOnceWith(VERSION_ID, 'cancelled');
    expect(terminate.mock.calls).toEqual(
      cancelled ? [[WORKFLOW_RUN_IDS[0]]] : []
    );
    expectNoAggregateCancellation();
  }
);

it('motion-prompt propagates a failed write without terminating workflows', async () => {
  const failure = new Error('Synthetic motion-prompt write failure');
  scopedDb.shotPromptVersions.markTerminal.mockRejectedValueOnce(failure);

  await expect(
    cancelPendingArtifact(context, {
      artifact: 'motion-prompt',
      versionId: VERSION_ID,
    })
  ).rejects.toBe(failure);
  expectNoAggregateCancellation();
  expect(terminate).not.toHaveBeenCalled();
});
