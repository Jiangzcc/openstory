import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Database } from '@/platform/server/db/client';
import type { ScopedDb } from '@/platform/server/db/scoped';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { AssetGenerationWorkflowInput } from '@/platform/server/workflow/types';
import type {
  GeneratedAssetActivity,
  GeneratedAssetInput,
} from '@/platform/server/db/schema';
import {
  contentProvenance,
  organization,
  user,
} from '@/platform/server/db/schema';
import { createTestDb } from '@/platform/server/db/test-d1';
import { createProvenanceMethods } from '@/platform/server/db/scoped/compliance';
import { createGeneratedAssetsMethods } from '@/models/server/db/generated-assets';
import {
  organizationKeyPrefix,
  STORAGE_BUCKETS,
} from '@/platform/server/storage/buckets';
import { sha256Hex } from '@/platform/compliance/hash';
import { generateId } from '@/platform/id';
import { asStub } from '@/test/as-stub';

const doubles = {
  schema: vi.fn(async () => ({
    type: 'object' as const,
    properties: { prompt: { type: 'string' as const } },
    required: ['prompt'],
  })),
  credits: vi.fn(async () => undefined),
  gate: vi.fn(async () => undefined),
  trigger:
    vi.fn<typeof import('@/platform/server/workflow/client').triggerWorkflow>(),
  config: vi.fn(),
  submit: vi.fn(async () => ({ request_id: 'mock-catalog-request' })),
  status: vi.fn(async () => ({ status: 'COMPLETED' })),
  result: vi.fn(),
  upload: vi.fn<typeof import('#storage').uploadFile>(),
  fetch: vi.fn<typeof fetch>(),
};

// Real service, parent body, output extraction, provenance and scoped SQL; external boundaries are doubles.
vi.doMock('@/models/server/schema-fetch', () => ({
  fetchModelInputSchema: doubles.schema,
}));
vi.doMock('@/billing/server/preflight', () => ({
  requireCredits: doubles.credits,
}));
vi.doMock('@/platform/server/compliance/generation-gate', () => ({
  requireGenerationAllowed: doubles.gate,
}));
vi.doMock('@/platform/server/workflow/client', () => ({
  triggerWorkflow: doubles.trigger,
}));
vi.doMock('@fal-ai/client', () => ({
  fal: {
    config: doubles.config,
    queue: {
      submit: doubles.submit,
      status: doubles.status,
      result: doubles.result,
    },
  },
}));
vi.doMock('#storage', () => ({ uploadFile: doubles.upload }));

const { createGeneratedAsset } =
  await import('@/models/server/generated-assets');
const { AssetGenerationWorkflow } = await import('./asset-generation-workflow');
const PROMPT = 'Mock catalog input remains unchanged 中文';
const ENDPOINT = 'mock-catalog/model';
const RUN_ID = 'mock-catalog-run';
const ACTIVITIES = ['image', 'video', 'audio'] as const;
const BUCKETS = {
  image: STORAGE_BUCKETS.THUMBNAILS,
  video: STORAGE_BUCKETS.VIDEOS,
  audio: STORAGE_BUCKETS.AUDIO,
} as const;
let db: Database;
let closeDb: () => Promise<void>;

class CatalogProbe extends AssetGenerationWorkflow {
  execute(
    event: WorkflowEvent<AssetGenerationWorkflowInput>,
    step: WorkflowStep,
    scope: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scope);
  }
  fail(
    event: WorkflowEvent<AssetGenerationWorkflowInput>,
    scope: WorkflowScopedDb,
    error = 'Mock catalog failure'
  ) {
    return this.onFailure({ event, scopedDb: scope, error });
  }
}

function workflow() {
  type Ctor = ConstructorParameters<typeof CatalogProbe>;
  return new CatalogProbe(asStub<Ctor[0]>(undefined), asStub<Ctor[1]>({}));
}

function immediateStep() {
  const names: string[] = [];
  const step = asStub<WorkflowStep>({
    do: async (name: string, callback: () => Promise<unknown>) => {
      names.push(name);
      return callback();
    },
    sleep: vi.fn(async () => undefined),
  });
  return { step, names };
}

async function scope() {
  const userId = generateId();
  const organizationId = generateId();
  await db.insert(user).values({
    id: userId,
    name: 'Mock catalog user',
    email: userId + '@example.invalid',
  });
  await db.insert(organization).values({
    id: organizationId,
    name: 'Mock catalog organization',
    slug: organizationId,
  });
  const generatedAssets = createGeneratedAssetsMethods(
    db,
    organizationId,
    userId
  );
  const provenance = createProvenanceMethods(db, organizationId, userId);
  const key = vi.fn(async () => ({
    key: 'mock-only-fal-key',
    source: 'platform' as const,
  }));
  return {
    organizationId,
    userId,
    assets: generatedAssets,
    request: asStub<ScopedDb>({ organizationId, userId, generatedAssets }),
    workflow: asStub<WorkflowScopedDb>({
      organizationId,
      generatedAssets,
      provenance,
      credentials: { resolveKey: key },
    }),
    key,
  };
}

function data(
  activity: GeneratedAssetActivity = 'image',
  input: GeneratedAssetInput = { prompt: PROMPT }
) {
  return {
    activity,
    endpointId: ENDPOINT,
    modelName: 'Mock catalog model',
    input,
  };
}

function dispatchedEvent(): WorkflowEvent<AssetGenerationWorkflowInput> {
  const payload = doubles.trigger.mock.calls[0]?.[1];
  if (!payload || !('assetId' in payload))
    throw new Error('Missing mock catalog dispatch');
  return {
    workflowName: 'AssetGenerationWorkflow',
    instanceId: RUN_ID,
    timestamp: new Date(0),
    payload: asStub<AssetGenerationWorkflowInput>(payload),
  };
}

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(() => closeDb());
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  doubles.trigger.mockReset().mockResolvedValue(RUN_ID);
  doubles.result.mockReset().mockResolvedValue({
    data: {
      images: [
        { url: 'https://mock.invalid/one.png', content_type: 'image/png' },
      ],
    },
  });
  doubles.fetch.mockReset().mockImplementation(
    async () =>
      new Response('Mock streamed output', {
        headers: { 'content-type': 'image/png' },
      })
  );
  doubles.upload.mockReset().mockImplementation(async (bucket, path, file) => {
    const body = file instanceof Uint8Array ? Uint8Array.from(file) : file;
    await new Response(body).arrayBuffer();
    return {
      path: `${bucket}/${path}`,
      publicUrl: `/r2/${bucket}/${path}`,
      fullPath: `${bucket}/${path}`,
    };
  });
  vi.stubGlobal('fetch', doubles.fetch);
});

describe('catalog entry to stored result contract', () => {
  it.each(
    ACTIVITIES.flatMap((activity) =>
      (['zh-CN', 'en'] as const).map((locale) => ({ activity, locale }))
    )
  )(
    'keeps trusted identity and $locale on $activity dispatch',
    async ({ activity, locale }) => {
      const owner = await scope();
      const clientData = {
        ...data(activity),
        userId: generateId(),
        organizationId: generateId(),
        promptLocale: locale === 'en' ? 'zh-CN' : 'en',
      };
      const result = await createGeneratedAsset(
        owner.request,
        clientData,
        locale
      );
      expect(result).toEqual({
        ok: true,
        id: expect.any(String),
        workflowRunId: RUN_ID,
      });
      const event = dispatchedEvent();
      expect(event.payload).toEqual({
        promptLocale: locale,
        userId: owner.userId,
        organizationId: owner.organizationId,
        assetId: expect.any(String),
        endpointId: ENDPOINT,
        activity,
        input: { prompt: PROMPT },
      });
      expect(doubles.trigger).toHaveBeenCalledWith('/asset', event.payload, {
        deduplicationId: `asset-${event.payload.assetId}`,
      });
      expect(doubles.gate).toHaveBeenCalledWith({
        userId: owner.userId,
        organizationId: owner.organizationId,
      });
      expect(await owner.assets.getById(event.payload.assetId)).toMatchObject({
        organizationId: owner.organizationId,
        userId: owner.userId,
        status: 'queued',
        provider: 'fal',
        workflowRunId: RUN_ID,
      });
      expect(doubles.submit).not.toHaveBeenCalled();
    }
  );

  it.each(ACTIVITIES)(
    'marks a refused %s dispatch failed without provider work',
    async (activity) => {
      const owner = await scope();
      const failure = new Error('Mock dispatch refused');
      doubles.trigger.mockRejectedValueOnce(failure);
      await expect(
        createGeneratedAsset(owner.request, data(activity), 'zh-CN')
      ).rejects.toBe(failure);
      const [row] = (await owner.assets.list()).assets;
      expect(row).toMatchObject({
        status: 'failed',
        workflowRunId: null,
        outputs: null,
        provider: 'fal',
      });
      expect(row?.error).toBeTruthy();
      expect(doubles.submit).not.toHaveBeenCalled();
    }
  );

  it.each(['running', 'completed'] as const)(
    'retains real %s after dispatch when run-id persistence fails',
    async (status) => {
      const owner = await scope();
      const setRunId = vi
        .spyOn(owner.assets, 'setWorkflowRunId')
        .mockRejectedValueOnce(new Error('Mock D1 run-id write failure'));
      doubles.trigger.mockImplementationOnce(async (_path, payload) => {
        if (!('assetId' in payload)) throw new Error('Unexpected dispatch');
        const assetId = asStub<string>(payload.assetId);
        await owner.assets.markRunning(assetId);
        if (status === 'completed')
          await owner.assets.markCompleted(assetId, {
            provider: 'fal',
            outputs: [
              { url: '/r2/mock/finished.png', contentType: 'image/png' },
            ],
          });
        return RUN_ID;
      });
      const result = await createGeneratedAsset(owner.request, data(), 'en');
      expect(result).toMatchObject({ ok: true, workflowRunId: RUN_ID });
      expect(setRunId).toHaveBeenCalledOnce();
      const [row] = (await owner.assets.list()).assets;
      expect(row).toMatchObject({ status, workflowRunId: null, error: null });
      expect(doubles.trigger).toHaveBeenCalledOnce();
    }
  );

  it.each(ACTIVITIES)(
    'stores every distinct %s output with matching provenance and the fal-only route',
    async (activity) => {
      const owner = await scope();
      await createGeneratedAsset(owner.request, data(activity), 'zh-CN');
      const event = dispatchedEvent();
      const contentType = {
        image: 'image/png',
        video: 'video/mp4',
        audio: 'audio/wav',
      }[activity];
      const suffix = { image: 'png', video: 'mp4', audio: 'wav' }[activity];
      const urls = [
        `https://mock.invalid/one.${suffix}`,
        `https://mock.invalid/two.${suffix}`,
      ];
      doubles.result.mockResolvedValueOnce({
        data: {
          outputs: urls.map((url) => ({ url, content_type: contentType })),
          output: urls[0],
        },
      });
      const steps = immediateStep();
      const result = await workflow().execute(
        event,
        steps.step,
        owner.workflow
      );
      const row = await owner.assets.getById(event.payload.assetId);
      expect(row).toMatchObject({
        status: 'completed',
        provider: 'fal',
        costMicros: null,
        error: null,
        outputs: result.outputs,
      });
      expect(result.outputs).toHaveLength(urls.length);
      expect(doubles.upload.mock.calls.map((call) => call[0])).toEqual(
        urls.map(() => BUCKETS[activity])
      );
      const expectedKeys = urls.map(
        (_url, index) =>
          `${BUCKETS[activity]}/${organizationKeyPrefix(owner.organizationId)}/assets/${event.payload.assetId}/output-${index}.${suffix}`
      );
      expect(result.outputs.map((output) => output.url)).toEqual(
        expectedKeys.map((key) => '/r2/' + key)
      );
      const provenance = (await db.select().from(contentProvenance)).filter(
        (record) => record.organizationId === owner.organizationId
      );
      expect(provenance).toHaveLength(result.outputs.length);
      expect(
        provenance
          .map((record) => record.storageKey)
          .sort((left, right) => String(left).localeCompare(String(right)))
      ).toEqual([...expectedKeys].sort());
      for (const record of provenance)
        expect(record).toMatchObject({
          userId: owner.userId,
          provider: 'fal',
          model: ENDPOINT,
          providerRequestId: 'mock-catalog-request',
          workflowRunId: RUN_ID,
          promptSha256: await sha256Hex(PROMPT),
        });
      expect(steps.names).toEqual([
        'set-running',
        'submit-asset-job',
        'asset-poll-batch-0',
        'fetch-result',
        'upload-outputs',
        'persist-result',
        'record-provenance',
      ]);
      expect(owner.key).toHaveBeenCalledTimes(3);
      expect(doubles.submit).toHaveBeenCalledOnce();
      expect(doubles.submit).toHaveBeenCalledWith(ENDPOINT, {
        input: { prompt: PROMPT },
      });
    }
  );

  it('rejects another organization before submitting or modifying its row', async () => {
    const owner = await scope();
    const stranger = await scope();
    await createGeneratedAsset(owner.request, data(), 'en');
    const event = dispatchedEvent();
    await expect(
      workflow().execute(event, immediateStep().step, stranger.workflow)
    ).rejects.toThrow('not found for this organization');
    await expect(workflow().fail(event, stranger.workflow)).rejects.toThrow(
      'not found for this organization'
    );
    expect(await owner.assets.getById(event.payload.assetId)).toMatchObject({
      status: 'queued',
      error: null,
    });
    expect(await stranger.assets.getById(event.payload.assetId)).toBeNull();
    expect(doubles.submit).not.toHaveBeenCalled();
  });

  it('does not complete or publish a partial upload and the failure hook records the failure', async () => {
    const owner = await scope();
    await createGeneratedAsset(owner.request, data(), 'en');
    const event = dispatchedEvent();
    doubles.result.mockResolvedValueOnce({
      data: {
        images: [
          'https://mock.invalid/one.png',
          'https://mock.invalid/two.png',
        ],
      },
    });
    doubles.fetch
      .mockResolvedValueOnce(new Response('Mock first output'))
      .mockResolvedValueOnce(
        new Response('Mock unavailable output', { status: 503 })
      );
    await expect(
      workflow().execute(event, immediateStep().step, owner.workflow)
    ).rejects.toThrow('Failed to download output 1');
    expect(doubles.upload).toHaveBeenCalledOnce();
    expect(await owner.assets.getById(event.payload.assetId)).toMatchObject({
      status: 'running',
      outputs: null,
      costMicros: null,
    });
    await workflow().fail(
      event,
      owner.workflow,
      'Mock sanitized output failure'
    );
    expect(await owner.assets.getById(event.payload.assetId)).toMatchObject({
      status: 'failed',
      error: 'Mock sanitized output failure',
      outputs: null,
    });
    expect(
      (await db.select().from(contentProvenance)).filter(
        (record) => record.organizationId === owner.organizationId
      )
    ).toEqual([]);
  });
});
