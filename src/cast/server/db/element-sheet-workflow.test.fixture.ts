import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { micros } from '@/billing/money';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  contentProvenance,
  modelUsageObservations,
  sequenceElements,
  sequences,
  user,
} from '@/platform/server/db/schema';
import { toWorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import { createTestDb } from '@/platform/server/db/test-d1';
import type {
  ElementSheetEntry,
  ElementSheetWorkflowInput,
} from '@/platform/server/workflow/types';
import { seedSpace } from '@/sequences/server/db/storyboard-content-ownership.test.fixture';
import type { GenerateImageSofteningArgs } from '@/stills/server/workflows/content-soften';
import type { ImageGenerationResult } from '@/stills/server/image-generation';
import { asStub } from '@/test/as-stub';

export const COST = micros(28_000);
export const STORED = {
  url: '/r2/mock/elements/reference.png',
  path: 'mock/elements/reference.png',
};
export const UPLOADED = {
  imageUrl: '/r2/mock/upload.mp4',
  imagePath: 'mock/upload.mp4',
};
export const INITIAL_DATE = new Date('2026-11-14T05:00:00.000Z');
const ROOT_REPLACEMENT = 'synthetic-replacement-storyboard';
export const faults = { afterGeneration: async () => {} };
let database: Database;

// Synthetic engine, provider, storage and debit; scoped SQL, usage and provenance are real.
export const debit = vi.fn<
  typeof import('@/billing/server/workflow-deduction').deductWorkflowCredits
>(async () => {});
export const store = vi.fn(async () => STORED);
export const generation = vi.fn(async (args: GenerateImageSofteningArgs) =>
  args.step.do(args.stepName, async () => {
    const result: ImageGenerationResult = {
      imageUrls: ['data:image/png;base64,c3ludGhldGlj'],
      parameters: args.params,
      generatedAt: INITIAL_DATE.toISOString(),
      processingTimeMs: 0,
      via: 'fal',
      metadata: {
        prompt: args.params.prompt,
        model: args.params.model,
        endpointId: 'synthetic-element-endpoint',
        requestId: args.workflowRunId + ':' + args.subject,
        cost: COST,
        usedOwnKey: false,
        unitsBilled: 1,
        numImages: 1,
        dimensions: [],
        file_sizes: [],
      },
    };
    const stored = await args.store(result);
    await faults.afterGeneration();
    return {
      stored,
      metadata: result.metadata,
      via: result.via,
      params: args.params,
      softened: false,
    };
  })
);
vi.doMock('#db-client', () => ({ getDb: () => database }));
vi.doMock('@/billing/server/workflow-deduction', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/billing/server/workflow-deduction')
  >()),
  deductWorkflowCredits: debit,
}));
vi.doMock('@/stills/server/image-storage', () => ({
  storeGeneratedPng: store,
}));
vi.doMock('@/stills/server/workflows/content-soften', () => ({
  generateImageSoftening: generation,
}));

const { createScopedDb } = await import('@/platform/server/db/scoped');
const { ElementSheetWorkflow } =
  await import('../workflows/element-sheet-workflow');

class ElementProbe extends ElementSheetWorkflow {
  execute(
    event: WorkflowEvent<ElementSheetWorkflowInput>,
    step: WorkflowStep,
    scope: ReturnType<typeof toWorkflowScopedDb>
  ) {
    return this.runImpl(event, step, scope);
  }
}

function fixtureEntry(): ElementSheetEntry {
  return {
    elementId: generateId(),
    token: 'MOCK_BOOK',
    description: 'Synthetic red book',
    consistencyTag: 'mock_book',
    firstMention: { sceneId: generateId(), text: 'MOCK_BOOK', lineNumber: 1 },
  };
}

async function seedWorkflowGraph(db: Database) {
  const space = await seedSpace(db);
  const userId = generateId();
  const sequenceId = generateId();
  const owner = {
    workflowRunId: 'storyboard-' + generateId(),
    workflowClaimId: generateId(),
  };
  await db.insert(user).values({
    id: userId,
    name: 'Synthetic element writer',
    email: userId + '@example.invalid',
  });
  await db.insert(sequences).values({
    id: sequenceId,
    ...space,
    title: 'Synthetic element sequence',
    status: 'processing',
    workflowRunId: owner.workflowRunId,
    updatedAt: INITIAL_DATE,
  });
  return { ...space, userId, sequenceId, owner };
}

function checkpoints() {
  const cache = new Map<string, unknown>();
  const steps: string[] = [];
  const errors = new Map<string, unknown>();
  const execute = async (name: string, callback: () => Promise<unknown>) => {
    steps.push(name);
    if (cache.has(name)) return structuredClone(cache.get(name));
    try {
      const result = await callback();
      cache.set(name, structuredClone(result));
      return result;
    } catch (error) {
      errors.set(name, error);
      throw error;
    }
  };
  return { cache, steps, errors, step: asStub<WorkflowStep>({ do: execute }) };
}

export async function elementWorkflowFixture() {
  const test = await createTestDb();
  database = test.db;
  const graph = await seedWorkflowGraph(database);
  const scope = toWorkflowScopedDb(
    createScopedDb(graph.organizationId, graph.userId)
  );
  const entry = fixtureEntry();
  const input: ElementSheetWorkflowInput = {
    userId: graph.userId,
    organizationId: graph.organizationId,
    sequenceId: graph.sequenceId,
    promptLocale: 'zh-CN',
    imageModel: 'nano_banana_2',
    entries: [entry],
    reservationId: generateId(),
    storyboardOwner: graph.owner,
  };
  const execution = checkpoints();
  const instanceId = 'synthetic-element-child-' + generateId();
  const probe = new ElementProbe(
    asStub<ConstructorParameters<typeof ElementProbe>[0]>(undefined),
    asStub<ConstructorParameters<typeof ElementProbe>[1]>({})
  );
  const run = () =>
    probe.execute(
      asStub<WorkflowEvent<ElementSheetWorkflowInput>>({
        payload: input,
        instanceId,
      }),
      execution.step,
      scope
    );
  return {
    ...test,
    ...graph,
    ...execution,
    entry,
    input,
    scope,
    instanceId,
    run,
  };
}

export type ElementFixture = Awaited<ReturnType<typeof elementWorkflowFixture>>;

export function changeRoot(fixture: ElementFixture) {
  return fixture.db
    .update(sequences)
    .set({ workflowRunId: ROOT_REPLACEMENT })
    .where(eq(sequences.id, fixture.sequenceId));
}

export function seedElement(
  fixture: ElementFixture,
  data: Partial<typeof sequenceElements.$inferInsert> = {}
) {
  return fixture.db
    .insert(sequenceElements)
    .values({
      id: fixture.entry.elementId,
      sequenceId: fixture.sequenceId,
      token: fixture.entry.token,
      uploadedFilename: 'synthetic-placeholder.png',
      updatedAt: INITIAL_DATE,
      ...data,
    })
    .returning();
}

export async function elementFacts(fixture: ElementFixture) {
  return {
    elements: await fixture.db.select().from(sequenceElements),
    provenance: await fixture.db.select().from(contentProvenance),
    usage: await fixture.db.select().from(modelUsageObservations),
  };
}

export function resetElementMocks() {
  debit.mockClear();
  generation.mockClear();
  store.mockClear();
  faults.afterGeneration = async () => {};
}

function beforeStatement(
  statement: D1PreparedStatement,
  before: () => Promise<void>
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, key) {
      if (key === 'bind')
        return (...args: unknown[]) =>
          beforeStatement(target.bind(...args), before);
      if (key === 'raw' || key === 'all' || key === 'run') {
        return async () => {
          await before();
          return target[key]();
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function beforeElementPublicationSql(
  fixture: ElementFixture,
  change: () => Promise<unknown>
) {
  const state = { fired: false };
  const before = async () => {
    if (state.fired) return;
    state.fired = true;
    await change();
  };
  const client = fixture.db.$client;
  const batch = client.batch.bind(client);
  const prepare = client.prepare.bind(client);
  vi.spyOn(client, 'batch').mockImplementationOnce(async (statements) => {
    await before();
    return batch(statements);
  });
  vi.spyOn(client, 'prepare').mockImplementation((query) => {
    const statement = prepare(query);
    return /^(update|insert into) "sequence_elements"/i.test(query)
      ? beforeStatement(statement, before)
      : statement;
  });
  return state;
}
