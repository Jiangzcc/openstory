import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { CharacterSheetWorkflowInput } from '@/platform/server/workflow/types';
import {
  organization,
  sequenceCast,
  sequenceEvents,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { DEFAULT_IMAGE_MODEL } from '@/models/models';
import { PHOTOREAL_RENDERING } from '@/cast/rendering';
import { characterToBible } from '@/cast/server/bibles-from-scoped';
import { asStub } from '@/test/as-stub';
import { createCharactersMethods } from './characters';
import { createCharacterLooksMethods } from './character-looks';
import { createCharacterSheetVariantsMethods } from './character-sheet-variants';

const generateImage = vi.fn(async () => ({
  imageUrls: ['https://provider.invalid/mock-sheet.png'],
  metadata: { usedOwnKey: false, requestId: 'mock-request' },
  via: 'fal',
}));
const storeImage = vi.fn(
  async (_url: string, bucket: string, path: string) => ({
    url: `/r2/${bucket}/${path}`,
    path,
  })
);
const emit = vi.fn(async (_event: string, _payload: unknown) => undefined);
const getChannel = vi.fn((_channelId: string) => ({ emit }));
const triggerPortrait = vi.fn(async () => undefined);

// Only external effects are replaced; the workflow and D1 claim writers stay real.
vi.doMock('@/stills/server/image-generation', () => ({
  generateImageWithProvider: generateImage,
}));
vi.doMock('@/stills/server/image-storage', () => ({
  storeGeneratedPng: storeImage,
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: vi.fn(async () => undefined),
  extractImageCost: () => 0,
  recordFalUsageStep: vi.fn(async () => ({})),
}));
vi.doMock('@/platform/server/compliance/provenance', () => ({
  recordProvenance: vi.fn(async () => undefined),
}));
vi.doMock('@/platform/realtime', () => ({ getGenerationChannel: getChannel }));
vi.doMock('@/cast/server/sheets/sheet-portrait-trigger', () => ({
  triggerSheetPortrait: triggerPortrait,
}));

const { CharacterSheetWorkflow } =
  await import('../workflows/character-sheet-workflow');
const { computeCharacterSheetHashFromDto } =
  await import('../workflows/sheet-snapshots');

class SheetProbe extends CharacterSheetWorkflow {
  runBody(
    event: Readonly<WorkflowEvent<CharacterSheetWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

let db: Database;
let closeDb: () => Promise<void>;
let fixture: Awaited<ReturnType<typeof seedCharacter>>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => await closeDb());
beforeEach(async () => {
  vi.clearAllMocks();
  fixture = await seedCharacter();
});

async function seedCharacter() {
  const organizationId = generateId();
  const actorId = generateId();
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Cast', slug: organizationId });
  await db.insert(user).values({
    id: actorId,
    name: 'Writer',
    email: actorId + '@example.invalid',
  });
  const characters = createCharactersMethods(db, organizationId);
  const looks = createCharacterLooksMethods(db, organizationId);
  const variants = createCharacterSheetVariantsMethods(db, organizationId);
  const character = await characters.createForOrganization(
    { name: 'Ada', rendering: PHOTOREAL_RENDERING, standardClothing: 'coat' },
    { createdBy: actorId }
  );
  return { organizationId, actorId, characters, looks, variants, character };
}

async function frozenRun() {
  const character = await fixture.characters.getCurrent(fixture.character.id);
  if (!character) throw new Error('Missing fixture character');
  const look = character.looks.find((entry) => entry.isDefault);
  if (!look) throw new Error('Missing fixture default look');
  const claim = await fixture.looks.claimSheet(
    look.id,
    {
      lookVersionId: look.lookVersionId,
      bibleVersionId: character.selectedBibleVersionId,
    },
    { markGenerating: true, activity: null }
  );
  expect(claim.held).toBe(true);
  const input: Omit<CharacterSheetWorkflowInput, 'snapshotInputHash'> = {
    promptLocale: 'en',
    userId: fixture.actorId,
    organizationId: fixture.organizationId,
    sequenceId: null,
    characterDbId: character.id,
    characterName: character.name,
    characterMetadata: characterToBible(character),
    lookId: look.id,
    lookVersionId: look.lookVersionId,
    lookStyling: look.styling,
    face: null,
    referencePhotoUrl: null,
    bibleVersionId: character.selectedBibleVersionId,
    imageModel: DEFAULT_IMAGE_MODEL,
    sheetVersionId: claim.versionId,
  };
  return {
    ...input,
    sheetVersionId: claim.versionId,
    snapshotInputHash: await computeCharacterSheetHashFromDto(input),
  };
}

function workflowDb(): WorkflowScopedDb {
  return asStub<WorkflowScopedDb>({
    models: DEFAULT_MODEL_CONFIGURATION,
    characters: fixture.characters,
    characterLooks: fixture.looks,
    characterSheetVariants: fixture.variants,
    liveRead: { compliance: { listEnforcementFor: vi.fn(async () => []) } },
  });
}

function runSheet(input: CharacterSheetWorkflowInput) {
  type Ctor = ConstructorParameters<typeof SheetProbe>;
  const workflow = new SheetProbe(
    asStub<Ctor[0]>(undefined),
    asStub<Ctor[1]>({})
  );
  const event: Readonly<WorkflowEvent<CharacterSheetWorkflowInput>> = {
    payload: input,
    instanceId: generateId(),
    workflowName: 'character-sheet',
    timestamp: new Date(),
  };
  // Steps execute once in process; durable replay and R2 transport are not simulated.
  const step = asStub<WorkflowStep>({
    do: async (_name: string, run: () => Promise<unknown>) => await run(),
  });
  return workflow.runBody(event, step, workflowDb());
}

async function expectNoSequenceWrites() {
  expect(await db.select().from(sequenceCast)).toEqual([]);
  expect(await db.select().from(sequenceEvents)).toEqual([]);
}

function expectOwnChannel() {
  expect(getChannel).toHaveBeenCalled();
  expect(
    getChannel.mock.calls.every(
      ([id]) => id === 'character:' + fixture.character.id
    )
  ).toBe(true);
}

it('stores and promotes a no-sequence sheet under its organization and reports on its own channel', async () => {
  const input = await frozenRun();
  const result = await runSheet(input);
  expect(result.diverged).toBeUndefined();
  expect(result.sheetVersionId).toBe(input.sheetVersionId);
  expect(result.sheetImagePath).toMatch(
    new RegExp(
      '^org/' +
        fixture.organizationId +
        '/characters/' +
        fixture.character.id +
        '/[^/]+[.]png$'
    )
  );
  const current = await fixture.characters.getCurrent(fixture.character.id);
  expect(current).toMatchObject({
    organizationId: fixture.organizationId,
    selectedSheetVersionId: input.sheetVersionId,
    sheetImagePath: result.sheetImagePath,
    pendingPromoteSheetVersionId: null,
  });
  const version = await fixture.variants.getById(input.sheetVersionId);
  expect(version).toMatchObject({
    characterId: fixture.character.id,
    lookId: fixture.character.id,
    divergedAt: null,
  });
  expectOwnChannel();
  expect(emit).toHaveBeenCalledWith(
    'generation.character-sheet:progress',
    expect.objectContaining({
      characterId: fixture.character.id,
      status: 'completed',
    })
  );
  expect(
    emit.mock.calls.some(([event]) => event === 'generation.stale:detected')
  ).toBe(false);
  await expectNoSequenceWrites();
});

it('parks a late no-sequence run after an independent-page edit, preserving the selected sheet and its channel', async () => {
  const first = await frozenRun();
  await runSheet(first);
  const old = await frozenRun();
  await fixture.characters.updateBible(
    null,
    fixture.character.id,
    { physicalDescription: 'The writer changed her description' },
    { source: 'edit', actorId: fixture.actorId }
  );
  vi.clearAllMocks();
  const result = await runSheet(old);
  expect(result.diverged).toBe(true);
  expect(
    await fixture.characters.getCurrent(fixture.character.id)
  ).toMatchObject({
    selectedSheetVersionId: first.sheetVersionId,
    physicalDescription: 'The writer changed her description',
    pendingPromoteSheetVersionId: null,
  });
  const parked = await fixture.variants.getById(old.sheetVersionId);
  expect(parked).toMatchObject({
    characterId: fixture.character.id,
    lookId: fixture.character.id,
    bibleVersionId: old.bibleVersionId,
    storagePath: result.sheetImagePath,
  });
  expect(parked?.divergedAt).toBeInstanceOf(Date);
  expectOwnChannel();
  expect(emit).toHaveBeenCalledWith(
    'generation.stale:detected',
    expect.objectContaining({
      entityType: 'character',
      entityId: fixture.character.id,
      divergedVariantId: old.sheetVersionId,
    })
  );
  await expectNoSequenceWrites();
});
