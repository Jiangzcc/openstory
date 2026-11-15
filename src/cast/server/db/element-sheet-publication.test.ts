import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import type { Database } from '@/platform/server/db/client';
import { sequenceElements } from '@/platform/server/db/schema';
import type { SequenceElement } from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import type { GeneratedElementPublication } from './element-sheet-publication';
import { createElementSheetPublicationMethods } from './element-sheet-publication';
import {
  COUNT,
  KIND,
  MEDIA,
  MOMENT,
  SQL_FAULT,
  SQL_TARGET,
  STATUS,
  VISION,
  afterMutation,
  beforeBatch,
  dropFault,
  elementById,
  elementsSnapshot,
  failSql,
  failureFrom,
  observeStatements,
  publicationInput,
  seedElement,
  seedPublicationGraph,
  setRoot,
} from './element-sheet-publication.test.fixture';
import type { Graph } from './element-sheet-publication.test.fixture';
import { generateId } from '@/platform/id';

let db: Database;
let closeDb: () => Promise<void>;
let graph: Graph;
vi.doMock('#db-client', () => ({ getDb: () => db }));
const { createScopedDb } = await import('@/platform/server/db/scoped');

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  graph = await seedPublicationGraph(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dropFault(db);
});

function ordinary(organizationId = graph.organizationId) {
  return createScopedDb(organizationId, graph.userId).sequenceElements;
}

it('returns the complete typed row with generated metadata and schema defaults', async () => {
  const data = publicationInput(graph);
  const row = await ordinary().publishGenerated(data);
  expectTypeOf(row).toEqualTypeOf<SequenceElement>();
  expect(row).toMatchObject({
    ...data,
    kind: KIND.image,
    personInMedia: false,
    durationSeconds: null,
    visionError: null,
    deletedAt: null,
  });
  expect(row.visionGeneratedAt).toBeInstanceOf(Date);
  expect(row.createdAt).toBeInstanceOf(Date);
  expect(row.updatedAt).toBeInstanceOf(Date);
  expect(row.personInMedia).toBe(false);
  expect(await elementById(db, data.id)).toEqual([row]);
});

it('keeps publication input limited to generated fields', () => {
  expectTypeOf<keyof GeneratedElementPublication>().toEqualTypeOf<
    | 'sequenceId'
    | 'uploadedFilename'
    | 'token'
    | 'description'
    | 'consistencyTag'
    | 'visionStatus'
    | 'visionGeneratedAt'
    | 'firstMentionSceneId'
    | 'firstMentionText'
    | 'firstMentionLine'
    | 'id'
    | 'imageUrl'
    | 'imagePath'
  >();
});

it('retains initial defaults when optional generated metadata is omitted', async () => {
  const { id, sequenceId, token, uploadedFilename, imageUrl, imagePath } =
    publicationInput(graph);
  const row = await ordinary().publishGenerated({
    id,
    sequenceId,
    token,
    uploadedFilename,
    imageUrl,
    imagePath,
  });
  expect(row).toMatchObject({
    kind: KIND.image,
    personInMedia: false,
    visionStatus: VISION.pending,
    description: null,
    consistencyTag: null,
    visionGeneratedAt: null,
    firstMentionSceneId: null,
    firstMentionText: null,
    firstMentionLine: null,
    durationSeconds: null,
    visionError: null,
    deletedAt: null,
  });
});

it.each([null, ''])(
  'fills an image=%s placeholder without changing its metadata',
  async (imageUrl) => {
    const data = publicationInput(graph);
    const placeholder = await seedElement(db, data, {
      token: 'RENAMED',
      imageUrl,
      imagePath: 'synthetic/old-path',
      kind: KIND.video,
      durationSeconds: 1.25,
      personInMedia: true,
      uploadedFilename: 'original.mov',
      description: 'original description',
      consistencyTag: 'original-tag',
      visionStatus: VISION.failed,
      visionError: 'original error',
      visionGeneratedAt: MOMENT.original,
      firstMentionSceneId: generateId(),
      firstMentionText: 'original mention',
      firstMentionLine: COUNT.two,
    });
    const row = await ordinary().publishGenerated(data);
    const {
      imageUrl: oldUrl,
      imagePath: oldPath,
      updatedAt: oldTime,
      ...metadata
    } = placeholder;
    expect(row).toEqual({
      ...metadata,
      imageUrl: data.imageUrl,
      imagePath: data.imagePath,
      updatedAt: row.updatedAt,
    });
    expect(row.updatedAt.getTime()).toBeGreaterThan(oldTime.getTime());
    expect(oldUrl).toBe(imageUrl);
    expect(oldPath).toBe('synthetic/old-path');
  }
);

it('prefers an existing ID through rename and replay even when the original token is occupied', async () => {
  const data = publicationInput(graph);
  const renamed = await seedElement(db, data, {
    token: 'RENAMED',
    imageUrl: MEDIA.uploaded,
    imagePath: MEDIA.uploadPath,
  });
  await seedElement(db, { ...data, id: generateId() });
  const before = await elementsSnapshot(db);
  expect(await ordinary().publishGenerated(data)).toEqual(renamed);
  expect(await ordinary().publishGenerated(data)).toEqual(renamed);
  expect(await elementsSnapshot(db)).toEqual(before);
});

it('fills the renamed ID rather than a different row holding the old token', async () => {
  const data = publicationInput(graph);
  const renamed = await seedElement(db, data, { token: 'RENAMED' });
  const tokenRow = await seedElement(
    db,
    { ...data, id: generateId() },
    { imageUrl: MEDIA.uploaded }
  );
  const result = await ordinary().publishGenerated(data);
  expect(result).toMatchObject({
    id: renamed.id,
    token: renamed.token,
    imageUrl: MEDIA.generated,
  });
  expect(await elementById(db, tokenRow.id)).toEqual([tokenRow]);
});

it.each([null, MEDIA.uploaded])(
  'falls back to token image=%s only when ID is absent',
  async (imageUrl) => {
    const data = publicationInput(graph);
    const tokenRow = await seedElement(
      db,
      { ...data, id: generateId() },
      { imageUrl, imagePath: MEDIA.uploadPath }
    );
    const row = await ordinary().publishGenerated(data);
    expect(row.id).toBe(tokenRow.id);
    expect(row.imageUrl).toBe(imageUrl ?? MEDIA.generated);
    expect(await elementById(db, data.id)).toEqual([]);
  }
);

it.each(['id', 'token'] as const)(
  'rejects a tombstoned %s without resurrection or fallback',
  async (identity) => {
    const data = publicationInput(graph);
    await seedElement(db, data, {
      id: identity === 'id' ? data.id : generateId(),
      token: identity === 'id' ? 'DELETED_RENAMED' : data.token,
      deletedAt: MOMENT.original,
    });
    if (identity === 'id') await seedElement(db, { ...data, id: generateId() });
    const before = await elementsSnapshot(db);
    await expect(ordinary().publishGenerated(data)).rejects.toThrow();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it.each(['sibling', 'foreign'] as const)(
  'rejects an ID owned by %s even with our token candidate',
  async (space) => {
    const data = publicationInput(graph);
    await seedElement(
      db,
      { ...data, sequenceId: graph[space].sequenceId },
      { imageUrl: MEDIA.uploaded }
    );
    await seedElement(db, { ...data, id: generateId() });
    const before = await elementsSnapshot(db);
    await expect(ordinary().publishGenerated(data)).rejects.toThrow();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it.each(['missing', 'foreign', 'foreign caller'] as const)(
  'rejects %s sequence admission',
  async (target) => {
    const data = publicationInput(graph);
    if (target === 'missing') data.sequenceId = generateId();
    if (target === 'foreign') data.sequenceId = graph.foreign.sequenceId;
    const caller =
      target === 'foreign caller'
        ? graph.foreign.organizationId
        : graph.organizationId;
    const before = await elementsSnapshot(db);
    await expect(ordinary(caller).publishGenerated(data)).rejects.toThrow();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it('allows ordinary publication to another sequence in the same organization', async () => {
  const row = await ordinary().publishGenerated(
    publicationInput(graph.sibling)
  );
  expect(row.sequenceId).toBe(graph.sibling.sequenceId);
});

it.each(['upload', 'generated', 'placeholder'] as const)(
  'resolves a token %s race at batch execution',
  async (race) => {
    const data = publicationInput(graph);
    let winner: SequenceElement | undefined;
    beforeBatch(db, async () => {
      winner = await seedElement(
        db,
        { ...data, id: generateId() },
        {
          imageUrl: race === 'placeholder' ? null : MEDIA.uploaded,
          imagePath: MEDIA.uploadPath,
        }
      );
    });
    const row = await ordinary().publishGenerated(data);
    expect(row.id).toBe(winner?.id);
    expect(row.imageUrl).toBe(
      race === 'placeholder' ? MEDIA.generated : MEDIA.uploaded
    );
    expect(await elementById(db, data.id)).toEqual([]);
  }
);

it('does not overwrite an upload that fills the chosen placeholder before batch execution', async () => {
  const data = publicationInput(graph);
  await seedElement(db, data);
  beforeBatch(db, () =>
    db
      .update(sequenceElements)
      .set({
        imageUrl: MEDIA.uploaded,
        imagePath: MEDIA.uploadPath,
      })
      .where(eq(sequenceElements.id, data.id))
  );
  const row = await ordinary().publishGenerated(data);
  expect(row).toMatchObject({
    imageUrl: MEDIA.uploaded,
    imagePath: MEDIA.uploadPath,
  });
});

it('converges competing generated publications without token errors or replacement', async () => {
  const first = publicationInput(graph);
  const second = {
    ...first,
    id: generateId(),
    imageUrl: MEDIA.competing,
    imagePath: MEDIA.competingPath,
  };
  const [a, b] = await Promise.all([
    ordinary().publishGenerated(first),
    ordinary().publishGenerated(second),
  ]);
  expect(a).toEqual(b);
  expect(a.imageUrl).toBe(first.imageUrl);
  expect(await elementById(db, second.id)).toEqual([]);
});

it('preserves the generated winner on concurrent placeholder fills', async () => {
  const first = publicationInput(graph);
  await seedElement(db, first);
  const second = {
    ...first,
    imageUrl: MEDIA.competing,
    imagePath: MEDIA.competingPath,
  };
  const [a, b] = await Promise.all([
    ordinary().publishGenerated(first),
    ordinary().publishGenerated(second),
  ]);
  expect(a).toEqual(b);
  expect(a.imageUrl).toBe(first.imageUrl);
});

it('uses one three-statement D1 batch within the bound limit', async () => {
  const calls = observeStatements(db);
  const batch = vi.spyOn(db.$client, 'batch');
  await createElementSheetPublicationMethods(
    db,
    graph.organizationId
  ).publishGenerated(publicationInput(graph));
  expect(batch).toHaveBeenCalledTimes(COUNT.one);
  expect(calls).toHaveLength(COUNT.statements);
  expect(calls.map((call) => call.sql)).toEqual([
    expect.stringMatching(SQL_TARGET.update),
    expect.stringMatching(SQL_TARGET.insert),
    expect.stringMatching(SQL_TARGET.read),
  ]);
  for (const call of calls)
    expect(call.params.length).toBeLessThanOrEqual(COUNT.boundLimit);
});

it.each(['INSERT', 'UPDATE'] as const)(
  'propagates %s failures without fabricated output',
  async (operation) => {
    const data = publicationInput(graph);
    if (operation === 'UPDATE') await seedElement(db, data);
    await failSql(db, operation);
    const before = await elementsSnapshot(db);
    const error = await failureFrom(() => ordinary().publishGenerated(data));
    expect(error.message).toContain(SQL_FAULT.message);
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it.each(['INSERT', 'UPDATE'] as const)(
  'rolls back %s when the final target becomes unavailable',
  async (operation) => {
    const data = publicationInput(graph);
    if (operation === 'UPDATE') await seedElement(db, data);
    await afterMutation(
      db,
      operation,
      'UPDATE sequence_elements SET deleted_at = 1 WHERE id = NEW.id'
    );
    const before = await elementsSnapshot(db);
    await expect(ordinary().publishGenerated(data)).rejects.toThrow();
    expect(await elementsSnapshot(db)).toEqual(before);
  }
);

it('rolls back a successful placeholder fill if a later statement fails', async () => {
  const data = publicationInput(graph);
  await seedElement(db, data);
  await failSql(db, 'INSERT');
  await afterMutation(
    db,
    'UPDATE',
    'DELETE FROM sequence_elements WHERE id = NEW.id'
  );
  const before = await elementsSnapshot(db);
  const error = await failureFrom(() => ordinary().publishGenerated(data));
  expect(error.message).toContain(SQL_FAULT.message);
  expect(await elementsSnapshot(db)).toEqual(before);
});

it('does not suppress an unrelated uniqueness error', async () => {
  const data = publicationInput(graph);
  const other = await seedElement(db, {
    ...data,
    id: generateId(),
    token: 'OTHER',
  });
  await afterMutation(
    db,
    'INSERT',
    `UPDATE sequence_elements SET token = NEW.token WHERE id = '${other.id}'`
  );
  const before = await elementsSnapshot(db);
  const error = await failureFrom(() => ordinary().publishGenerated(data));
  expect(error.message).toContain('UNIQUE constraint failed');
  expect(await elementsSnapshot(db)).toEqual(before);
});

it('keeps ownerless publication independent of root status', async () => {
  await setRoot(db, graph, { status: STATUS.failed, workflowRunId: null });
  const row = await ordinary().publishGenerated(publicationInput(graph));
  expect(row.sequenceId).toBe(graph.sequenceId);
});

it('keeps the existing ordinary CRUD factory methods available', async () => {
  const data = publicationInput(graph);
  const row = await ordinary().create(data);
  expect(await ordinary().getById(row.id)).toEqual(row);
  const updated = await ordinary().update(row.id, {
    description: 'ordinary update',
  });
  expect(updated.description).toBe('ordinary update');
});
