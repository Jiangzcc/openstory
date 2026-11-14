import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServerEntry } from '@tanstack/react-start/server';
import { z } from 'zod';
// oxlint-disable-next-line boundaries/no-raw-db -- substitute only the isolated in-memory D1 handle
import { getDb } from '#db-client';
import { generateId } from '@/platform/id';
import { MOCK_SYSTEM_STYLES } from '@/look/style-templates';
import { unpackModelRuntimeConfiguration } from '@/models/model-runtime-configuration';
import type { WorkflowModelConfiguration } from '@/models/model-runtime-configuration';
import { createTextChannelsAdminMethods } from '@/models/server/db/text-channels';
import { createTestDb } from '@/platform/server/db/test-d1';
import {
  member,
  organization,
  sequences,
  styles,
  user,
} from '@/platform/server/db/schema';
import type { StoryboardWorkflowInput } from '@/platform/server/workflow/types';
import * as launchers from '@/sequences/server/launchers';
import { asStub } from '@/test/as-stub';
import type { McpAuthContext } from '../auth';
import { serveMcpRequest } from '../server';

type Dispatch = {
  id: string;
  params: StoryboardWorkflowInput & {
    modelConfiguration: WorkflowModelConfiguration;
  };
};
const runtime = vi.hoisted(() => ({
  create: vi.fn(async ({ id }: Dispatch) => ({ id })),
  network: vi.fn(async () => {
    throw new Error('Unexpected network in the synthetic storyboard contract');
  }),
}));
const MOCK_SECRET = 'synthetic-storyboard-channel-secret-never-sent';
const MCP_PROTOCOL = '2026-07-28';
const HOOK_TIMEOUT_MS = 60_000;
const origin = 'http://localhost:3998';
vi.mock('#db-client', () => ({ getDb: vi.fn() }));
vi.mock('#env', () => ({
  getEnv: () => ({
    VITE_APP_URL: 'http://localhost:3998',
    API_KEY_ENCRYPTION_KEY: 'synthetic-storyboard-encryption-key',
    OPENROUTER_KEY: 'synthetic-platform-key-never-sent',
    FAL_KEY: 'synthetic-platform-key-never-sent',
    ELEVENLABS_API_KEY: '',
    ADMIN_EMAILS: '',
    E2E_TEST: 'false',
    STORYBOARD_WORKFLOW: { create: runtime.create },
  }),
}));
vi.mock('#flush-scheduler', () => ({ scheduleFlushAnalytics: vi.fn() }));
vi.mock('@/platform/server/observability/product-events', () => ({
  captureProductEvent: vi.fn(),
}));

// Synthetic verified principal and final binding; registered MCP, validators, services, launcher and D1 stay real.
const actor = { id: generateId(), organizationId: generateId() };
const sourceId = generateId();
const foreignOrganizationId = generateId();
const channel = {
  revision: 0,
  id: 'synthetic-storyboard-channel',
  name: 'Synthetic storyboard channel',
  baseUrl: 'https://storyboard.invalid/v1',
  protocol: 'openai-chat-completions' as const,
  enabled: true,
  apiKey: MOCK_SECRET,
};
const model = {
  revision: 1,
  id: 'custom:storyboard-contract' as const,
  name: 'Synthetic storyboard model',
  channelId: channel.id,
  upstreamModel: 'synthetic-storyboard-upstream',
  enabled: true,
  vision: true,
  structuredOutput: true,
  tools: true,
  contextWindow: 16_000,
  maxOutputTokens: 4_000,
  inputPricePerMillion: 2,
  outputPricePerMillion: 6,
};
const auth = asStub<McpAuthContext>({
  kind: 'oauth',
  user: { id: actor.id, email: 'storyboard@example.invalid' },
  organizationId: actor.organizationId,
  organizationName: 'Synthetic storyboard organization',
  scopes: ['generate'],
});
const envelope = z.object({
  result: z
    .object({ isError: z.boolean().optional(), structuredContent: z.unknown() })
    .optional(),
  error: z.unknown().optional(),
});
let database: Awaited<ReturnType<typeof createTestDb>>;
const capturedConfiguration = vi.spyOn(
  launchers,
  'loadStoryboardModelConfiguration'
);

async function seedPrincipal() {
  const db = database.db;
  await db.insert(user).values({
    id: actor.id,
    email: auth.user.email,
    name: 'Synthetic storyboard caller',
  });
  await db.insert(organization).values({
    id: actor.organizationId,
    name: auth.organizationName,
    slug: actor.organizationId,
  });
  await db.insert(member).values({
    id: generateId(),
    userId: actor.id,
    organizationId: actor.organizationId,
    role: 'owner',
    createdAt: new Date(),
  });
}

async function seedSource() {
  const db = database.db;
  const style = MOCK_SYSTEM_STYLES[0];
  if (!style) throw new Error('Missing repository style fixture');
  const styleId = generateId();
  await db.insert(styles).values({
    id: styleId,
    organizationId: actor.organizationId,
    name: style.name,
    config: style.config,
  });
  await db.insert(sequences).values({
    id: sourceId,
    organizationId: actor.organizationId,
    createdBy: actor.id,
    title: 'Synthetic source storyboard',
    styleId,
    script: '守塔人说：“保留原文。” A keeper returns to the lighthouse.',
    analysisModel: 'google/gemini-3.8-flash',
    imageModel: 'nano_banana_2',
    videoModel: 'seedance_v2',
    generationStopAt: 'script',
    generateStartFrames: true,
    generateVoices: false,
    status: 'completed',
  });
}

beforeAll(async () => {
  database = await createTestDb();
  vi.mocked(getDb).mockReturnValue(database.db);
  vi.stubGlobal('fetch', runtime.network);
  await seedPrincipal();
  await seedSource();
  const admin = createTextChannelsAdminMethods(database.db);
  await admin.saveChannel(channel);
  await admin.saveModel(model);
}, HOOK_TIMEOUT_MS);
beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await database.close();
});

async function regenerate(
  input: Record<string, unknown>,
  principal = auth,
  locale = 'zh-CN'
) {
  const app = createServerEntry({
    fetch: (request) => serveMcpRequest(request, principal, 'tools/call'),
  });
  const response = await app.fetch(mcpRequest(input, locale));
  expect(response.status, await response.clone().text()).toBe(200);
  return envelope.parse(await response.json());
}

function mcpRequest(input: Record<string, unknown>, locale: string) {
  return new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL,
      'mcp-method': 'tools/call',
      'mcp-name': 'openstory.regenerate_storyboard',
      cookie: 'openstory_locale=' + locale,
      'cf-ipcountry': 'CN',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'openstory.regenerate_storyboard',
        arguments: {
          sequenceId: sourceId,
          analysisModel: model.id,
          script: '原文不变。A keeper returns. ' + generateId(),
          ...input,
        },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL,
          'io.modelcontextprotocol/clientInfo': {
            name: 'synthetic-storyboard-contract',
            version: '1',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

const createdSchema = z.object({
  sourceSequenceId: z.string(),
  sequenceId: z.string(),
  workflowRunId: z.string(),
});

function expectDispatch(content: z.infer<typeof createdSchema>) {
  expect(runtime.create).toHaveBeenCalledOnce();
  const dispatch = runtime.create.mock.calls[0]?.[0];
  expect(dispatch).toMatchObject({
    id: content.workflowRunId,
    params: {
      userId: actor.id,
      organizationId: actor.organizationId,
      promptLocale: 'en',
      userCountry: 'CN',
      sequenceId: content.sequenceId,
      analysisModelId: model.id,
      stopAt: 'script',
      notify: false,
    },
  });
  if (!dispatch) throw new Error('Missing mock dispatch');
  return dispatch;
}

async function expectCapturedConfiguration(dispatch: Dispatch) {
  expect(capturedConfiguration).toHaveBeenCalledOnce();
  const configuration = await capturedConfiguration.mock.results[0]?.value;
  expect(configuration?.textModelRouting).toContainEqual(
    expect.objectContaining({
      modelId: model.id,
      upstreamModel: model.upstreamModel,
    })
  );
  expect(
    unpackModelRuntimeConfiguration(dispatch.params.modelConfiguration)
  ).toEqual(configuration);
  expect(JSON.stringify(dispatch)).not.toContain(MOCK_SECRET);
}

it.each(['zh-CN', 'en'])(
  'regenerates through real shared services and dispatches the custom model with %s cookies',
  async (locale) => {
    const result = await regenerate({}, auth, locale);
    expect(result.error).toBeUndefined();
    expect(result.result?.isError, JSON.stringify(result)).not.toBe(true);
    const content = createdSchema.parse(result.result?.structuredContent);
    expect(content.sourceSequenceId).toBe(sourceId);
    expect(content.sequenceId).not.toBe(sourceId);
    await expectCapturedConfiguration(expectDispatch(content));
    const stored = await database.db
      .select()
      .from(sequences)
      .where(eq(sequences.id, content.sequenceId));
    expect(stored[0]).toMatchObject({
      organizationId: actor.organizationId,
      createdBy: actor.id,
      analysisModel: model.id,
      workflowRunId: content.workflowRunId,
    });
    expect(runtime.network).not.toHaveBeenCalled();
  }
);

it.each([
  {
    name: 'missing generate scope',
    principal: { ...auth, scopes: ['sequences:read'] },
    code: 'INSUFFICIENT_SCOPE',
  },
  {
    name: 'foreign source organization',
    principal: { ...auth, organizationId: foreignOrganizationId },
    code: 'NOT_FOUND',
  },
])('refuses $name before creation or dispatch', async ({ principal, code }) => {
  const before = await database.db.select({ id: sequences.id }).from(sequences);
  const result = await regenerate({}, principal);
  expect(result.result).toMatchObject({
    isError: true,
    structuredContent: { error: { code } },
  });
  expect(capturedConfiguration).not.toHaveBeenCalled();
  expect(runtime.create).not.toHaveBeenCalled();
  expect(
    await database.db.select({ id: sequences.id }).from(sequences)
  ).toEqual(before);
  expect(runtime.network).not.toHaveBeenCalled();
});

it('rejects a syntactically valid but unbound custom model before any new sequence or dispatch', async () => {
  const before = await database.db.select({ id: sequences.id }).from(sequences);
  const result = await regenerate({
    analysisModel: 'custom:unbound-storyboard',
  });
  expect(result.result).toMatchObject({
    isError: true,
    structuredContent: { error: { code: 'VALIDATION_ERROR' } },
  });
  expect(capturedConfiguration).toHaveBeenCalledOnce();
  expect(runtime.create).not.toHaveBeenCalled();
  expect(
    await database.db.select({ id: sequences.id }).from(sequences)
  ).toEqual(before);
  expect(runtime.network).not.toHaveBeenCalled();
});
