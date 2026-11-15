import type { ScopedDb } from '@/platform/server/db/scoped';
import type { Sequence } from '@/platform/server/db/schema';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import { asStub } from '@/test/as-stub';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankSequence } from './create-blank-sequence';
import { blankSequenceSchema } from './sequence.schemas';

const sideEffects = vi.hoisted(() => ({
  triggerWorkflow: vi.fn(),
  reserveRunCredits: vi.fn(),
}));
vi.mock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: sideEffects.triggerWorkflow,
}));
vi.mock('@/billing/server/preflight', () => ({
  reserveRunCredits: sideEffects.reserveRunCredits,
}));
vi.mock('@/platform/id', () => ({
  generateId: () => '01BLANKSEQUENCEULID000000',
}));

const INPUT = {
  styleId: 'mock-style',
  aspectRatio: '16:9',
  resolution: '720p',
  analysisModel: 'anthropic/claude-sonnet-5.5',
  imageModel: 'nano_banana_2',
  videoModel: 'seedance_v2',
} as const;

function createMockDb() {
  const template = DEFAULT_STYLE_TEMPLATES[0];
  if (!template) throw new Error('Missing mock platform template');
  const create = vi.fn(
    async (row: Parameters<ScopedDb['sequences']['create']>[0]) =>
      asStub<Sequence>(row)
  );
  const createForSequence = vi.fn();
  const scopedDb = asStub<ScopedDb>({
    styles: {
      getById: vi.fn(async () => ({
        ...template,
        id: INPUT.styleId,
        sequenceId: null,
      })),
      createForSequence,
    },
    sequences: { getById: vi.fn(), create },
  });
  return { scopedDb, create, createForSequence };
}

beforeEach(() => vi.clearAllMocks());

describe('createBlankSequence', () => {
  it('writes an empty draft without reserving credits or starting a workflow', async () => {
    const { scopedDb, create, createForSequence } = createMockDb();
    await createBlankSequence(INPUT, {
      scopedDb,
      user: { id: 'mock-user' },
      promptLocale: 'en',
    });
    expect(createForSequence).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        script: '',
        styleId: INPUT.styleId,
        generationStopAt: 'script',
        title: expect.any(String),
      })
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('workflowRunId');
    expect(sideEffects.reserveRunCredits).not.toHaveBeenCalled();
    expect(sideEffects.triggerWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    ['zh-CN', '清新、富有感官体验，自然流露时髦气息'],
    ['en', 'Fresh, sensory, and effortlessly cool'],
  ] as const)(
    'snapshots the platform recipe in %s',
    async (promptLocale, mood) => {
      const { scopedDb, create } = createMockDb();
      await createBlankSequence(INPUT, {
        scopedDb,
        user: { id: 'mock-user' },
        promptLocale,
      });
      expect(create.mock.calls[0]?.[0].resolvedStyleConfig?.look.mood).toBe(
        mood
      );
    }
  );

  it('accepts and preserves selected platform text and image channel models', async () => {
    const { scopedDb, create } = createMockDb();
    const input = blankSequenceSchema.parse({
      ...INPUT,
      analysisModel: 'custom:platform-analysis',
      imageModel: 'custom-image:platform-still',
    });
    await createBlankSequence(input, {
      scopedDb,
      user: { id: 'mock-user' },
      promptLocale: 'zh-CN',
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      analysisModel: input.analysisModel,
      imageModel: input.imageModel,
    });
  });
});
