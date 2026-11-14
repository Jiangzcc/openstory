import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NonRetryableError } from 'cloudflare:workflows';
import { generateId } from '@/platform/id';
import { sequenceElements, sequences } from '@/platform/server/db/schema';
import { STORAGE_BUCKETS } from '@/platform/server/storage/buckets';
import {
  StoryboardContentOwnershipCheckError,
  StoryboardContentOwnershipError,
} from '@/sequences/server/db/storyboard-content-scope';
import { bindElementSheetOutput } from './element-sheet-output';
import { MAX_AUTO_ELEMENTS } from './cast-records';
import {
  COST,
  INITIAL_DATE,
  STORED,
  UPLOADED,
  beforeElementPublicationSql,
  changeRoot,
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
    'check-element-sheet-completion',
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

it('admits the explicitly trusted raw claim without treating the child ID as its owner', async () => {
  await fixture.db
    .update(sequences)
    .set({ workflowRunId: fixture.owner.workflowClaimId })
    .where(eq(sequences.id, fixture.sequenceId));
  await expect(fixture.run()).resolves.toEqual({
    elements: [expect.objectContaining({ imageUrl: STORED.url })],
  });
});

it('rejects a lost root before generation inside the existing preflight step', async () => {
  await changeRoot(fixture);
  await expect(fixture.run()).rejects.toBeInstanceOf(NonRetryableError);
  expect(fixture.errors.get('check-existing-element-0')).toBeInstanceOf(
    NonRetryableError
  );
  expect(generation).not.toHaveBeenCalled();
  expect(debit).not.toHaveBeenCalled();
});

it('records spent usage and provenance before rejecting publication after a takeover', async () => {
  faults.afterGeneration = async () => {
    await changeRoot(fixture);
  };
  await expect(fixture.run()).rejects.toBeInstanceOf(NonRetryableError);
  const error = fixture.errors.get('ingest-element-0');
  expect(error).toBeInstanceOf(NonRetryableError);
  expect(error).toHaveProperty(
    'cause',
    expect.any(StoryboardContentOwnershipError)
  );
  const facts = await elementFacts(fixture);
  expect(facts.elements).toEqual([]);
  expectCostAndProvenance(facts);
});

it('does not lose accounting when replay resumes from a cached generation after takeover', async () => {
  debit.mockRejectedValueOnce(new Error('Synthetic debit interruption'));
  await expect(fixture.run()).rejects.toThrow('Synthetic debit interruption');
  await changeRoot(fixture);
  debit.mockClear();
  await expect(fixture.run()).rejects.toBeInstanceOf(NonRetryableError);
  expect(generation).toHaveBeenCalledTimes(2);
  expect(store).toHaveBeenCalledTimes(1);
  const facts = await elementFacts(fixture);
  expect(facts.elements).toEqual([]);
  expectCostAndProvenance(facts);
});

it('rejects a deleted identity after spend without resurrecting it', async () => {
  await seedElement(fixture);
  faults.afterGeneration = async () => {
    await fixture.db
      .update(sequenceElements)
      .set({ deletedAt: new Date() })
      .where(eq(sequenceElements.id, fixture.entry.elementId));
  };
  await expect(fixture.run()).rejects.toThrow();
  const facts = await elementFacts(fixture);
  expect(facts.elements[0]?.imageUrl).toBeNull();
  expect(facts.elements[0]?.deletedAt).toBeInstanceOf(Date);
  expectCostAndProvenance(facts);
});

it('rejects a tombstoned ID rather than falling back to an uploaded token', async () => {
  await seedElement(fixture, { deletedAt: new Date(), token: 'OLD' });
  await seedElement(fixture, { id: generateId(), ...UPLOADED });
  await expect(fixture.run()).rejects.toThrow(
    'Generated sequence element is unavailable'
  );
  expect(generation).not.toHaveBeenCalled();
});

it('validates sequence organization before returning an uploaded element', async () => {
  await seedElement(fixture, UPLOADED);
  fixture.input.sequenceId = generateId();
  delete fixture.input.storyboardOwner;
  await expect(fixture.run()).rejects.toThrow('Sequence not found');
  expect(generation).not.toHaveBeenCalled();
  expect(debit).not.toHaveBeenCalled();
});

it('rejects a foreign-sequence ID even when the requested token exists locally', async () => {
  await seedElement(fixture, { id: generateId(), ...UPLOADED });
  const otherSequenceId = generateId();
  await fixture.db.insert(sequences).values({
    id: otherSequenceId,
    organizationId: fixture.organizationId,
    styleId: fixture.styleId,
    title: 'Synthetic other sequence',
  });
  await seedElement(fixture, { sequenceId: otherSequenceId, ...UPLOADED });
  await expect(fixture.run()).rejects.toThrow(
    'Generated sequence element is unavailable'
  );
  expect(generation).not.toHaveBeenCalled();
});

it('keeps the ownerless standalone entry point while using atomic publication', async () => {
  delete fixture.input.storyboardOwner;
  await changeRoot(fixture);
  await expect(fixture.run()).resolves.toEqual({
    elements: [expect.objectContaining({ imageUrl: STORED.url })],
  });
  expect(fixture.steps).not.toContain('check-element-sheet-completion');
});

it('checks an empty root-bound completion without manufacturing generation or cost', async () => {
  fixture.input.entries = [];
  await changeRoot(fixture);
  await expect(fixture.run()).rejects.toBeInstanceOf(NonRetryableError);
  expect(fixture.steps).toEqual(['check-element-sheet-completion']);
  expect(generation).not.toHaveBeenCalled();
  expect(debit).not.toHaveBeenCalled();
});

it('checks a root after cached element steps without writing their old result again', async () => {
  const original = await fixture.run();
  fixture.cache.delete('check-element-sheet-completion');
  await changeRoot(fixture);
  await expect(fixture.run()).rejects.toBeInstanceOf(NonRetryableError);
  expect(debit).toHaveBeenCalledTimes(1);
  expect((await elementFacts(fixture)).elements[0]?.id).toBe(
    original.elements[0]?.id
  );
});

it('preserves retryable ownership-check causes and engine-abort identity across allSettled', async () => {
  const bound = fixture.scope.storyboardElementSheets({
    id: fixture.sequenceId,
    ...fixture.owner,
  });
  const cause = new Error('Synthetic ownership read outage');
  const errors = [
    new StoryboardContentOwnershipCheckError(cause),
    new Error('Aborting engine: Grace period complete'),
  ];
  vi.spyOn(fixture.scope, 'storyboardElementSheets').mockReturnValue(bound);
  const check = vi.spyOn(bound, 'withOwnership');
  for (const error of errors) {
    check.mockRejectedValueOnce(error);
    await expect(fixture.run()).rejects.toBe(error);
    expect(fixture.errors.get('check-existing-element-0')).toBe(error);
  }
  expect(errors[0]).toHaveProperty('cause', cause);
  expect(generation).not.toHaveBeenCalled();
});

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

it('binds only explicit owners or real Storyboard parent metadata', async () => {
  delete fixture.input.storyboardOwner;
  const bind = vi.spyOn(fixture.scope, 'storyboardElementSheets');
  fixture.input._parent = {
    bindingName: 'STORYBOARD_WORKFLOW',
    parentInstanceId: fixture.owner.workflowRunId,
    eventType: 'synthetic-child-done',
  };
  bindElementSheetOutput(fixture.scope, fixture.input);
  expect(bind).toHaveBeenCalledExactlyOnceWith({
    id: fixture.sequenceId,
    workflowRunId: fixture.owner.workflowRunId,
  });
  bind.mockClear();
  fixture.input._parent.bindingName = 'UPDATE_STALE_SHOTS_WORKFLOW';
  bindElementSheetOutput(fixture.scope, fixture.input);
  expect(bind).not.toHaveBeenCalled();
});

it('preserves an upload arriving after the last empty read at publication SQL', async () => {
  await seedElement(fixture);
  const boundary = beforeElementPublicationSql(fixture, () =>
    fixture.db
      .update(sequenceElements)
      .set({ ...UPLOADED, kind: 'video', personInMedia: true })
      .where(eq(sequenceElements.id, fixture.entry.elementId))
  );
  await expect(fixture.run()).resolves.toHaveProperty(
    'elements.0.imageUrl',
    UPLOADED.imageUrl
  );
  expect(boundary.fired).toBe(true);
  const facts = await elementFacts(fixture);
  expect(facts.elements[0]).toEqual(
    expect.objectContaining({ ...UPLOADED, kind: 'video', personInMedia: true })
  );
  expectCostAndProvenance(facts);
});

it('reuses a token uploaded after the last missing read at publication SQL', async () => {
  const uploadId = generateId();
  const boundary = beforeElementPublicationSql(fixture, () =>
    seedElement(fixture, { id: uploadId, ...UPLOADED })
  );
  await expect(fixture.run()).resolves.toHaveProperty(
    'elements.0.id',
    uploadId
  );
  expect(boundary.fired).toBe(true);
  const facts = await elementFacts(fixture);
  expect(facts.elements).toHaveLength(1);
  expect(facts.elements[0]?.imageUrl).toBe(UPLOADED.imageUrl);
  expectCostAndProvenance(facts);
});

it('refuses a root lost after all prechecks at publication SQL', async () => {
  await seedElement(fixture);
  const boundary = beforeElementPublicationSql(fixture, () =>
    changeRoot(fixture)
  );
  await expect(fixture.run()).rejects.toBeInstanceOf(NonRetryableError);
  expect(boundary.fired).toBe(true);
  const facts = await elementFacts(fixture);
  expect(facts.elements[0]?.imageUrl).toBeNull();
  expectCostAndProvenance(facts);
});
