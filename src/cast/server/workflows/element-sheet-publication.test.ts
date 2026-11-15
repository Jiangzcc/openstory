import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateId } from '@/platform/id';
import { STORAGE_BUCKETS } from '@/platform/server/storage/buckets';
import { MAX_AUTO_ELEMENTS } from './cast-records';
import {
  COST,
  INITIAL_DATE,
  STORED,
  UPLOADED,
  debit,
  elementFacts,
  elementWorkflowFixture,
  faults,
  generation,
  resetElementMocks,
  seedElement,
  store,
} from '../db/element-sheet-workflow.test.fixture';
import type { ElementFixture } from '../db/element-sheet-workflow.test.fixture';

let fixture: ElementFixture;
beforeEach(async () => {
  resetElementMocks();
  fixture = await elementWorkflowFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.close();
});

function expectCostAndProvenance(
  facts: Awaited<ReturnType<typeof elementFacts>>
) {
  expect(debit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      scopedDb: fixture.scope,
      costMicros: COST,
      usedOwnKey: false,
      idempotencyKey: fixture.instanceId + ':element-ref-0',
      reservationId: fixture.input.reservationId,
      workflowName: 'ElementSheetWorkflow',
      metadata: expect.objectContaining({
        token: fixture.entry.token,
        sequenceId: fixture.sequenceId,
      }),
    })
  );
  expect(facts.provenance).toEqual([
    expect.objectContaining({
      assetKind: 'element_sheet',
      assetId: fixture.entry.elementId,
      storageKey: STORED.path,
      workflowRunId: fixture.instanceId,
      organizationId: fixture.organizationId,
      sequenceId: fixture.sequenceId,
      provider: 'fal',
      model: fixture.input.imageModel,
    }),
  ]);
  expect(facts.usage).toHaveLength(1);
}

function expectGenerationContract() {
  expect(generation).toHaveBeenCalledWith(
    expect.objectContaining({
      promptLocale: 'zh-CN',
      sequenceId: fixture.sequenceId,
      workflowRunId: fixture.instanceId,
      params: expect.objectContaining({
        model: 'nano_banana_2',
        imageSize: 'square_hd',
        numImages: 1,
      }),
    })
  );
  expect(store).toHaveBeenCalledWith(
    expect.stringContaining('data:image/png'),
    STORAGE_BUCKETS.ELEMENTS,
    expect.stringMatching(
      new RegExp(
        `^${fixture.organizationId}/${fixture.sequenceId}/[0-9A-HJKMNP-TV-Z]{26}\\.png$`
      )
    )
  );
}

it('publishes a new reference with original generation, durable steps and accounting identities', async () => {
  const result = await fixture.run();
  const facts = await elementFacts(fixture);
  expect(facts.elements).toEqual([
    expect.objectContaining({
      id: fixture.entry.elementId,
      token: fixture.entry.token,
      imageUrl: STORED.url,
      imagePath: STORED.path,
      description: fixture.entry.description,
      visionStatus: 'completed',
      kind: 'image',
      personInMedia: false,
      durationSeconds: null,
      firstMentionText: fixture.entry.firstMention.text,
    }),
  ]);
  expect(result.elements[0]).toEqual(
    expect.objectContaining({
      id: fixture.entry.elementId,
      imageUrl: STORED.url,
    })
  );
  expectCostAndProvenance(facts);
  expect(fixture.steps).toEqual([
    'check-existing-element-0',
    'generate-element-image-0',
    'record-fal-usage-0',
    'deduct-credits-0',
    'record-provenance-0',
    'ingest-element-0',
  ]);
  expectGenerationContract();
});

it('fills only placeholder storage and keeps its renamed identity and metadata', async () => {
  const [before] = await seedElement(fixture, {
    token: 'RENAMED_BOOK',
    description: 'Writer description',
    visionStatus: 'pending',
    firstMentionText: 'Writer first mention',
  });
  const result = await fixture.run();
  const [after] = (await elementFacts(fixture)).elements;
  expect(after).toEqual({
    ...before,
    imageUrl: STORED.url,
    imagePath: STORED.path,
    updatedAt: expect.any(Date),
  });
  expect(result.elements[0]?.token).toBe('RENAMED_BOOK');
});

it.each(['id', 'token'] as const)(
  'reuses an existing uploaded reference by %s without generation or spend',
  async (identity) => {
    const [row] = await seedElement(fixture, {
      ...(identity === 'token' ? { id: generateId() } : { token: 'RENAMED' }),
      ...UPLOADED,
      kind: 'video',
      durationSeconds: 3,
      personInMedia: true,
    });
    const result = await fixture.run();
    expect(result.elements).toEqual([
      expect.objectContaining({
        id: row?.id,
        token: row?.token,
        imageUrl: UPLOADED.imageUrl,
        kind: 'video',
        durationSeconds: 3,
        personInMedia: true,
      }),
    ]);
    expect(generation).not.toHaveBeenCalled();
    expect(debit).not.toHaveBeenCalled();
    expect((await elementFacts(fixture)).provenance).toEqual([]);
  }
);

it.each(['id', 'token'] as const)(
  'preserves an uploaded %s winner after generation while retaining incurred cost and provenance',
  async (identity) => {
    faults.afterGeneration = async () => {
      await seedElement(fixture, {
        ...(identity === 'token' ? { id: generateId() } : {}),
        ...UPLOADED,
        kind: 'audio',
        durationSeconds: 4,
        personInMedia: true,
        description: 'Uploaded by writer',
      });
    };
    const result = await fixture.run();
    const facts = await elementFacts(fixture);
    expect(result.elements).toEqual([
      expect.objectContaining({
        imageUrl: UPLOADED.imageUrl,
        kind: 'audio',
        durationSeconds: 4,
        personInMedia: true,
        description: 'Uploaded by writer',
      }),
    ]);
    expect(facts.elements).toHaveLength(1);
    expect(facts.elements[0]?.updatedAt).toEqual(INITIAL_DATE);
    expectCostAndProvenance(facts);
  }
);

it('stops publication when provenance fails after debit', async () => {
  vi.spyOn(fixture.scope.provenance, 'record').mockRejectedValueOnce(
    new Error('Synthetic provenance interruption')
  );
  await expect(fixture.run()).rejects.toThrow(
    'Synthetic provenance interruption'
  );
  expect(debit).toHaveBeenCalledTimes(1);
  expect((await elementFacts(fixture)).elements).toEqual([]);
  expect(fixture.steps).not.toContain('ingest-element-0');
});

it('caps entries and lets sibling pipelines finish before ordinary failure aggregation', async () => {
  fixture.input.entries = Array.from(
    { length: MAX_AUTO_ELEMENTS + 1 },
    (_, index) => ({
      ...fixture.entry,
      elementId: generateId(),
      token: `ITEM_${index}`,
    })
  );
  generation.mockRejectedValueOnce(
    new Error('Synthetic one-entry provider failure')
  );
  await expect(fixture.run()).rejects.toThrow(`1/${MAX_AUTO_ELEMENTS}`);
  expect(generation).toHaveBeenCalledTimes(MAX_AUTO_ELEMENTS);
  expect((await elementFacts(fixture)).elements).toHaveLength(
    MAX_AUTO_ELEMENTS - 1
  );
  expect(debit).toHaveBeenCalledTimes(MAX_AUTO_ELEMENTS - 1);
});
