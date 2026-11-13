import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import type { ModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { ImageModelRoute } from '@/models/image-channels';
import type { TextModelRoute } from '@/models/text-channels';
import type { UploadRights } from '@/cast/upload-rights';
import { PORTRAIT_RIGHTS_V1 } from '@/platform/compliance/attestations';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { Style } from '@/platform/server/db/schema';
import { generateId } from '@/platform/id';
import { ValidationError } from '@/platform/errors';
import type { CreateSequencesResult } from '@/sequences/server/create-sequences';
import type { OneShotContext } from './create';
import { asStub } from '@/test/as-stub';

// Real API/configured schemas, snapshot loader, video gate, resolve and ingest orchestration.
// Mock scoped reads, env, fetch/R2, enhancement, portrait ledger, library writes, core and sheet dispatch.
// Node service contracts only: no HTTP auth, D1, workflow engine, billing or provider acceptance.
const IDS = {
  user: generateId(),
  organization: generateId(),
  character: generateId(),
  location: generateId(),
  style: generateId(),
  sequence: generateId(),
};
const SCRIPT =
  '守塔人说：“不要翻译这句对白。” A lighthouse keeper greets a whale.';
const ENHANCED_SCRIPT = `${SCRIPT}\nScene 2: The whale returns.`;
const REFERENCE_URL = 'https://capture-media.invalid/reference.png';
const MOCK_ARK_KEY = 'synthetic-capture-key-never-sent';
const INLINE = {
  characters: [{ name: 'Keeper', description: 'A lighthouse keeper.' }],
  locations: [{ name: 'Pier', description: 'The wooden pier.' }],
};
const ATTESTATION = {
  statementVersion: PORTRAIT_RIGHTS_V1.version,
  authorizationBasis: 'synthetic signed release',
};
const TEXT_ROUTE: TextModelRoute = {
  modelId: 'custom:capture',
  name: 'Synthetic capture model',
  channelId: 'capture-text-channel',
  upstreamModel: 'capture-a',
  credentialId: 'synthetic-text-credential',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://capture-text-a.invalid/v1',
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};
const IMAGE_ROUTE: ImageModelRoute = {
  modelId: 'custom-image:capture',
  name: 'Synthetic capture image',
  channelId: 'capture-image-channel',
  credentialId: 'synthetic-image-credential',
  protocol: 'openai-images',
  baseUrl: 'https://capture-image-a.invalid/v1',
  operations: {
    generate: {
      upstreamModel: 'capture-a',
      status: 'verified',
      minReferenceImages: 0,
      maxReferenceImages: 0,
      mask: 'unsupported',
    },
  },
  parameters: [],
  priceCards: [
    { id: 'capture', operation: 'generate', match: {}, unitPriceUsd: 0.02 },
  ],
};

function configuration(revision: 'a' | 'b'): ModelRuntimeConfiguration {
  const first = revision === 'a';
  return {
    ...DEFAULT_MODEL_CONFIGURATION,
    defaultAnalysis: first ? TEXT_ROUTE.modelId : 'google/gemini-3.8-flash',
    defaultImage: first ? IMAGE_ROUTE.modelId : 'nano_banana_2_lite',
    defaultVideo: 'seedance_v2',
    newSequenceVideo: first ? 'seedance_v2_5' : 'seedance_v2',
    textModelRouting: [
      {
        ...TEXT_ROUTE,
        baseUrl: `https://capture-text-${revision}.invalid/v1`,
        upstreamModel: `capture-${revision}`,
        inputPricePerMillion: first ? 2 : 20,
        outputPricePerMillion: first ? 6 : 60,
      },
    ],
    imageModelRouting: [
      {
        ...IMAGE_ROUTE,
        baseUrl: `https://capture-image-${revision}.invalid/v1`,
        priceCards: [
          {
            id: 'capture',
            operation: 'generate',
            match: {},
            unitPriceUsd: first ? 0.02 : 0.2,
          },
        ],
      },
    ],
  };
}

let activeConfiguration = configuration('a');
let environment: Record<string, string | undefined> = {};
let rights: UploadRights = { status: 'cleared' };
let events: string[] = [];
let context: OneShotContext;
const readText = vi.fn<ScopedDb['textChannels']['getSnapshot']>();
const readImage = vi.fn<ScopedDb['imageChannels']['getSnapshot']>();
const readConfiguration = vi.fn<ScopedDb['modelConfiguration']['get']>();
const resolveFalKey = vi.fn<ScopedDb['apiKeys']['resolveOptionalKey']>();
const listStyles = vi.fn<ScopedDb['styles']['list']>();
const deleteCharacter = vi.fn(async (_id: string) => true);
const deleteLocation = vi.fn(async (_id: string) => true);
const createCharacter =
  vi.fn<typeof import('@/cast/server/cast-edit').createOrganizationCharacter>();
const createLocation =
  vi.fn<
    typeof import('@/cast/server/locations/organization-locations').createOrganizationLocation
  >();
const triggerSheet =
  vi.fn<
    typeof import('@/cast/server/locations/organization-locations').triggerOrganizationLocationSheet
  >();
const createSequences =
  vi.fn<typeof import('@/sequences/server/create-sequences').createSequences>();
const enhance =
  vi.fn<
    typeof import('@/sequences/server/script-enhancement').enhanceScriptToString
  >();
const classify =
  vi.fn<typeof import('@/cast/server/upload-rights').classifyUpload>();
const attest =
  vi.fn<typeof import('@/cast/server/upload-rights').attestUploads>();
const uploadFile = vi.fn<() => Promise<void>>();
const fetchImage = vi.fn<typeof fetch>();

vi.doMock('#env', () => ({ getEnv: () => environment }));
vi.doMock('#storage', () => ({ uploadFile, moveFile: vi.fn() }));
vi.doMock('@/cast/server/upload-rights', () => ({
  classifyUpload: classify,
  attestUploads: attest,
}));
vi.doMock('@/sequences/server/script-enhancement', () => ({
  enhanceScriptToString: enhance,
}));
vi.doMock('@/sequences/server/create-sequences', () => ({ createSequences }));
vi.doMock('@/cast/server/cast-edit', () => ({
  createOrganizationCharacter: createCharacter,
}));
vi.doMock('@/cast/server/locations/organization-locations', () => ({
  createOrganizationLocation: createLocation,
  triggerOrganizationLocationSheet: triggerSheet,
}));

const { runOneShotCreate } = await import('./create');
const { apiCreateSequenceSchema } = await import('./input-schema');
const { runApiV1Handler } = await import('./errors');

function coreResult(): CreateSequencesResult {
  return asStub<CreateSequencesResult>({
    entries: [
      {
        sequence: { id: IDS.sequence, status: 'processing' },
        workflowRunId: 'synthetic-storyboard-run',
      },
    ],
  });
}

function scopedFixture(): ScopedDb {
  return asStub<ScopedDb>({
    organizationId: IDS.organization,
    textChannels: { getSnapshot: readText },
    imageChannels: { getSnapshot: readImage },
    modelConfiguration: { get: readConfiguration },
    apiKeys: { resolveOptionalKey: resolveFalKey },
    styles: { list: listStyles },
    characters: {
      listOrganization: vi.fn(async () => []),
      softDeleteForOrganization: deleteCharacter,
    },
    locations: {
      listOrganization: vi.fn(async () => []),
      softDeleteForOrganization: deleteLocation,
    },
  });
}

function configureReads() {
  readText.mockImplementation(
    async () => activeConfiguration.textModelRouting ?? []
  );
  readImage.mockImplementation(
    async () => activeConfiguration.imageModelRouting ?? []
  );
  readConfiguration.mockImplementation(async () => {
    events.push('configuration');
    return activeConfiguration;
  });
  resolveFalKey.mockResolvedValue(undefined);
  listStyles.mockResolvedValue([]);
  context = {
    promptLocale: 'en',
    user: { id: IDS.user },
    organizationId: IDS.organization,
    scopedDb: scopedFixture(),
    request: { ipAddress: '203.0.113.9', userAgent: 'synthetic capture test' },
  };
}

function configureEffects() {
  enhance.mockImplementation(async () => {
    events.push('enhance');
    return ENHANCED_SCRIPT;
  });
  classify.mockImplementation(async () => {
    events.push('classify');
    return rights;
  });
  attest.mockImplementation(async () => {
    events.push('attest');
  });
  createCharacter.mockImplementation(async () => {
    events.push('character');
    return asStub<Awaited<ReturnType<typeof createCharacter>>>({
      id: IDS.character,
    });
  });
  createLocation.mockImplementation(async () => {
    events.push('location');
    return asStub<Awaited<ReturnType<typeof createLocation>>>({
      id: IDS.location,
    });
  });
  createSequences.mockImplementation(async () => {
    events.push('core');
    return coreResult();
  });
  triggerSheet.mockImplementation(async () => {
    events.push('sheet');
    return 'synthetic-sheet-run';
  });
  deleteCharacter.mockImplementation(async () => {
    events.push('delete-character');
    return true;
  });
  deleteLocation.mockImplementation(async () => {
    events.push('delete-location');
    return true;
  });
}

function configureStorage() {
  uploadFile.mockImplementation(async () => {
    events.push('upload');
  });
  fetchImage.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url !== REFERENCE_URL) throw new Error(`Unexpected mock fetch: ${url}`);
    events.push('fetch');
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  });
  vi.stubGlobal('fetch', fetchImage);
}

beforeEach(() => {
  vi.resetAllMocks();
  events = [];
  rights = { status: 'cleared' };
  activeConfiguration = configuration('a');
  environment = { ARK_API_KEY: MOCK_ARK_KEY, BYTEPLUS_ASSET_SLOTS: '1' };
  configureReads();
  configureEffects();
  configureStorage();
});
afterEach(() => vi.unstubAllGlobals());

function submit(input: Record<string, unknown> = {}) {
  return runOneShotCreate(
    apiCreateSequenceSchema.parse({ script: SCRIPT, enhance: 'off', ...input }),
    context
  );
}

function respond(input: Record<string, unknown>) {
  return runApiV1Handler(async () => Response.json(await submit(input)));
}

function coreCall(index = 0) {
  const call = createSequences.mock.calls[index];
  if (!call) throw new Error(`Missing mock core call ${index}`);
  return call;
}

function expectCapture(index: number, snapshot: ModelRuntimeConfiguration) {
  const [input, internal] = coreCall(index);
  expect(internal).toMatchObject({
    promptLocale: context.promptLocale,
    organizationId: IDS.organization,
    user: context.user,
    notify: false,
    modelConfiguration: snapshot,
  });
  expect(internal.scopedDb).toBe(context.scopedDb);
  expect(internal.modelConfiguration?.textModelRouting).toBe(
    snapshot.textModelRouting
  );
  expect(internal.modelConfiguration?.imageModelRouting).toBe(
    snapshot.imageModelRouting
  );
  expect(input).not.toHaveProperty('modelConfiguration');
}

function expectReads(count: number) {
  expect(readText).toHaveBeenCalledTimes(count);
  expect(readImage).toHaveBeenCalledTimes(count);
  expect(readConfiguration).toHaveBeenCalledTimes(count);
}

function expectBefore(earlier: string, later: string) {
  expect(events).toContain(earlier);
  expect(events).toContain(later);
  expect(events.lastIndexOf(earlier)).toBeLessThan(events.indexOf(later));
}

function expectNoCreation() {
  expect(createCharacter).not.toHaveBeenCalled();
  expect(createLocation).not.toHaveBeenCalled();
  expect(createSequences).not.toHaveBeenCalled();
  expect(triggerSheet).not.toHaveBeenCalled();
  expect(deleteCharacter).not.toHaveBeenCalled();
  expect(deleteLocation).not.toHaveBeenCalled();
}

function barrier() {
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait: async () => {
      enter();
      await released;
    },
  };
}

it('keeps A through a controlled admin change and captures B on the next request', async () => {
  const firstSnapshot = activeConfiguration;
  const nextSnapshot = configuration('b');
  const gate = barrier();
  enhance.mockImplementationOnce(async () => {
    events.push('enhance');
    await gate.wait();
    return ENHANCED_SCRIPT;
  });
  const first = submit({ enhance: 'always', targetSeconds: 30 });
  await gate.entered;
  try {
    expect(createSequences).not.toHaveBeenCalled();
    activeConfiguration = nextSnapshot;
  } finally {
    gate.release();
  }
  await first;
  await submit({ enhance: 'always', targetSeconds: 30 });
  expectCapture(0, firstSnapshot);
  expectCapture(1, nextSnapshot);
  for (const [index, snapshot] of [firstSnapshot, nextSnapshot].entries()) {
    expect(coreCall(index)[0]).toMatchObject({
      script: ENHANCED_SCRIPT,
      analysisModels: [snapshot.defaultAnalysis],
      imageModels: [snapshot.defaultImage],
      videoModels: [snapshot.newSequenceVideo],
      musicModel: snapshot.defaultMusic,
      targetDurationSeconds: 30,
    });
    expect(enhance.mock.calls[index]?.[0].videoModel).toBe(
      snapshot.newSequenceVideo
    );
  }
  expectReads(2);
  expect(readConfiguration.mock.calls[0]?.[0]).toEqual([
    expect.objectContaining({
      id: TEXT_ROUTE.modelId,
      structuredOutput: true,
    }),
  ]);
  expect(readConfiguration.mock.calls[0]?.[1]).toEqual([
    expect.objectContaining({
      id: IMAGE_ROUTE.modelId,
      priceCards: IMAGE_ROUTE.priceCards,
    }),
  ]);
});

it('preserves explicit model arrays, style, output switches and a verbatim script', async () => {
  listStyles.mockResolvedValue([
    asStub<Style>({
      id: IDS.style,
      name: 'Synthetic style',
      config: {},
      defaultAspectRatio: '4:3',
    }),
  ]);
  await submit({
    style: IDS.style,
    aspectRatio: '9:16',
    resolution: '1080p',
    analysisModels: ['google/gemini-3.8-flash', TEXT_ROUTE.modelId],
    imageModels: ['nano_banana_2'],
    videoModels: ['kling_v3_pro'],
    audioModels: ['ace_step_1_5'],
    startFrames: true,
    draftMotion: false,
    stopAt: 'images',
    targetSeconds: 30,
  });
  expect(coreCall()[0]).toMatchObject({
    script: SCRIPT,
    styleId: IDS.style,
    aspectRatio: '9:16',
    resolution: '1080p',
    analysisModels: ['google/gemini-3.8-flash', TEXT_ROUTE.modelId],
    imageModels: ['nano_banana_2'],
    videoModels: ['kling_v3_pro'],
    audioModels: ['ace_step_1_5'],
    generateStartFrames: true,
    draftMotion: false,
    stopAt: 'images',
  });
  expect(coreCall()[0]).not.toHaveProperty('targetDurationSeconds');
  expect(enhance).not.toHaveBeenCalled();
  expectCapture(0, activeConfiguration);
  expectReads(1);
});

it.each([
  { name: 'no platform Ark key', key: undefined, slots: '1', ownFal: false },
  {
    name: 'disabled platform slots',
    key: MOCK_ARK_KEY,
    slots: '0',
    ownFal: false,
  },
  {
    name: 'an organization fal key',
    key: MOCK_ARK_KEY,
    slots: '1',
    ownFal: true,
  },
])(
  'keeps the real BytePlus source gate for $name',
  async ({ key, slots, ownFal }) => {
    environment.ARK_API_KEY = key;
    environment.BYTEPLUS_ASSET_SLOTS = slots;
    if (ownFal) {
      resolveFalKey.mockResolvedValue(asStub({ source: 'organization' }));
    }
    await submit();
    expect(coreCall()[0]).toMatchObject({
      videoModels: [activeConfiguration.defaultVideo],
      draftMotion: false,
      generateStartFrames: false,
      stopAt: 'dialogue',
    });
    expect(resolveFalKey).toHaveBeenCalledWith('fal');
    expectCapture(0, activeConfiguration);
    expectReads(1);
  }
);

it('falls back to an offered model when both configured video defaults need BytePlus', async () => {
  environment.ARK_API_KEY = undefined;
  activeConfiguration.defaultVideo = 'seedance_v2_5';
  await submit();
  expect(coreCall()[0].videoModels).toEqual(['seedance_v2']);
  expect(coreCall()[0].draftMotion).toBe(false);
  expectCapture(0, activeConfiguration);
});

it.each(['location', 'element'] as const)(
  'refuses an unsigned %s portrait before enhancement or any inline insert',
  async (kind) => {
    rights = { status: 'needs_portrait' };
    const reference =
      kind === 'location'
        ? {
            locations: [{ name: 'Pier', referenceImageUrls: [REFERENCE_URL] }],
          }
        : { elements: [{ url: REFERENCE_URL, token: 'KEEPER' }] };
    const response = await respond({
      ...INLINE,
      ...reference,
      enhance: 'always',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'ATTESTATION_REQUIRED' },
    });
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        promptLocale: 'en',
        scopedDb: context.scopedDb,
        userId: IDS.user,
        request: context.request,
        url: expect.stringContaining(
          `/r2/${kind === 'location' ? 'locations' : 'elements'}/${IDS.organization}/`
        ),
      })
    );
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(attest).not.toHaveBeenCalled();
    expect(enhance).not.toHaveBeenCalled();
    expectNoCreation();
    expectReads(1);
  }
);

it('records both portrait sign-offs before enhancement, inline rows, core and sheets', async () => {
  rights = { status: 'needs_portrait' };
  await submit({
    ...INLINE,
    enhance: 'always',
    locations: [
      {
        name: 'Pier',
        referenceImageUrls: [REFERENCE_URL],
        portraitAttestation: ATTESTATION,
      },
    ],
    elements: [
      {
        url: REFERENCE_URL,
        token: 'KEEPER',
        portraitAttestation: ATTESTATION,
      },
    ],
  });
  expect(classify).toHaveBeenCalledTimes(2);
  expect(attest).toHaveBeenCalledTimes(2);
  expect(attest).toHaveBeenCalledWith(
    context.scopedDb,
    [expect.objectContaining(ATTESTATION)],
    context.request
  );
  expectBefore('upload', 'classify');
  expectBefore('attest', 'enhance');
  expectBefore('enhance', 'character');
  expectBefore('enhance', 'location');
  expectBefore('character', 'core');
  expectBefore('location', 'core');
  expectBefore('core', 'sheet');
  expect(createLocation.mock.calls[0]?.[2]).toMatchObject({
    promptLocale: 'en',
    userId: IDS.user,
    organizationId: IDS.organization,
    triggerSheet: false,
  });
  expect(coreCall()[0]).toMatchObject({
    castCharacterIds: [IDS.character],
    suggestedLocationIds: [IDS.location],
  });
  expect(coreCall()[0].elementUploads).toHaveLength(1);
  expectCapture(0, activeConfiguration);
});

it('fails ingestion before rights checks, enhancement or inline creation', async () => {
  fetchImage.mockRejectedValueOnce(new Error('Synthetic unreachable image'));
  const response = await respond({
    ...INLINE,
    enhance: 'always',
    elements: [{ url: REFERENCE_URL }],
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: 'VALIDATION_ERROR' },
  });
  expect(uploadFile).not.toHaveBeenCalled();
  expect(classify).not.toHaveBeenCalled();
  expect(enhance).not.toHaveBeenCalled();
  expectNoCreation();
});

it('preserves Kling O3 reference-only acceptance in the real schema', async () => {
  await submit({ videoModels: ['kling_v3_pro'], startFrames: false });
  expect(coreCall()[0]).toMatchObject({
    videoModels: ['kling_v3_pro'],
    generateStartFrames: false,
  });
  expectCapture(0, activeConfiguration);
});

it.each([
  {
    name: 'analysis model',
    values: { analysisModels: ['invalid-analysis-model'] },
    field: 'analysisModels',
  },
  {
    name: 'video model array',
    values: { videoModels: ['seedance_v2', 'invalid-video-model'] },
    field: 'videoModels',
  },
])(
  'keeps final $name validation after enhancement and inline creation',
  async ({ values, field }) => {
    const response = await respond({
      ...INLINE,
      enhance: 'always',
      ...values,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body.',
        details: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: expect.arrayContaining([field]),
            }),
          ]),
        },
      },
    });
    expectBefore('enhance', 'character');
    expectBefore('enhance', 'location');
    expectBefore('character', 'delete-character');
    expectBefore('location', 'delete-location');
    expect(deleteCharacter).toHaveBeenCalledWith(IDS.character);
    expect(deleteLocation).toHaveBeenCalledWith(IDS.location);
    expect(createSequences).not.toHaveBeenCalled();
    expect(triggerSheet).not.toHaveBeenCalled();
  }
);

it('cleans up both inline rows and starts no sheet when the core refuses creation', async () => {
  createSequences.mockImplementationOnce(async () => {
    events.push('core');
    throw new ValidationError('Synthetic core refusal');
  });
  const response = await respond(INLINE);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { message: 'Synthetic core refusal' },
  });
  expect(deleteCharacter).toHaveBeenCalledWith(IDS.character);
  expect(deleteLocation).toHaveBeenCalledWith(IDS.location);
  expectBefore('core', 'delete-character');
  expectBefore('core', 'delete-location');
  expect(triggerSheet).not.toHaveBeenCalled();
  expectCapture(0, activeConfiguration);
});

it('waits for successful core completion before starting the location sheet', async () => {
  const gate = barrier();
  createSequences.mockImplementationOnce(async () => {
    events.push('core');
    await gate.wait();
    events.push('core-completed');
    return coreResult();
  });
  const pending = submit(INLINE);
  await gate.entered;
  try {
    expect(triggerSheet).not.toHaveBeenCalled();
    expect(deleteCharacter).not.toHaveBeenCalled();
    expect(deleteLocation).not.toHaveBeenCalled();
  } finally {
    gate.release();
  }
  expect(await pending).toMatchObject({ sequences: [{ id: IDS.sequence }] });
  expectBefore('core-completed', 'sheet');
  expect(triggerSheet).toHaveBeenCalledWith(context.scopedDb, {
    promptLocale: 'en',
    userId: IDS.user,
    organizationId: IDS.organization,
    locationId: IDS.location,
    modelConfiguration: activeConfiguration,
  });
  expectCapture(0, activeConfiguration);
});

it('retains the successful sequence when later sheet dispatch fails', async () => {
  triggerSheet.mockRejectedValueOnce(
    new Error('Synthetic sheet dispatch refusal')
  );
  expect(await submit(INLINE)).toMatchObject({
    sequences: [{ id: IDS.sequence }],
  });
  expect(triggerSheet).toHaveBeenCalledOnce();
  expect(deleteCharacter).not.toHaveBeenCalled();
  expect(deleteLocation).not.toHaveBeenCalled();
});

it('strips forged public actor, locale and configuration fields before the real service', async () => {
  const forged = {
    modelConfiguration: configuration('b'),
    textModelRouting: configuration('b').textModelRouting,
    imageModelRouting: configuration('b').imageModelRouting,
    userId: 'forged-user',
    user: { id: 'forged-user' },
    organizationId: 'forged-organization',
    promptLocale: 'zh-CN',
    scopedDb: { organizationId: 'forged-organization' },
    notify: true,
  };
  const input = apiCreateSequenceSchema.parse({
    script: SCRIPT,
    enhance: 'off',
    ...forged,
    locations: [{ name: 'Pier', ...forged }],
  });
  expect(input.locations).toEqual([{ name: 'Pier' }]);
  for (const key of Object.keys(forged)) expect(input).not.toHaveProperty(key);
  await runOneShotCreate(input, context);
  expectCapture(0, activeConfiguration);
  for (const key of Object.keys(forged))
    expect(coreCall()[0]).not.toHaveProperty(key);
  expect(triggerSheet.mock.calls[0]?.[1]).toMatchObject({
    promptLocale: 'en',
    userId: IDS.user,
    organizationId: IDS.organization,
  });
});

it.each([
  { name: 'short script', input: { script: 'short' } },
  {
    name: 'strict inline character',
    input: {
      characters: [{ name: 'Keeper', modelConfiguration: configuration('b') }],
    },
  },
])(
  'rejects public schema failure $name before capturing or doing IO',
  async ({ input }) => {
    const response = await respond(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expectReads(0);
    expect(resolveFalKey).not.toHaveBeenCalled();
    expect(fetchImage).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(enhance).not.toHaveBeenCalled();
    expectNoCreation();
  }
);
