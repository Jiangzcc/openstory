import { NonRetryableError } from 'cloudflare:workflows';
import type { WorkflowStep } from 'cloudflare:workers';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import {
  autoStyleDraftFromResponse,
  createAutoStyleResponseSchema,
} from '@/look/auto-style';
import type { AutoStyleResponse } from '@/look/auto-style';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  sequences,
  sequenceStyleVersions,
  styles,
} from '@/platform/server/db/schema';
import {
  StoryboardContentOwnershipCheckError,
  StoryboardContentOwnershipError,
} from '@/sequences/server/db/storyboard-content-scope';
import { seedSpace } from '@/sequences/server/db/storyboard-content-ownership.test.fixture';
import { asStub } from '@/test/as-stub';
import { autoStyleOutput } from './auto-style-output';

// Migrated Node SQLite/D1 persistence; LLM, realtime and workflow engine are explicit substitutes.
let db: Database;
let closeDb: () => Promise<void>;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const emit = vi.fn(async () => undefined);
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit }),
}));
const durableLLMCallCf = vi.fn<() => Promise<AutoStyleResponse>>();
vi.doMock('@/models/server/llm-call-helper', () => ({ durableLLMCallCf }));
const { createScopedDb } = await import('@/platform/server/db/scoped');
const { deriveAutoStyle } = await import('./auto-style-step');
const RESPONSE = createAutoStyleResponseSchema('zh-CN').parse({
  name: '合成风格 "黎明"',
  description: '合成测试\n第二行',
  category: 'film',
  tags: ['synthetic'],
  colorPalette: ['#111111'],
  pace: 'measured',
  energy: 2,
  references: ['synthetic'],
});
const DRAFT = autoStyleDraftFromResponse(RESPONSE);
const NEXT_RUN = 'synthetic-replacement-root';
const ROOT_RUN = 'synthetic-storyboard-root';
const CHILD_RUN = 'synthetic-analysis-child';
const step = asStub<WorkflowStep>({
  do: async <T>(_name: string, fn: () => Promise<T>) => fn(),
});

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(() => {
  emit.mockClear();
  durableLLMCallCf.mockReset();
  durableLLMCallCf.mockResolvedValue(RESPONSE);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(new Error('Unexpected network in synthetic style test'))
    )
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function runFixture() {
  const space = await seedSpace(db);
  const sequenceId = generateId();
  const styleId = generateId();
  await db.insert(styles).values({
    id: styleId,
    organizationId: space.organizationId,
    sequenceId,
    name: 'Synthetic pending style',
    config: DRAFT.config,
  });
  await db.insert(sequences).values({
    id: sequenceId,
    title: 'Synthetic automatic style sequence',
    organizationId: space.organizationId,
    styleId,
    status: 'processing',
    workflowRunId: ROOT_RUN,
  });
  const scopedDb = toWorkflowScopedDb(
    createScopedDb(space.organizationId, generateId())
  );
  const params = {
    promptLocale: 'zh-CN' as const,
    scopedDb,
    workflowRunId: CHILD_RUN,
    storyboardOwner: { workflowRunId: ROOT_RUN },
    sequenceId,
    styleId,
    script: '合成脚本',
    aspectRatio: '16:9' as const,
    analysisModelId: 'anthropic/claude-sonnet-5.5' as const,
  };
  return { params, scopedDb, sequenceId, styleId };
}

async function contents(sequenceId: string, styleId: string) {
  const [sequence] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, sequenceId));
  const [style] = await db.select().from(styles).where(eq(styles.id, styleId));
  const versions = await db
    .select()
    .from(sequenceStyleVersions)
    .where(eq(sequenceStyleVersions.sequenceId, sequenceId));
  return { sequence, style, versions };
}

it('persists the actual localized draft through scoped DB and announces only after both writes', async () => {
  const f = await runFixture();
  const factory = vi.spyOn(f.scopedDb, 'storyboardAutoStyle');
  const result = await deriveAutoStyle(step, f.params);
  expect(result).toEqual(DRAFT.config);
  expect(factory).toHaveBeenCalledExactlyOnceWith({
    id: f.sequenceId,
    workflowRunId: ROOT_RUN,
  });
  const saved = await contents(f.sequenceId, f.styleId);
  expect(saved.style?.name).toBe(DRAFT.name);
  // JSON columns omit undefined optional fields.
  expect(JSON.stringify(saved.style?.config)).toBe(
    JSON.stringify(DRAFT.config)
  );
  expect(saved.versions).toEqual([
    expect.objectContaining({ source: 'derived' }),
  ]);
  expect(JSON.stringify(saved.versions[0]?.config)).toBe(
    JSON.stringify(DRAFT.config)
  );
  expect(saved.sequence?.selectedStyleVersionId).toBe(saved.versions[0]?.id);
  expect(emit).toHaveBeenCalledExactlyOnceWith('generation.style:ready', {
    styleId: f.styleId,
    name: DRAFT.name,
  });
  expect(durableLLMCallCf).toHaveBeenCalledOnce();
});

it.each(['replacement', 'terminal'] as const)(
  'stops %s before any automatic-style persistence',
  async (change) => {
    const f = await runFixture();
    durableLLMCallCf.mockImplementationOnce(async () => {
      await db
        .update(sequences)
        .set(
          change === 'replacement'
            ? { workflowRunId: NEXT_RUN }
            : { status: 'failed' }
        )
        .where(eq(sequences.id, f.sequenceId));
      return RESPONSE;
    });
    const styleBefore = (await contents(f.sequenceId, f.styleId)).style;
    await expect(deriveAutoStyle(step, f.params)).rejects.toBeInstanceOf(
      NonRetryableError
    );
    const saved = await contents(f.sequenceId, f.styleId);
    expect(saved.style).toEqual(styleBefore);
    expect(saved.versions).toEqual([]);
    expect(saved.sequence?.selectedStyleVersionId).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  }
);

it('keeps an authorized recipe but rejects snapshot and announcement after takeover between methods', async () => {
  const f = await runFixture();
  const owned = f.scopedDb.storyboardAutoStyle({
    id: f.sequenceId,
    workflowRunId: ROOT_RUN,
  });
  vi.spyOn(f.scopedDb, 'storyboardAutoStyle').mockReturnValue({
    ...owned,
    styles: {
      setGeneratedForSequence: async (params) => {
        const result = await owned.styles.setGeneratedForSequence(params);
        await db
          .update(sequences)
          .set({ workflowRunId: NEXT_RUN })
          .where(eq(sequences.id, f.sequenceId));
        return result;
      },
    },
  });
  await expect(deriveAutoStyle(step, f.params)).rejects.toBeInstanceOf(
    NonRetryableError
  );
  const saved = await contents(f.sequenceId, f.styleId);
  expect(saved.style?.name).toBe(DRAFT.name);
  expect(saved.versions).toEqual([]);
  expect(saved.sequence?.selectedStyleVersionId).toBeNull();
  expect(emit).not.toHaveBeenCalled();
});

it('retains the original SQL failure while the root remains active', async () => {
  const f = await runFixture();
  await db.run(
    sql.raw(
      "CREATE TRIGGER synthetic_style_fault BEFORE UPDATE ON styles BEGIN SELECT RAISE(ABORT, 'Synthetic style SQL fault'); END"
    )
  );
  try {
    await expect(deriveAutoStyle(step, f.params)).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('Synthetic style SQL fault'),
      }),
    });
    expect((await contents(f.sequenceId, f.styleId)).versions).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  } finally {
    await db.run(sql.raw('DROP TRIGGER synthetic_style_fault'));
  }
});

type Output = ReturnType<WorkflowScopedDb['storyboardAutoStyle']>;
const ERROR_CASES = [
  new StoryboardContentOwnershipError(),
  new StoryboardContentOwnershipCheckError(
    new Error('Synthetic unavailable check')
  ),
  new Error('Aborting engine: Grace period complete'),
  new Error('Synthetic write error'),
];
function failingOutput(error: Error) {
  const write = vi.fn(async () => {
    throw error;
  });
  const output: Output = {
    styles: { setGeneratedForSequence: write },
    sequences: { snapshotAutoStyle: write },
  };
  const factory = vi.fn(() => output);
  const unbound = vi.fn(async () => true);
  const db = asStub<WorkflowScopedDb>({
    storyboardAutoStyle: factory,
    styles: { setGeneratedForSequence: unbound },
    sequences: { snapshotAutoStyle: unbound },
  });
  const owned = autoStyleOutput(db, 'synthetic-sequence', {
    workflowRunId: ROOT_RUN,
  });
  return { owned, factory, unbound };
}
const METHODS = ['recipe', 'snapshot'] as const;
it.each(
  ERROR_CASES.flatMap((error) => METHODS.map((method) => ({ error, method })))
)(
  'uses owned $method and preserves $error.name: $error.message',
  async ({ method, error }) => {
    const { owned, factory, unbound } = failingOutput(error);
    const result =
      method === 'recipe'
        ? owned.styles.setGeneratedForSequence({
            styleId: 'synthetic-style',
            sequenceId: 'synthetic-sequence',
            draft: DRAFT,
          })
        : owned.sequences.snapshotAutoStyle({
            id: 'synthetic-sequence',
            styleId: 'synthetic-style',
          });
    if (error instanceof StoryboardContentOwnershipError) {
      await expect(result).rejects.toBeInstanceOf(NonRetryableError);
      await expect(result).rejects.toMatchObject({
        name: error.name,
        cause: error,
      });
    } else {
      await expect(result).rejects.toBe(error);
    }
    expect(factory).toHaveBeenCalledExactlyOnceWith({
      id: 'synthetic-sequence',
      workflowRunId: ROOT_RUN,
    });
    expect(unbound).not.toHaveBeenCalled();
  }
);

it('leaves ownerless writers unchanged without constructing an ownership facade', () => {
  const setGeneratedForSequence = vi.fn();
  const snapshotAutoStyle = vi.fn();
  const factory = vi.fn();
  const db = asStub<WorkflowScopedDb>({
    storyboardAutoStyle: factory,
    styles: { setGeneratedForSequence },
    sequences: { snapshotAutoStyle },
  });
  const output = autoStyleOutput(db, 'synthetic-sequence', undefined);
  expect(output.styles.setGeneratedForSequence).toBe(setGeneratedForSequence);
  expect(output.sequences.snapshotAutoStyle).toBe(snapshotAutoStyle);
  expect(factory).not.toHaveBeenCalled();
});
