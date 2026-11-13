import { runWithStartContext } from '@tanstack/start-storage-context';
import {
  runtime,
  createInput,
  database,
  caller,
  foreign,
  poisonedData,
  createExecutor,
  startContext,
  asset,
  reservations,
  ledger,
  assets,
  localeCases,
  createResultSchema,
  createScopedDb,
} from './db/asset-entry.test.fixture';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { generateId } from '@/platform/id';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import {
  AccountRestrictedError,
  AuthenticationError,
  NotFoundError,
} from '@/platform/errors';
import {
  credits,
  enforcementActions,
  modelUsageObservations,
} from '@/platform/server/db/schema';
import * as entries from '@/studio/studio-assets.fn';

const execute = createExecutor((request, callback) =>
  runWithStartContext(startContext(request), callback)
);

describe('Studio Start entry to real business boundaries', () => {
  it.each(localeCases)(
    'creates with trusted actor and $label request locale',
    async ({ cookie, expected }) => {
      const outcome = await execute(
        entries.createStudioAssetsFn,
        { ...createInput, ...poisonedData() },
        cookie
      );
      expect(outcome.error).toBeUndefined();
      const result = createResultSchema.parse(outcome.result);
      expect(result.assets).toHaveLength(1);
      const rows = await assets();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organizationId: caller.organizationId,
        userId: caller.id,
        source: 'studio',
        status: 'queued',
        workflowRunId: 'synthetic-studio-run',
      });
      expect(rows[0]?.input).not.toHaveProperty('userId');
      expect(rows[0]?.input).not.toHaveProperty('organizationId');
      expect(rows[0]?.input).not.toHaveProperty('promptLocale');
      expect(runtime.trigger).toHaveBeenCalledWith(
        '/studio',
        expect.objectContaining({
          userId: caller.id,
          organizationId: caller.organizationId,
          promptLocale: expected,
          assetId: rows[0]?.id,
          ownsReservation: true,
          input: expect.objectContaining({ imageModel: 'gpt_image_2' }),
        }),
        expect.objectContaining({ deduplicationId: 'studio-' + rows[0]?.id })
      );
      expect(result.assets[0]).toMatchObject({
        id: rows[0]?.id,
        workflowRunId: 'synthetic-studio-run',
      });
    }
  );

  it.each(['zh-CN', 'en'] as const)(
    'keeps edit and final-render identity, snapshot and %s locale through the actual create service',
    async (locale) => {
      const source = await asset(caller, 'studio', {
        activity: 'video',
        prompt: 'Original clip prompt',
        videoModel: 'seedance_v2_5',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 6,
        count: 1,
        mode: 'text',
      });
      const sourceUrl =
        '/r2/videos/org/' +
        caller.organizationId +
        '/studio/' +
        source.id +
        '/video.mp4';
      await createScopedDb(
        caller.organizationId,
        caller.id
      ).generatedAssets.markCompleted(source.id, {
        provider: 'byteplus',
        outputs: [{ url: sourceUrl, contentType: 'video/mp4' }],
        draftTaskId: 'synthetic-ark-task',
      });
      const edited = await execute(
        entries.editStudioAssetFn,
        {
          id: source.id,
          prompt: 'Keep Lena running. 雨中奔跑。',
          draft: false,
          sourceVideoUrl: 'https://forged.example.invalid/video.mp4',
          ...poisonedData(),
        },
        locale
      );
      expect(edited.error).toBeUndefined();
      const editResult = createResultSchema.parse(edited.result);
      const editRun = runtime.trigger.mock.calls[0]?.[1];
      expect(editRun).toMatchObject({
        userId: caller.id,
        organizationId: caller.organizationId,
        promptLocale: locale,
        input: {
          sourceAssetId: source.id,
          sourceVideoUrl: sourceUrl,
          mode: 'edit',
          duration: 'auto',
          prompt: 'Keep Lena running. 雨中奔跑。',
        },
      });
      expect(editRun.assetId).toBe(editResult.assets[0]?.id);
      const rendered = await execute(
        entries.renderStudioAssetAtQualityFn,
        {
          id: source.id,
          finalFromDraftTaskId: 'forged-task',
          ...poisonedData(),
        },
        locale
      );
      expect(rendered.error).toBeUndefined();
      expect(runtime.trigger.mock.calls[1]?.[1]).toMatchObject({
        userId: caller.id,
        organizationId: caller.organizationId,
        promptLocale: locale,
        finalFromDraftTaskId: 'synthetic-ark-task',
        input: { resolution: '1080p', draft: false, count: 1 },
      });
      expect(await assets()).toHaveLength(3);
    }
  );

  it('rejects an invalid model before rows, reservations or workflow creation', async () => {
    const outcome = await execute(
      entries.createStudioAssetsFn,
      { ...createInput, imageModel: 'unconfigured-client-model' },
      'en'
    );
    expect(outcome.error).toBeDefined();
    expect(await assets()).toEqual([]);
    expect(await reservations()).toEqual([]);
    expect(runtime.trigger).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated creates before business work', async () => {
    const outcome = await execute(
      entries.createStudioAssetsFn,
      createInput,
      'en',
      ''
    );
    expect(outcome.error).toBeInstanceOf(AuthenticationError);
    expect(await assets()).toEqual([]);
    expect(runtime.trigger).not.toHaveBeenCalled();
  });

  it('marks a pre-trigger failure terminal and releases the real hold', async () => {
    runtime.trigger.mockRejectedValueOnce(
      new Error('Synthetic trigger refusal')
    );
    const outcome = await execute(
      entries.createStudioAssetsFn,
      createInput,
      'en'
    );
    expect(outcome.error).toMatchObject({
      message: 'Synthetic trigger refusal',
    });
    expect(await assets()).toEqual([
      expect.objectContaining({
        status: 'failed',
        workflowRunId: null,
        organizationId: caller.organizationId,
      }),
    ]);
    expect(await reservations()).toEqual([
      expect.objectContaining({ remainingAmount: 0 }),
    ]);
    expect(await ledger()).toEqual([]);
  });

  it('keeps a started workflow queued when only runId persistence fails', async () => {
    await database.db.run(
      sql.raw(
        "CREATE TRIGGER synthetic_run_id_write_failure BEFORE UPDATE OF workflow_run_id ON generated_assets WHEN NEW.workflow_run_id IS NOT NULL BEGIN SELECT RAISE(FAIL, 'synthetic runId write failure'); END"
      )
    );
    const outcome = await execute(
      entries.createStudioAssetsFn,
      createInput,
      'zh-CN'
    );
    expect(outcome.error).toBeUndefined();
    expect(
      createResultSchema.parse(outcome.result).assets[0]?.workflowRunId
    ).toBe('synthetic-studio-run');
    expect(await assets()).toEqual([
      expect.objectContaining({
        status: 'queued',
        workflowRunId: null,
        error: null,
      }),
    ]);
    const holds = await reservations();
    expect(holds).toHaveLength(1);
    expect(holds[0]?.remainingAmount).toBeGreaterThan(0);
    expect(await ledger()).toEqual([]);
  });

  it('scopes list, favorite, history and delete through real generated-asset SQL', async () => {
    const own = await asset();
    const other = await asset(foreign);
    const catalog = await asset(caller, 'catalog');
    const list = await execute(
      entries.listStudioAssetsFn,
      { source: 'catalog', ...poisonedData() },
      'en'
    );
    expect(list.error).toBeUndefined();
    const page = z
      .object({ assets: z.array(z.object({ id: z.string() })) })
      .parse(list.result);
    expect(page.assets.map((row) => row.id)).toEqual([own.id]);
    const favorite = await execute(
      entries.setStudioAssetFavoriteFn,
      { id: own.id, isFavorite: true, ...poisonedData() },
      'en'
    );
    expect(favorite.error).toBeUndefined();
    expect(
      await createScopedDb(
        caller.organizationId,
        caller.id
      ).generatedAssets.getById(own.id)
    ).toMatchObject({ isFavorite: true });
    for (const id of [other.id, catalog.id]) {
      for (const [fn, data] of [
        [entries.setStudioAssetFavoriteFn, { id, isFavorite: true }],
        [entries.deleteStudioAssetFn, { id }],
        [entries.editStudioAssetFn, { id, prompt: 'edit', draft: false }],
        [entries.renderStudioAssetAtQualityFn, { id }],
      ] as const) {
        expect(
          (await execute(fn, { ...data, ...poisonedData() }, 'en')).error
        ).toBeInstanceOf(NotFoundError);
      }
      const history = await execute(
        entries.getStudioEditHistoryFn,
        { id },
        'en'
      );
      expect(history.error).toBeUndefined();
      expect(history.result).toEqual([]);
    }
    const child = await asset(caller, 'studio', {
      prompt: 'Synthetic child',
      sourceAssetId: own.id,
      mode: 'edit',
    });
    const history = await execute(
      entries.getStudioEditHistoryFn,
      { id: child.id },
      'zh-CN'
    );
    expect(
      z
        .array(z.object({ id: z.string() }))
        .parse(history.result)
        .map((row) => row.id)
    ).toEqual([own.id, child.id]);
    const linkedForeign = await asset(caller, 'studio', {
      prompt: 'Own child',
      sourceAssetId: other.id,
      mode: 'edit',
    });
    const bounded = await execute(
      entries.getStudioEditHistoryFn,
      { id: linkedForeign.id },
      'en'
    );
    expect(
      z
        .array(z.object({ id: z.string() }))
        .parse(bounded.result)
        .map((row) => row.id)
    ).toEqual([linkedForeign.id]);
    const db = createScopedDb(caller.organizationId, caller.id);
    await db.generatedAssets.markCompleted(own.id, {
      provider: 'fal',
      outputs: [
        {
          url:
            '/r2/videos/org/' +
            caller.organizationId +
            '/studio/' +
            own.id +
            '/video.mp4',
          contentType: 'video/mp4',
        },
      ],
    });
    runtime.delete.mockRejectedValueOnce(
      new Error('Synthetic R2 cleanup failure')
    );
    expect(
      (await execute(entries.deleteStudioAssetFn, { id: own.id }, 'en')).error
    ).toBeUndefined();
    expect(await db.generatedAssets.getById(own.id)).toBeNull();
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(
      await createScopedDb(
        foreign.organizationId,
        foreign.id
      ).generatedAssets.getById(other.id)
    ).toMatchObject({ isFavorite: false });
    expect(runtime.trigger).not.toHaveBeenCalled();
  });

  it.each(localeCases)(
    'drafts through real LLM streaming and bills the trusted organization for $label',
    async ({ cookie, expected }) => {
      const outcome = await execute(
        entries.draftStudioPromptFn,
        {
          activity: 'video',
          references: [],
          currentPrompt: 'Lena says Stay here. 雨声继续。',
          ...poisonedData(),
        },
        cookie
      );
      expect(outcome.error).toBeUndefined();
      expect(outcome.result).toEqual({
        prompt: 'Image1: Lena says Stay here. 雨声继续。',
      });
      expect(runtime.chat).toHaveBeenCalledOnce();
      const options = runtime.chat.mock.calls[0]?.[0];
      expect(options.systemPrompts[0]).toContain(
        expected === 'zh-CN'
          ? '你为 AI 视频生成器'
          : 'You write prompts for an AI video'
      );
      expect(JSON.stringify(options.messages)).toContain(
        'Lena says Stay here. 雨声继续。'
      );
      expect(runtime.observation).toHaveBeenCalledWith(
        expect.objectContaining({
          observationName: 'studio-prompt-draft',
          userId: caller.id,
        })
      );
      expect(await ledger()).toEqual([
        expect.objectContaining({
          organizationId: caller.organizationId,
          userId: caller.id,
          type: 'credit_usage',
          amount: -2400,
          metadata: expect.objectContaining({
            model: DEFAULT_MODEL_CONFIGURATION.studioDraft,
          }),
        }),
      ]);
      expect(await database.db.select().from(modelUsageObservations)).toEqual(
        []
      );
      expect(await assets()).toEqual([]);
      expect(runtime.trigger).not.toHaveBeenCalled();
    }
  );

  it.each(['user', 'organization'] as const)(
    'blocks a generation-suspended %s before draft provider work',
    async (subject) => {
      await database.db.insert(enforcementActions).values({
        id: generateId(),
        action: 'generation_suspended',
        reason: 'other',
        ...(subject === 'user'
          ? { subjectUserId: caller.id }
          : { subjectOrganizationId: caller.organizationId }),
      });
      const outcome = await execute(
        entries.draftStudioPromptFn,
        { activity: 'video', references: [], ...poisonedData() },
        'en'
      );
      expect(outcome.error).toBeInstanceOf(AccountRestrictedError);
      expect(runtime.chat).not.toHaveBeenCalled();
      expect(await ledger()).toEqual([]);
    }
  );

  it('rejects insufficient platform credit before drafting', async () => {
    await database.db
      .update(credits)
      .set({ balance: 0 })
      .where(eq(credits.organizationId, caller.organizationId));
    const outcome = await execute(
      entries.draftStudioPromptFn,
      { activity: 'image', references: [] },
      'en'
    );
    expect(outcome.error).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(runtime.chat).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([]);
  });

  it('does not turn an empty draft into a debit or asset', async () => {
    runtime.chat.mockImplementationOnce(() =>
      (async function* () {
        yield { type: 'TEXT_MESSAGE_CONTENT', delta: '   ' };
      })()
    );
    const outcome = await execute(
      entries.draftStudioPromptFn,
      { activity: 'image', references: [] },
      'en'
    );
    expect(outcome.error).toMatchObject({
      message: 'The draft came back empty — try again.',
    });
    expect(await ledger()).toEqual([]);
    expect(await assets()).toEqual([]);
  });
});
