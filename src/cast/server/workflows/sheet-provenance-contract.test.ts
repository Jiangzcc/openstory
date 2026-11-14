import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { eq } from 'drizzle-orm';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  CharacterSheetWorkflowInput,
  ElementSheetWorkflowInput,
  LocationSheetWorkflowInput,
} from '@/platform/server/workflow/types';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createProvenanceMethods } from '@/platform/server/db/scoped/compliance';
import {
  contentProvenance,
  organization,
  user,
} from '@/platform/server/db/schema';
import type { ProvenanceAssetKind } from '@/platform/server/db/schema/compliance';
import { sha256Hex } from '@/platform/compliance/hash';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';
import { micros } from '@/billing/money';
import { extractImageCost } from '@/billing/server/workflow-deduction';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ImageVia } from '@/models/via';
import type { CharacterBibleEntry } from '@/shots/scene-analysis.schema';
import type { SequenceElement } from '@/platform/server/db/schema';

const mocks = {
  generation:
    vi.fn<
      typeof import('@/stills/server/workflows/content-soften').generateImageSoftening
    >(),
  debit:
    vi.fn<
      typeof import('@/billing/server/workflow-deduction').deductWorkflowCredits
    >(),
  usage:
    vi.fn<
      typeof import('@/billing/server/workflow-deduction').recordFalUsageStep
    >(),
  characterLanding: vi.fn(async (_input: unknown) => 'promoted' as const),
  locationLanding: vi.fn(async (_input: unknown) => 'promoted' as const),
  emit: vi.fn(async (_event: string, _payload: unknown) => undefined),
  portrait: vi.fn(async () => undefined),
};

// Parent runImpl, snapshot validation, provenance hashing and scoped D1 writes stay real.
vi.doMock('@/stills/server/workflows/content-soften', () => ({
  generateImageSoftening: mocks.generation,
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: mocks.debit,
  extractImageCost,
  recordFalUsageStep: mocks.usage,
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: mocks.emit }),
}));
vi.doMock('@/cast/server/sheets/sheet-portrait-trigger', () => ({
  triggerSheetPortrait: mocks.portrait,
}));

const { CharacterSheetWorkflow } = await import('./character-sheet-workflow');
const { LocationSheetWorkflow } = await import('./location-sheet-workflow');
const { ElementSheetWorkflow } = await import('./element-sheet-workflow');
const { computeCharacterSheetHashFromDto, computeLocationSheetHashFromDto } =
  await import('./sheet-snapshots');

const MODEL = 'nano_banana_2';
const REQUEST_ID = 'mock-sheet-provenance-request';
const ENDPOINT_ID = 'mock-sheet-endpoint';
const COST = micros(28_000);
const STORED = {
  url: '/r2/mock/sheet-provenance.png',
  path: 'mock/sheet-provenance.png',
};
const VIAS = [
  'compatible',
  'fal',
  'google',
] as const satisfies readonly ImageVia[];
const KINDS = ['character', 'location', 'element'] as const;
let db: Database;
let closeDb: () => Promise<void>;

type Kind = (typeof KINDS)[number];
type Scope = Awaited<ReturnType<typeof seedScope>>;
type RunFacts = {
  runId: string;
  assetId: string;
  assetKind: ProvenanceAssetKind;
  chargeKey: string;
  versionId?: string;
};

class CharacterProbe extends CharacterSheetWorkflow {
  execute(
    event: WorkflowEvent<CharacterSheetWorkflowInput>,
    step: WorkflowStep,
    scope: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scope);
  }
}
class LocationProbe extends LocationSheetWorkflow {
  execute(
    event: WorkflowEvent<LocationSheetWorkflowInput>,
    step: WorkflowStep,
    scope: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scope);
  }
}
class ElementProbe extends ElementSheetWorkflow {
  execute(
    event: WorkflowEvent<ElementSheetWorkflowInput>,
    step: WorkflowStep,
    scope: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scope);
  }
}

function event<T>(workflowName: string, payload: T): WorkflowEvent<T> {
  return {
    workflowName,
    payload,
    instanceId: generateId(),
    timestamp: new Date(0),
  };
}

function workflowStep() {
  const names: string[] = [];
  const step = asStub<WorkflowStep>({
    do: async (name: string, run: () => Promise<unknown>) => {
      names.push(name);
      return run();
    },
  });
  return { step, names };
}

async function seedScope() {
  const organizationId = generateId();
  const userId = generateId();
  const reservationId = generateId();
  await db.insert(organization).values({
    id: organizationId,
    name: 'Mock provenance organization',
    slug: organizationId,
  });
  await db.insert(user).values({
    id: userId,
    name: 'Mock writer',
    email: userId + '@example.invalid',
  });
  const createElement = vi.fn(async (input: Record<string, unknown>) =>
    asStub<SequenceElement>({
      ...input,
      kind: 'image',
      durationSeconds: null,
      personInMedia: false,
    })
  );
  const scope = asStub<WorkflowScopedDb>({
    organizationId,
    models: DEFAULT_MODEL_CONFIGURATION,
    provenance: createProvenanceMethods(db, organizationId, userId),
    characterSheetVariants: { promoteIfPending: mocks.characterLanding },
    locationSheetVariants: { promoteIfPending: mocks.locationLanding },
    sequenceElements: { publishGenerated: createElement },
    liveRead: {
      compliance: { listEnforcementFor: async () => [] },
      sequences: { getForUser: async () => ({}) },
      sequenceElements: {
        getById: async () => undefined,
        getByToken: async () => undefined,
      },
    },
  });
  return { organizationId, userId, reservationId, scope, createElement };
}

const CHARACTER: CharacterBibleEntry = {
  characterId: 'mock_character',
  name: 'Mock writer',
  age: '30s',
  gender: '',
  ethnicity: '',
  physicalDescription: 'Mock character description',
  standardClothing: 'coat',
  looks: [],
  personality: '',
  movement: '',
  voiceDescription: '',
  voiceOnly: false,
  isPerson: true,
  rendering: 'Photoreal live action',
  consistencyTag: 'mock_writer',
};

async function runCharacter(
  scope: Scope,
  step: WorkflowStep
): Promise<RunFacts> {
  const fields: Omit<CharacterSheetWorkflowInput, 'snapshotInputHash'> = {
    promptLocale: 'en',
    userId: scope.userId,
    organizationId: scope.organizationId,
    reservationId: scope.reservationId,
    sequenceId: null,
    characterDbId: generateId(),
    lookId: generateId(),
    lookVersionId: generateId(),
    lookStyling: null,
    face: null,
    referencePhotoUrl: null,
    characterName: CHARACTER.name,
    characterMetadata: CHARACTER,
    imageModel: MODEL,
    sheetVersionId: generateId(),
    bibleVersionId: null,
  };
  const input = {
    ...fields,
    snapshotInputHash: await computeCharacterSheetHashFromDto(fields),
  };
  const queued = event('character-sheet', input);
  const workflow = new CharacterProbe(
    asStub<ConstructorParameters<typeof CharacterProbe>[0]>(undefined),
    asStub<ConstructorParameters<typeof CharacterProbe>[1]>({})
  );
  const result = await workflow.execute(queued, step, scope.scope);
  expect(result.sheetVersionId).toBe(input.sheetVersionId);
  return {
    runId: queued.instanceId,
    assetId: input.characterDbId,
    assetKind: 'character_sheet',
    chargeKey: queued.instanceId + ':sheet',
    versionId: input.sheetVersionId,
  };
}

function locationMetadata(): LocationSheetWorkflowInput['locationMetadata'] {
  return {
    locationId: 'mock_station',
    name: 'Mock station',
    type: 'interior',
    description: 'Mock hall',
    architecturalStyle: 'brick',
    keyFeatures: 'clock',
    ambiance: 'quiet',
    rendering: 'Photoreal live action',
    consistencyTag: 'mock_station',
    firstMention: {
      sceneId: generateId(),
      lineNumber: 1,
      text: 'Mock station',
    },
  };
}

async function runLocation(
  scope: Scope,
  step: WorkflowStep
): Promise<RunFacts> {
  const fields: Omit<LocationSheetWorkflowInput, 'snapshotInputHash'> = {
    promptLocale: 'en',
    userId: scope.userId,
    organizationId: scope.organizationId,
    reservationId: scope.reservationId,
    sequenceId: null,
    locationDbId: generateId(),
    locationName: 'Mock station',
    referencePhotoUrls: [],
    imageModel: MODEL,
    referenceVersionId: generateId(),
    bibleVersionId: null,
    locationMetadata: locationMetadata(),
  };
  const input = {
    ...fields,
    snapshotInputHash: await computeLocationSheetHashFromDto(fields),
  };
  const queued = event('location-sheet', input);
  const workflow = new LocationProbe(
    asStub<ConstructorParameters<typeof LocationProbe>[0]>(undefined),
    asStub<ConstructorParameters<typeof LocationProbe>[1]>({})
  );
  const result = await workflow.execute(queued, step, scope.scope);
  expect(result.sheetVersionId).toBe(input.referenceVersionId);
  return {
    runId: queued.instanceId,
    assetId: input.locationDbId,
    assetKind: 'location_sheet',
    chargeKey: queued.instanceId + ':sheet',
    versionId: input.referenceVersionId,
  };
}

async function runElement(scope: Scope, step: WorkflowStep): Promise<RunFacts> {
  const input: ElementSheetWorkflowInput = {
    promptLocale: 'en',
    userId: scope.userId,
    organizationId: scope.organizationId,
    reservationId: scope.reservationId,
    sequenceId: generateId(),
    imageModel: MODEL,
    entries: [
      {
        elementId: generateId(),
        token: 'MOCK_BOOK',
        description: 'Mock red book',
        consistencyTag: 'mock_book',
        firstMention: {
          sceneId: generateId(),
          lineNumber: 1,
          text: 'MOCK_BOOK',
        },
      },
    ],
  };
  const entry = input.entries[0];
  if (!entry) throw new Error('Missing mock element input.');
  const queued = event('element-sheet', input);
  const workflow = new ElementProbe(
    asStub<ConstructorParameters<typeof ElementProbe>[0]>(undefined),
    asStub<ConstructorParameters<typeof ElementProbe>[1]>({})
  );
  const result = await workflow.execute(queued, step, scope.scope);
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0]?.id).toBe(entry.elementId);
  expect(scope.createElement).toHaveBeenCalledTimes(1);
  return {
    runId: queued.instanceId,
    assetId: entry.elementId,
    assetKind: 'element_sheet',
    chargeKey: queued.instanceId + ':element-ref-0',
  };
}

function expectUnchangedBoundary(
  kind: Kind,
  facts: RunFacts,
  names: string[],
  scope: Scope
) {
  const chargeStep = kind === 'element' ? 'deduct-credits-0' : 'deduct-credits';
  const recordStep =
    kind === 'element' ? 'record-provenance-0' : 'record-provenance';
  const landStep =
    kind === 'element' ? 'ingest-element-0' : 'reconcile-database';
  expect(names.filter((name) => name === recordStep)).toHaveLength(1);
  expect(names.indexOf(chargeStep)).toBeLessThan(names.indexOf(recordStep));
  expect(names.indexOf(recordStep)).toBeLessThan(names.indexOf(landStep));
  expect(mocks.debit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      scopedDb: scope.scope,
      costMicros: COST,
      usedOwnKey: false,
      idempotencyKey: facts.chargeKey,
      reservationId: scope.reservationId,
    })
  );
  if (kind !== 'element') {
    const landing =
      kind === 'character' ? mocks.characterLanding : mocks.locationLanding;
    expect(landing).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        versionId: facts.versionId,
        workflowRunId: facts.runId,
        claimed: true,
      })
    );
  }
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
beforeEach(async () => {
  await db.delete(contentProvenance);
  vi.clearAllMocks();
  mocks.debit.mockResolvedValue(undefined);
  mocks.usage.mockResolvedValue({
    endpointId: ENDPOINT_ID,
    requestId: REQUEST_ID,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected network in mock-only provenance contract.');
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const RUNNERS = {
  character: runCharacter,
  location: runLocation,
  element: runElement,
};
const CASES = KINDS.flatMap((kind) => VIAS.map((via) => ({ kind, via })));

it.each(CASES)(
  '$kind sheet stores the required $via generation fact in real provenance D1',
  async ({ kind, via }) => {
    const scope = await seedScope();
    const { step, names } = workflowStep();
    mocks.generation.mockImplementation(async (args) => ({
      stored: STORED,
      params: args.params,
      softened: false,
      via,
      metadata: {
        prompt: args.params.prompt,
        model: args.params.model,
        endpointId: ENDPOINT_ID,
        dimensions: [{ width: 1024, height: 576 }],
        file_sizes: [16],
        cost: COST,
        usedOwnKey: false,
        requestId: REQUEST_ID,
      },
    }));
    const facts = await RUNNERS[kind](scope, step);
    expectUnchangedBoundary(kind, facts, names, scope);
    const params = mocks.generation.mock.calls[0]?.[0].params;
    if (!params) throw new Error('Parent did not request mock generation.');
    const rows = await db
      .select()
      .from(contentProvenance)
      .where(eq(contentProvenance.workflowRunId, facts.runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: scope.organizationId,
      userId: scope.userId,
      assetKind: facts.assetKind,
      assetId: facts.assetId,
      storageKey: STORED.path,
      model: MODEL,
      workflowRunId: facts.runId,
      providerRequestId: REQUEST_ID,
      promptSha256: await sha256Hex(params.prompt),
      usedReferenceImages: false,
      referenceImageCount: 0,
    });
    expect(rows[0]?.provider).toBe(via);
  }
);
