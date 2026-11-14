import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
// oxlint-disable-next-line boundaries/no-raw-db -- replace only the handle with isolated migrated D1
import { getDb } from '#db-client';
// oxlint-disable-next-line boundaries/no-scoped-factory -- exercise real scoped repositories
import { createScopedDb } from '@/platform/server/db/scoped';
import { generateId } from '@/platform/id';
import { dbSceneId } from '@/shots/scene-id';
import type { Locale } from '@/platform/i18n/locale';
import { LOCALE_COOKIE, resolveLocale } from '@/platform/i18n/locale';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  frames,
  locations,
  organization,
  scenes,
  sceneScriptVersions,
  sequenceElements,
  sequenceLocationLinks,
  sequences,
  shots,
  styles,
  user,
} from '@/platform/server/db/schema';
import {
  assistantTools,
  chatToolName,
} from '@/assistant/server/assistant-tools';
import { toolContext } from '@/assistant/server/assistant-chat';
import * as stills from '@/stills/server/shot-image-generation';
import * as motion from '@/motion/server/shot-motion-generation';
import * as lipsync from '@/motion/server/lipsync-shot';
import * as models from '@/sequences/server/sequence-models';
import * as uploads from '@/shots/server/media-upload';
import * as dialogue from '@/shots/server/scene-dialogue-upload';
import * as elements from '@/cast/server/sequence-elements/attach-element-upload';
import * as studio from '@/studio/server/create-studio-asset';
import * as studioActions from '@/studio/server/studio-asset-actions';
import * as clips from '@/models/server/watch-clip';
import type { OAuthApiScope } from '@/platform/server/auth/oauth-scopes';
import type { McpAuthContext } from '../auth';
import { MCP_TOOLS, serveMcpRequest } from '../server';
import { asStub } from '@/test/as-stub';
import { generationUploadTools } from './generation-uploads';
import { studioTools } from './studio';
vi.mock('@/assistant/server/durability', () => ({
  assistantStreamLog: vi.fn(),
  heldStreamLog: vi.fn(),
  sealStreamLog: vi.fn(),
}));
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({
  getEnv: () => ({ E2E_TEST: 'false', ADMIN_EMAILS: '' }),
}));
vi.mock('#flush-scheduler', () => ({ scheduleFlushAnalytics: vi.fn() }));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));
// Authenticated principals and final service results are doubles; SDK, contexts, adapters and parent-chain reads are real.
const origin = 'http://localhost:3998';
const protocol = '2026-07-28';
const run = 'synthetic-service-run';
const hookTimeout = 60_000;
const actor = { id: generateId(), organizationId: generateId() };
const foreign = { id: generateId(), organizationId: generateId() };
const ids = {
  sequence: generateId(),
  scene: generateId(),
  shot: generateId(),
  frame: generateId(),
  character: generateId(),
  location: generateId(),
  element: generateId(),
  asset: generateId(),
  version: generateId(),
  foreignSequence: generateId(),
};
let database: Awaited<ReturnType<typeof createTestDb>>;
let db: Awaited<ReturnType<typeof createTestDb>>['db'];
let scopedDb: ReturnType<typeof createScopedDb>;
const principal = () =>
  asStub<McpAuthContext>({
    kind: 'api_key',
    user: {
      id: actor.id,
      email: 'asset@example.invalid',
      name: 'Synthetic caller',
    },
    organizationId: actor.organizationId,
    organizationName: 'Synthetic assets',
  });
const envelope = z.object({
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
    })
    .optional(),
  error: z.unknown().optional(),
});
async function seedPrincipals() {
  for (const item of [actor, foreign]) {
    await db.insert(user).values({
      id: item.id,
      email: item.id + '@example.invalid',
      name: 'Synthetic caller',
    });
    await db.insert(organization).values({
      id: item.organizationId,
      name: 'Synthetic assets',
      slug: item.organizationId,
    });
  }
}
async function seedSequence() {
  const styleId = generateId();
  await db.insert(styles).values({
    id: styleId,
    organizationId: actor.organizationId,
    name: 'Synthetic style',
    config: {
      mood: 'neutral',
      artStyle: 'cinematic',
      lighting: 'natural',
      colorPalette: [],
      cameraWork: 'static',
      referenceFilms: [],
      colorGrading: 'neutral',
    },
  });
  await db.insert(sequences).values([
    {
      id: ids.sequence,
      organizationId: actor.organizationId,
      title: 'Synthetic sequence',
      styleId,
    },
    {
      id: ids.foreignSequence,
      organizationId: foreign.organizationId,
      title: 'Foreign sequence',
      styleId,
    },
  ]);
}
async function seedShot() {
  const scriptId = generateId();
  await db.insert(scenes).values({
    id: dbSceneId(ids.scene),
    sequenceId: ids.sequence,
    orderIndex: 0,
    selectedScriptVersionId: scriptId,
  });
  await db.insert(sceneScriptVersions).values({
    id: scriptId,
    sceneId: ids.scene,
    content: { extract: '小鹿 says “Keep this dialogue.”', dialogue: [] },
    source: 'edit',
  });
  await db.insert(shots).values({
    id: ids.shot,
    sequenceId: ids.sequence,
    sceneId: dbSceneId(ids.scene),
    shotNumber: 1,
    durationMs: 3000,
  });
  await db
    .insert(frames)
    .values({ id: ids.frame, shotId: ids.shot, sequenceId: ids.sequence });
}
async function seedCast() {
  await scopedDb.characters.create(
    {
      id: ids.character,
      sequenceId: ids.sequence,
      characterId: 'deer',
      name: 'Synthetic deer',
      rendering: 'Photoreal live action',
    },
    { source: 'analysis', createdBy: null }
  );
  await db.insert(locations).values({
    id: ids.location,
    organizationId: actor.organizationId,
    legacyName: 'Synthetic port',
  });
  await db.insert(sequenceLocationLinks).values({
    sequenceId: ids.sequence,
    locationId: ids.location,
    scriptLocationId: 'port',
    attached: false,
  });
  await db.insert(sequenceElements).values({
    id: ids.element,
    sequenceId: ids.sequence,
    token: 'LOGO',
    uploadedFilename: 'synthetic.png',
    imageUrl: '/r2/elements/synthetic.png',
  });
}
function observeShots() {
  const started = { workflowRunId: run, shotId: ids.shot };
  vi.spyOn(stills, 'generateShotImage').mockResolvedValue({
    ...started,
    alreadyInFlight: false,
  });
  vi.spyOn(stills, 'generateShotImageVariants').mockResolvedValue(
    asStub(started)
  );
  vi.spyOn(stills, 'selectShotImageVariant').mockResolvedValue(
    asStub({
      shotId: ids.shot,
      variantIndex: 0,
      thumbnailUrl: '/r2/thumbnails/tile.png',
      upscaleWorkflowRunId: run,
    })
  );
  vi.spyOn(motion, 'generateShotMotion').mockResolvedValue({
    ...started,
    packedShotIds: [ids.shot],
  });
  vi.spyOn(lipsync, 'startLipsync').mockResolvedValue(started);
  vi.spyOn(motion, 'cancelVideoRender').mockResolvedValue({ cancelled: true });
  vi.spyOn(motion, 'renderShotAtQuality').mockResolvedValue({
    workflowRunId: run,
    versionId: ids.version,
  });
  vi.spyOn(motion, 'renderSequenceDraftsAtQuality').mockResolvedValue({
    started: 2,
    skipped: 1,
  });
  vi.spyOn(models, 'addModelToSequence').mockResolvedValue({
    workflowRunId: run,
    variantType: 'image',
    model: 'nano_banana_2_1',
    count: 2,
    failed: 0,
    skipped: 1,
  });
  vi.spyOn(models, 'setSequenceModel').mockResolvedValue({
    variantType: 'image',
    model: 'nano_banana_2_1',
    count: 2,
  });
}
function observeUploads() {
  vi.spyOn(uploads, 'storeUpload').mockResolvedValue({
    url: uploadUrl(),
    mediaType: 'image/png',
    bytes: 3,
    rights: 'cleared',
  });
  vi.spyOn(uploads, 'replaceFrameContent').mockResolvedValue(
    asStub({
      shotId: ids.shot,
      versionId: ids.version,
      promptVersionId: null,
      promptChanged: false,
    })
  );
  vi.spyOn(uploads, 'setShotVideoFromUpload').mockResolvedValue(
    asStub({ shotId: ids.shot, versionId: ids.version, durationSeconds: 3 })
  );
  vi.spyOn(uploads, 'setSequenceMusicFromUpload').mockResolvedValue(
    asStub({ variantId: ids.version })
  );
  vi.spyOn(uploads, 'setCharacterSheetFromUpload').mockResolvedValue(
    asStub(undefined)
  );
  vi.spyOn(uploads, 'setLocationSheetFromUpload').mockResolvedValue(
    asStub(undefined)
  );
  vi.spyOn(dialogue, 'uploadSceneDialogue').mockResolvedValue({
    workflowRunId: run,
  });
  const element = { id: ids.element, token: 'LOGO', kind: 'image' };
  vi.spyOn(elements, 'attachElementUpload').mockResolvedValue(asStub(element));
  vi.spyOn(elements, 'replaceElementUpload').mockResolvedValue(asStub(element));
}
function observeStudio() {
  const assets = { assets: [{ id: ids.asset, workflowRunId: run }] };
  vi.spyOn(studio, 'createStudioAssets').mockResolvedValue(assets);
  vi.spyOn(studio, 'editStudioAsset').mockResolvedValue(assets);
  vi.spyOn(studio, 'renderStudioAssetAtQuality').mockResolvedValue(assets);
  vi.spyOn(studioActions, 'setStudioAssetFavorite').mockResolvedValue({
    id: ids.asset,
    isFavorite: true,
  });
  vi.spyOn(studioActions, 'deleteStudioAsset').mockResolvedValue({
    id: ids.asset,
  });
  vi.spyOn(studioActions, 'getStudioEditHistory').mockResolvedValue([]);
  vi.spyOn(studioActions, 'draftStudioPromptForOrganization').mockResolvedValue(
    { prompt: 'Synthetic draft' }
  );
  vi.spyOn(clips, 'watchClipForOrganization').mockResolvedValue({
    answer: 'Synthetic observation',
    model: 'synthetic-model',
  });
}
beforeAll(async () => {
  database = await createTestDb();
  db = database.db;
  vi.mocked(getDb).mockReturnValue(db);
  await seedPrincipals();
  await seedSequence();
  await seedShot();
  scopedDb = createScopedDb(actor.organizationId, actor.id);
  await seedCast();
  observeShots();
  observeUploads();
  observeStudio();
}, hookTimeout);
afterAll(async () => {
  vi.restoreAllMocks();
  await database.close();
});
beforeEach(() => {
  vi.clearAllMocks();
});
type Entry = 'mcp' | 'assistant-zh' | 'assistant-en';
const entries: Entry[] = ['mcp', 'assistant-zh', 'assistant-en'];
function request(name: string, args: unknown, locale = 'zh-CN') {
  return new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocol,
      'mcp-method': 'tools/call',
      'mcp-name': 'openstory.' + name,
      cookie: LOCALE_COOKIE + '=' + locale,
      'cf-connecting-ip': '192.0.2.14',
      'user-agent': 'synthetic-asset-contract',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'openstory.' + name,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': protocol,
          'io.modelcontextprotocol/clientInfo': {
            name: 'synthetic-asset-contract',
            version: '1',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}
async function mcpCall(name: string, args: unknown, auth = principal()) {
  const response = await serveMcpRequest(
    request(name, args),
    auth,
    'tools/call'
  );
  expect(response.status).toBe(200);
  return envelope.parse(await response.json());
}
async function assistantCall(name: string, args: unknown, locale?: string) {
  const tool = assistantTools().find(
    (item) => item.name === chatToolName('openstory.' + name)
  );
  if (!tool?.execute) throw new Error('Missing assistant tool ' + name);
  const headers = new Headers({
    'cf-connecting-ip': '192.0.2.14',
    'user-agent': 'synthetic-asset-contract',
  });
  if (locale !== undefined) headers.set('cookie', LOCALE_COOKIE + '=' + locale);
  return tool.execute(args, {
    context: toolContext({
      promptLocale: resolveLocale(locale),
      user: principal().user,
      scopedDb,
      organizationId: actor.organizationId,
      organizationName: 'Synthetic assets',
      origin,
      request: new Request(origin + '/api/assistant/chat', { headers }),
    }),
  });
}
async function call(entry: Entry, name: string, args: unknown) {
  if (entry !== 'mcp')
    return assistantCall(name, args, entry === 'assistant-en' ? 'en' : 'zh-CN');
  const body = await mcpCall(name, args);
  expect(body.error).toBeUndefined();
  expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
  return body.result?.structuredContent;
}
function sequenceArgs() {
  return { sequenceId: ids.sequence };
}
function shotArgs() {
  return { ...sequenceArgs(), shotId: ids.shot };
}
function uploadUrl() {
  return (
    '/r2/thumbnails/organizations/' +
    actor.organizationId +
    '/sequences/' +
    ids.sequence +
    '/uploads/synthetic.png'
  );
}
const shot = shotArgs;
const sequence = sequenceArgs;
const fromUpload = () => ({ ...shot(), upload: uploadUrl() });
const sequenceUpload = () => ({ ...sequence(), upload: uploadUrl() });
const model = () => ({
  ...sequence(),
  variantType: 'image',
  model: 'nano_banana_2_1',
});
const asset = () => ({ id: ids.asset });
type Observation = { mock: { calls: readonly (readonly unknown[])[] } };
type Shape =
  | 'shot'
  | 'sequence'
  | 'element'
  | 'upload'
  | 'studio'
  | 'draft'
  | 'clip'
  | 'read';
type Contract = readonly [
  string,
  OAuthApiScope,
  () => Record<string, unknown>,
  (() => Observation)?,
  Shape?,
];
const contracts: Contract[] = [
  ['list_models', 'sequences:read', () => ({})],
  ['get_shot_variant_grid', 'sequences:read', shot],
  [
    'generate_shot_image',
    'generate',
    shot,
    () => vi.mocked(stills.generateShotImage),
    'shot',
  ],
  [
    'generate_shot_image_variants',
    'generate',
    shot,
    () => vi.mocked(stills.generateShotImageVariants),
    'shot',
  ],
  [
    'select_shot_image_variant',
    'generate',
    () => ({ ...shot(), variantIndex: 0 }),
    () => vi.mocked(stills.selectShotImageVariant),
    'shot',
  ],
  [
    'generate_shot_video',
    'generate',
    shot,
    () => vi.mocked(motion.generateShotMotion),
    'shot',
  ],
  [
    'lipsync_shot',
    'generate',
    shot,
    () => vi.mocked(lipsync.startLipsync),
    'shot',
  ],
  [
    'cancel_video_render',
    'sequences:write',
    () => ({ ...shot(), versionId: ids.version }),
    () => vi.mocked(motion.cancelVideoRender),
    'shot',
  ],
  [
    'render_shot_at_quality',
    'generate',
    shot,
    () => vi.mocked(motion.renderShotAtQuality),
    'shot',
  ],
  [
    'render_sequence_drafts_at_quality',
    'generate',
    sequence,
    () => vi.mocked(motion.renderSequenceDraftsAtQuality),
    'sequence',
  ],
  [
    'add_model_to_sequence',
    'generate',
    model,
    () => vi.mocked(models.addModelToSequence),
    'sequence',
  ],
  [
    'select_sequence_model',
    'sequences:write',
    model,
    () => vi.mocked(models.setSequenceModel),
    'sequence',
  ],
  [
    'upload_media',
    'sequences:write',
    () => ({ use: 'studio', data: 'AAAA', mimeType: 'image/png' }),
    () => vi.mocked(uploads.storeUpload),
    'upload',
  ],
  [
    'set_shot_image_from_upload',
    'sequences:write',
    fromUpload,
    () => vi.mocked(uploads.replaceFrameContent),
    'shot',
  ],
  [
    'set_shot_video_from_upload',
    'sequences:write',
    fromUpload,
    () => vi.mocked(uploads.setShotVideoFromUpload),
    'shot',
  ],
  [
    'set_music_from_upload',
    'sequences:write',
    sequenceUpload,
    () => vi.mocked(uploads.setSequenceMusicFromUpload),
    'sequence',
  ],
  [
    'set_scene_dialogue_from_upload',
    'generate',
    () => ({ ...sequenceUpload(), sceneId: ids.scene }),
    () => vi.mocked(dialogue.uploadSceneDialogue),
    'sequence',
  ],
  [
    'set_character_sheet_from_upload',
    'sequences:write',
    () => ({ ...sequenceUpload(), characterId: ids.character }),
    () => vi.mocked(uploads.setCharacterSheetFromUpload),
    'sequence',
  ],
  [
    'set_location_sheet_from_upload',
    'sequences:write',
    () => ({ ...sequenceUpload(), locationId: ids.location }),
    () => vi.mocked(uploads.setLocationSheetFromUpload),
    'sequence',
  ],
  [
    'add_element',
    'generate',
    () => ({ ...sequenceUpload(), name: 'Logo' }),
    () => vi.mocked(elements.attachElementUpload),
    'element',
  ],
  [
    'replace_element',
    'generate',
    () => ({ ...sequenceUpload(), elementId: ids.element, name: 'Logo' }),
    () => vi.mocked(elements.replaceElementUpload),
    'element',
  ],
  [
    'create_studio_assets',
    'generate',
    () => ({
      activity: 'image',
      prompt: 'Keep “小鹿”.',
      imageModel: 'nano_banana_2_1',
      aspectRatio: '16:9',
      count: 2,
    }),
    () => vi.mocked(studio.createStudioAssets),
    'studio',
  ],
  [
    'edit_studio_asset',
    'generate',
    () => ({ ...asset(), prompt: 'Keep “小鹿”.', draft: true }),
    () => vi.mocked(studio.editStudioAsset),
    'studio',
  ],
  [
    'render_studio_asset_at_quality',
    'generate',
    asset,
    () => vi.mocked(studio.renderStudioAssetAtQuality),
    'studio',
  ],
  [
    'set_studio_asset_favorite',
    'sequences:write',
    () => ({ ...asset(), isFavorite: true }),
    () => vi.mocked(studioActions.setStudioAssetFavorite),
    'read',
  ],
  [
    'delete_studio_asset',
    'sequences:write',
    asset,
    () => vi.mocked(studioActions.deleteStudioAsset),
    'read',
  ],
  [
    'draft_studio_prompt',
    'generate',
    () => ({ activity: 'image', currentPrompt: 'Keep “小鹿”.' }),
    () => vi.mocked(studioActions.draftStudioPromptForOrganization),
    'draft',
  ],
  [
    'watch_clip',
    'generate',
    () => ({
      url: '/r2/videos/synthetic.mp4',
      question: 'What does 小鹿 say?',
    }),
    () => vi.mocked(clips.watchClipForOrganization),
    'clip',
  ],
  [
    'get_studio_edit_history',
    'sequences:read',
    asset,
    () => vi.mocked(studioActions.getStudioEditHistory),
    'read',
  ],
];
function expectedLocale(entry: Entry): Locale {
  return entry === 'assistant-zh' ? 'zh-CN' : 'en';
}
function checkContext(contract: Contract, entry: Entry) {
  const [name, , , observe, shape = 'read'] = contract;
  if (!observe) return;
  const spy = observe();
  expect(spy.mock.calls).toHaveLength(1);
  const args = spy.mock.calls[0] ?? [];
  const identity = { organizationId: actor.organizationId, userId: actor.id };
  const locale = { promptLocale: expectedLocale(entry) };
  if (['studio', 'draft', 'clip', 'read'].includes(shape)) {
    expect(args[0]).toMatchObject(identity);
    if (['draft', 'clip'].includes(shape))
      expect(args[2]).toBe(expectedLocale(entry));
    if (shape === 'studio')
      expect(args.at(-1)).toMatchObject({
        ...locale,
        ipAddress: '192.0.2.14',
        userAgent: 'synthetic-asset-contract',
      });
    return;
  }
  expect(args[0]).toMatchObject({ ...locale, scopedDb: identity });
  if (['element', 'upload'].includes(shape))
    expect(args[0]).toMatchObject({ userId: actor.id });
  else
    expect(args[0]).toMatchObject({
      user: { id: actor.id },
      sequence: { id: ids.sequence },
    });
  if (shape === 'element')
    expect(args[0]).toMatchObject({ ...identity, sequenceId: ids.sequence });
  if (shape === 'shot')
    expect(args[0]).toMatchObject({
      organizationId: actor.organizationId,
      shot: { id: ids.shot },
      frame: { id: ids.frame },
    });
  if (name === 'upload_media')
    expect(args[0]).toMatchObject({ sequenceId: null, use: 'studio' });
}
const contractCases = contracts.map((contract) => ({
  name: contract[0],
  contract,
}));
describe.each(entries)('%s asset adapter contracts', (entry) => {
  it.each(contractCases)(
    '$name reaches its service with trusted language and identity',
    async ({ contract }) => {
      await call(entry, contract[0], contract[2]());
      checkContext(contract, entry);
    }
  );
  it.each(contractCases)(
    '$name refuses identity and locale injection before service work',
    async ({ contract }) => {
      const [name, , args, observe] = contract;
      const maliciousFields = {
        promptLocale: 'en',
        userId: foreign.id,
        organizationId: foreign.organizationId,
        scopedDb: {},
        request: { promptLocale: 'en' },
      };
      for (const [key, value] of Object.entries(maliciousFields)) {
        const malicious = { ...args(), [key]: value };
        if (entry === 'mcp') {
          const body = await mcpCall(name, malicious);
          expect(
            body.error !== undefined || body.result?.isError === true
          ).toBe(true);
        } else await expect(call(entry, name, malicious)).rejects.toThrow();
      }
      if (observe) expect(observe().mock.calls).toHaveLength(0);
    }
  );
});
describe('registered scope and ownership contracts', () => {
  it('covers every owned definition on both real tool catalogs', () => {
    const owned = [...generationUploadTools, ...studioTools];
    expect(contracts.map(([name]) => 'openstory.' + name).sort()).toEqual(
      owned.map((tool) => tool.name).sort()
    );
    for (const tool of owned) expect(MCP_TOOLS).toContain(tool);
    expect(
      assistantTools().filter((tool) =>
        owned.some((item) => chatToolName(item.name) === tool.name)
      )
    ).toHaveLength(owned.length);
  });
  it.each(contractCases)(
    '$name retains its original OAuth scope',
    async ({ contract }) => {
      const [name, scope, args, observe] = contract;
      const auth = {
        ...principal(),
        kind: 'oauth' as const,
        scopes: [
          scope === 'sequences:read'
            ? ('generate' as const)
            : ('sequences:read' as const),
        ],
      };
      const body = await mcpCall(name, args(), auth);
      expect(body.result).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'INSUFFICIENT_SCOPE' } },
      });
      if (observe) expect(observe().mock.calls).toHaveLength(0);
    }
  );
});
describe('production ownership and registered edits', () => {
  it.each(
    contractCases.filter(({ contract }) => 'sequenceId' in contract[2]())
  )(
    '$name rejects a foreign sequence before service work',
    async ({ contract }) => {
      const [name, , args, observe] = contract;
      const body = await mcpCall(name, {
        ...args(),
        sequenceId: ids.foreignSequence,
      });
      expect(body.result).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'NOT_FOUND' } },
      });
      if (observe) expect(observe().mock.calls).toHaveLength(0);
    }
  );
  it('preserves the registered upload edit through apply_sequence_edits', async () => {
    await call('assistant-zh', 'apply_sequence_edits', {
      ...sequence(),
      changes: [
        {
          tool: 'set_shot_image_from_upload',
          arguments: { shotId: ids.shot, upload: uploadUrl() },
        },
      ],
    });
    const contract = contracts.find(
      ([name]) => name === 'set_shot_image_from_upload'
    );
    if (!contract) throw new Error('Missing upload contract');
    checkContext(contract, 'assistant-zh');
  });
});
