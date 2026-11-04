/**
 * `useCreateSequence` must forward the WHOLE validated input to the server.
 *
 * It used to hand-copy a field list, and a field missing from that list failed
 * silently in the worst way: the composer set it, the hook dropped it, and the
 * server's Zod `.default()` supplied a value nobody chose. `generateStartFrames` (then `referenceOnly`)
 * shipped that way — the toggle rendered, persisted to localStorage, priced
 * itself into the quote, and every sequence still wrote `reference_only = 0`.
 * Nothing threw, so the only symptom was the full image pipeline running in a
 * mode that is supposed to skip it.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getI18n, I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

type CreateCall = { data: Record<string, unknown> };
const createSequenceFn = vi.fn<(args: CreateCall) => Promise<unknown[]>>(
  async () => []
);
const setSequenceModelsFn = vi.fn<(args: CreateCall) => Promise<unknown>>(
  async () => ({})
);
const setSequenceTargetDurationFn = vi.fn<
  (args: CreateCall) => Promise<unknown>
>(async () => ({}));
vi.doMock('@/sequences/sequences.fn', () => ({
  createSequenceFn,
  setSequenceModelsFn,
  setSequenceTargetDurationFn,
}));
// Mock mutation handles keep the options inspectable without running a real request.
const mutationOptions = new WeakMap<object, MutationOptions>();
type MutationOptions = {
  mutationFn: (input: unknown) => Promise<unknown>;
  onMutate?: (input: unknown) => Promise<unknown>;
  onError?: (error: unknown, input: unknown, ctx: unknown) => void;
};
/** One cache for the whole file, keyed by the serialised query key. */
const cache = new Map<string, unknown>();
const queryClient = {
  getQueryData: (key: readonly unknown[]) => cache.get(JSON.stringify(key)),
  setQueryData: (key: readonly unknown[], next: unknown) => {
    const id = JSON.stringify(key);
    cache.set(id, typeof next === 'function' ? next(cache.get(id)) : next);
  },
  cancelQueries: vi.fn(async () => {}),
  invalidateQueries: vi.fn(),
};
vi.doMock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient,
  useMutation: (options: MutationOptions) => {
    const handle = {};
    mutationOptions.set(handle, options);
    return handle;
  },
  useQuery: () => ({ data: undefined }),
}));

/** The `mutationFn` the hook handed to `useMutation`. */
function mutationFnOf(useHook: () => object): MutationOptions['mutationFn'] {
  return optionsOf(useHook).mutationFn;
}
function optionsOf(useHook: () => object): MutationOptions {
  const capture = vi.fn<(result: object) => void>();
  function Probe() {
    capture(useHook());
    return null;
  }
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: getI18n() }, createElement(Probe))
  );
  const result = capture.mock.calls[0]?.[0];
  const options = result ? mutationOptions.get(result) : undefined;
  if (!options) throw new Error('useMutation was not called by the hook');
  return options;
}
vi.doMock('@posthog/react', () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));
vi.doMock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.doMock('@/platform/ui/auth/session-query', () => ({
  useAuthSession: () => ({ data: null }),
}));

const {
  sequenceKeys,
  useCreateSequence,
  useSetSequenceModels,
  useSetSequenceTargetDuration,
} = await import('./use-sequences');

/** Every field the composer can set, with values distinct from the server defaults. */
const INPUT = {
  teamId: 'team_1',
  script: 'INT. LAUNDROMAT - NIGHT',
  styleId: 'style_1',
  title: 'Firefly Courier',
  aspectRatio: '9:16' as const,
  analysisModels: ['gpt_5_6_luna'],
  imageModels: ['nano_banana_2_lite'],
  videoModel: 'minimax_h3_max',
  videoModels: ['minimax_h3_max'],
  autoGenerateMotion: true,
  autoGenerateMusic: false,
  generateStartFrames: false,
  targetDurationSeconds: 30,
  suggestedLocationIds: ['loc_1'],
};

describe('useCreateSequence forwards the full input', () => {
  it('sends every field the caller set, generateStartFrames included', async () => {
    createSequenceFn.mockClear();
    await mutationFnOf(useCreateSequence)(INPUT);

    const sent = createSequenceFn.mock.calls[0]?.[0];
    expect(sent).toBeDefined();

    // The regression that shipped: dropped silently, defaulted away.
    expect(sent?.data.generateStartFrames).toBe(false);

    // And the general rule — nothing the caller set may go missing.
    for (const [key, value] of Object.entries(INPUT)) {
      expect(sent?.data[key]).toEqual(value);
    }
  });

  it('still defaults a blank title rather than sending one', async () => {
    createSequenceFn.mockClear();
    await mutationFnOf(useCreateSequence)({ ...INPUT, title: '' });

    const sent = createSequenceFn.mock.calls[0]?.[0];
    expect(sent?.data.title).toBe('Untitled Sequence');
    expect(sent?.data.generateStartFrames).toBe(false);
  });
});

describe('useSetSequenceModels', () => {
  it('sends the sequence id and the picked model', async () => {
    setSequenceModelsFn.mockClear();
    await mutationFnOf(() => useSetSequenceModels('seq_1'))({
      videoModel: 'seedance_v2_5',
    });

    expect(setSequenceModelsFn).toHaveBeenCalledWith({
      data: { sequenceId: 'seq_1', videoModel: 'seedance_v2_5' },
    });
  });
});

// #2080: the target chip is a controlled toggle reading this cache, so a click
// that waits for the server looks like a dead control.
describe('useSetSequenceTargetDuration', () => {
  it('shows the pick at once and puts the old target back if the save fails', async () => {
    const key = sequenceKeys.detail('seq_1');
    queryClient.setQueryData(key, { id: 'seq_1', targetDurationSeconds: 30 });
    const options = optionsOf(() => useSetSequenceTargetDuration('seq_1'));

    const ctx = await options.onMutate?.(60);
    expect(queryClient.getQueryData(key)).toMatchObject({
      targetDurationSeconds: 60,
    });

    options.onError?.(new Error('offline'), 60, ctx);
    expect(queryClient.getQueryData(key)).toMatchObject({
      targetDurationSeconds: 30,
    });
  });
});
