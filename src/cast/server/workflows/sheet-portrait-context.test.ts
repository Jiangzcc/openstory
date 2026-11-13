import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { imageConfigurationFixture } from '@/models/__tests__/image-model-fixture';
import { createImageModelRoutingSnapshot } from '@/models/image-channels';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import { packModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type {
  CharacterBibleEntry,
  LocationBibleEntry,
} from '@/shots/scene-analysis.schema';
import type {
  CharacterSheetWorkflowInput,
  LocationSheetWorkflowInput,
  SheetPortraitWorkflowInput,
} from '@/platform/server/workflow/types';
import { asStub } from '@/test/as-stub';
import { CharacterSheetWorkflow } from './character-sheet-workflow';
import { LocationSheetWorkflow } from './location-sheet-workflow';
import {
  computeCharacterSheetHashFromDto,
  computeLocationSheetHashFromDto,
} from './sheet-snapshots';
import { triggerSheetPortrait } from '../sheets/sheet-portrait-trigger';

const state = vi.hoisted(() => ({
  currentConfiguration: vi.fn<() => Promise<ModelRuntimeConfiguration>>(),
  compliance: vi.fn(async () => ({ enforcement: [] })),
  create: vi.fn(),
  get: vi.fn(),
  failCreate: false,
  jobs: new Map<string, SheetPortraitWorkflowInput>(),
  trace: [] as string[],
  network: vi.fn(async () => {
    throw new Error(
      'Unexpected network in synthetic sheet-portrait composition'
    );
  }),
}));
vi.mock('#env', () => ({
  getEnv: () => ({
    E2E_TEST: 'false',
    SHEET_PORTRAIT_WORKFLOW: { create: state.create, get: state.get },
  }),
}));
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('@/platform/server/db/scoped', () => ({
  loadModelRuntimeConfiguration: state.currentConfiguration,
  loadComplianceRecords: state.compliance,
  createScopedDb: vi.fn(() => {
    throw new Error('Parent base is outside this domain runImpl composition');
  }),
}));
vi.mock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: vi.fn(async () => undefined) }),
}));
vi.mock('@/platform/server/compliance/provenance', () => ({
  recordProvenance: vi.fn(async () => undefined),
}));
vi.mock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: vi.fn(async () => undefined),
  extractImageCost: () => 0,
  recordFalUsageStep: vi.fn(async () => ({
    requestId: 'synthetic-sheet-request',
  })),
}));
vi.mock('@/stills/server/workflows/content-soften', () => ({
  generateImageSoftening: vi.fn(async (args: { params: unknown }) => ({
    params: args.params,
    metadata: { usedOwnKey: false },
    stored: { url: '/r2/synthetic/sheet.png', path: 'synthetic/sheet.png' },
  })),
}));
vi.mock('./sheet-divergence', () => ({
  landSheetRun: vi.fn(async (args: { versionId: string }) => {
    state.trace.push('land');
    return { kind: 'convergent', versionId: args.versionId };
  }),
}));

// The real parent runImpl, portrait helper, root client, trigger binding and codecs run against synthetic domain I/O.
function configuration(label: string): ModelRuntimeConfiguration {
  const fixture = imageConfigurationFixture();
  const model = fixture.models[0];
  if (!model) throw new Error('Missing synthetic image model');
  model.id = 'nano_banana_2_lite';
  for (const channel of fixture.channels) {
    channel.baseUrl = 'https://' + label + '.invalid/v1';
    channel.credentialId = generateId();
  }
  for (const card of model.priceCards)
    card.unitPriceUsd = label === 'frozen' ? 0.01 : 0.99;
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    imageModelRouting: createImageModelRoutingSnapshot(fixture),
    textModelRouting: [],
  };
}

function jsonWire<T>(value: T): T {
  if (value === undefined) return value;
  const decoded: unknown = JSON.parse(JSON.stringify(value));
  return asStub<T>(decoded);
}

class CharacterProbe extends CharacterSheetWorkflow {
  invoke(
    input: CharacterSheetWorkflowInput,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(
      asStub<WorkflowEvent<CharacterSheetWorkflowInput>>({
        instanceId: 'synthetic-character-parent',
        payload: input,
      }),
      step,
      db
    );
  }
}
class LocationProbe extends LocationSheetWorkflow {
  invoke(
    input: LocationSheetWorkflowInput,
    step: WorkflowStep,
    db: WorkflowScopedDb
  ) {
    return this.runImpl(
      asStub<WorkflowEvent<LocationSheetWorkflowInput>>({
        instanceId: 'synthetic-location-parent',
        payload: input,
      }),
      step,
      db
    );
  }
}

type Kind = 'character' | 'location';
async function runParent(
  kind: Kind,
  promptLocale: 'zh-CN' | 'en',
  sequenceId: string | null = generateId()
) {
  const snapshot = configuration('frozen');
  const actor = {
    userId: generateId(),
    organizationId: generateId(),
    promptLocale,
    sequenceId,
    reservationId: generateId(),
    ownsReservation: true,
  };
  const versionId = generateId();
  const scopedDb = asStub<WorkflowScopedDb>({
    models: snapshot,
    credentials: {},
    provenance: {},
    liveRead: { compliance: { listEnforcementFor: vi.fn(async () => []) } },
  });
  const step = asStub<WorkflowStep>({
    do: vi.fn(async (name: string, callback: () => Promise<unknown>) => {
      state.trace.push(name);
      return callback();
    }),
  });
  const character: CharacterBibleEntry = {
    characterId: 'synthetic',
    name: 'Synthetic actor',
    age: '',
    gender: '',
    ethnicity: '',
    physicalDescription: '',
    standardClothing: '',
    looks: [],
    personality: '',
    movement: '',
    voiceDescription: '',
    voiceOnly: false,
    isPerson: false,
    rendering: 'Photoreal live action',
    consistencyTag: 'synthetic_actor',
  };
  const location: LocationBibleEntry = {
    locationId: 'synthetic',
    name: 'Synthetic room',
    type: 'interior',
    description: 'Empty room',
    architecturalStyle: '',
    keyFeatures: '',
    ambiance: '',
    rendering: 'Photoreal live action',
    consistencyTag: 'synthetic_room',
    firstMention: { text: 'ROOM', lineNumber: 1, sceneId: 'synthetic-scene' },
  };
  const common = {
    ...actor,
    modelConfiguration: packModelRuntimeConfiguration(snapshot),
    imageModel: 'nano_banana_2_lite' as const,
    bibleVersionId: null,
  };
  if (kind === 'character') {
    const characterDbId = generateId();
    const draft = {
      ...common,
      characterDbId,
      lookId: characterDbId,
      lookVersionId: generateId(),
      lookStyling: null,
      face: null,
      referencePhotoUrl: null,
      characterName: character.name,
      characterMetadata: character,
      sheetVersionId: versionId,
    };
    const input: CharacterSheetWorkflowInput = {
      ...draft,
      snapshotInputHash: await computeCharacterSheetHashFromDto(draft),
    };
    type Ctor = ConstructorParameters<typeof CharacterProbe>;
    await new CharacterProbe(
      asStub<Ctor[0]>(undefined),
      asStub<Ctor[1]>({})
    ).invoke(input, step, scopedDb);
  } else {
    const draft = {
      ...common,
      locationDbId: generateId(),
      locationName: location.name,
      locationMetadata: location,
      referencePhotoUrls: [],
      referenceVersionId: versionId,
    };
    const input: LocationSheetWorkflowInput = {
      ...draft,
      snapshotInputHash: await computeLocationSheetHashFromDto(draft),
    };
    type Ctor = ConstructorParameters<typeof LocationProbe>;
    await new LocationProbe(
      asStub<Ctor[0]>(undefined),
      asStub<Ctor[1]>({})
    ).invoke(input, step, scopedDb);
  }
  return { actor, versionId, snapshot };
}

function queuedPortrait() {
  expect(state.jobs.size).toBe(1);
  const item = [...state.jobs.values()][0];
  if (!item) throw new Error('Portrait did not reach the binding');
  return item;
}

function requestInput(kind: Kind): SheetPortraitWorkflowInput {
  return {
    userId: generateId(),
    organizationId: generateId(),
    promptLocale: 'en',
    sequenceId: generateId(),
    subject:
      kind === 'character'
        ? { kind, characterId: generateId(), lookId: generateId() }
        : { kind, locationId: generateId() },
    versionId: generateId(),
    sheetUrl: '/r2/synthetic/uploaded-sheet.png',
    storageDir: 'synthetic/uploaded',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', state.network);
  state.jobs.clear();
  state.trace.length = 0;
  state.failCreate = false;
  state.currentConfiguration.mockResolvedValue(configuration('current'));
  state.create.mockImplementation(
    async (args: { id: string; params: SheetPortraitWorkflowInput }) => {
      state.trace.push('binding.create');
      if (state.failCreate)
        throw new Error('Synthetic portrait binding unavailable');
      if (state.jobs.has(args.id))
        throw new Error('(instance.already_exists) Instance already exists');
      state.jobs.set(args.id, jsonWire(args.params));
      return { id: args.id };
    }
  );
  state.get.mockImplementation(async (id: string) => ({ id }));
});

afterAll(() => vi.unstubAllGlobals());

describe('generated sheet portrait configuration at the root binding', () => {
  it.each(['character', 'location'] as const)(
    '%s carries the parent frozen route for both task languages',
    async (kind) => {
      for (const locale of ['zh-CN', 'en'] as const) {
        state.jobs.clear();
        state.trace.length = 0;
        const result = await runParent(kind, locale);
        const queued = queuedPortrait();
        expect(queued).toMatchObject({
          userId: result.actor.userId,
          organizationId: result.actor.organizationId,
          promptLocale: locale,
          versionId: result.versionId,
        });
        expect(queued.modelConfiguration).toEqual(
          packModelRuntimeConfiguration(result.snapshot)
        );
        expect(queued).not.toHaveProperty('reservationId');
        expect(queued).not.toHaveProperty('ownsReservation');
        expect(queued).not.toHaveProperty('_parent');
        expect(state.trace.indexOf('land')).toBeLessThan(
          state.trace.indexOf('binding.create')
        );
        expect(state.trace).toContain('trigger-portrait');
      }
      expect(state.currentConfiguration).not.toHaveBeenCalled();
      expect(state.compliance).not.toHaveBeenCalled();
      expect(state.network).not.toHaveBeenCalled();
    }
  );

  it.each(['character', 'location'] as const)(
    '%s generated without a sequence still inherits its organization task configuration',
    async (kind) => {
      const result = await runParent(kind, 'zh-CN', null);
      const queued = queuedPortrait();
      expect(queued.sequenceId).toBeUndefined();
      expect(queued.organizationId).toBe(result.actor.organizationId);
      expect(queued.modelConfiguration).toEqual(
        packModelRuntimeConfiguration(result.snapshot)
      );
      expect(state.currentConfiguration).not.toHaveBeenCalled();
    }
  );

  it.each(['character', 'location'] as const)(
    '%s uploaded-sheet request keeps its own current configuration capture',
    async (kind) => {
      const input = requestInput(kind);
      await triggerSheetPortrait(input);
      expect(state.currentConfiguration).toHaveBeenCalledOnce();
      expect(state.compliance).toHaveBeenCalledOnce();
      const captured = await state.currentConfiguration.mock.results[0]?.value;
      if (!captured) throw new Error('Missing request capture');
      expect(queuedPortrait().modelConfiguration).toEqual(
        packModelRuntimeConfiguration(captured)
      );
      expect(queuedPortrait()).not.toHaveProperty('reservationId');
    }
  );

  it('reuses the version deduplication without replacing its original language or configuration', async () => {
    const input = requestInput('character');
    await triggerSheetPortrait(input);
    const first = jsonWire(queuedPortrait());
    state.currentConfiguration.mockResolvedValue(configuration('replacement'));
    await triggerSheetPortrait({ ...input, promptLocale: 'zh-CN' });
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(queuedPortrait()).toEqual(first);
  });

  it.each(['character', 'location'] as const)(
    '%s keeps the landed sheet when portrait admission fails',
    async (kind) => {
      state.failCreate = true;
      await expect(runParent(kind, 'en')).resolves.toBeDefined();
      expect(state.jobs.size).toBe(0);
      expect(state.trace).toContain('land');
      expect(state.trace).toContain('binding.create');
    }
  );
});
