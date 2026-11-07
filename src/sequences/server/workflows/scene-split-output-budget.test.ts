import { beforeEach, expect, test, vi } from 'vitest';
import type {
  WorkflowEvent,
  WorkflowStep,
  WorkflowStepConfig,
} from 'cloudflare:workers';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { SceneSplitWorkflowInput } from '@/platform/server/workflow/types';
import type { AnalysisModelId } from '@/models/models.config';
import type { ResolvedLlmKey } from '@/models/server/db/api-keys';
import type { LLMRequestParams } from '@/models/server/llm-client';
import type {
  TextModelRoute,
  TextModelRoutingSnapshot,
} from '@/models/text-channels';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { ZERO_MICROS } from '@/billing/money';
import { defaultSingleShot } from '@/shots/shot-list-pass';
import { asStub } from '@/test/as-stub';

const MOCK_SCRIPT = 'INT. EMPTY ROOM - DAY\nA door opens.';
const BUILTIN_MODEL: AnalysisModelId = 'anthropic/claude-sonnet-5.5';
const BUILTIN_OUTPUT_LIMIT = 128_000;
const STAGE = {
  scenes: 'phase-1-scene-splitting',
  bibles: 'phase-1-scene-bibles',
  shots: 'phase-1-scene-shot-list',
} as const;

// Local mock provider payloads; the real parser and workflow consume them.
const MOCK_RESULTS = {
  [STAGE.scenes]: {
    projectMetadata: { title: 'Mock output-budget film' },
    boundaries: [{ hintLine: 1, quote: 'INT. EMPTY ROOM - DAY' }],
  },
  [STAGE.bibles]: { characterBible: [], locationBible: [], elementBible: [] },
  [STAGE.shots]: {
    scenes: [{ sceneNumber: 1, shots: [defaultSingleShot(4)] }],
  },
};

type Stage = (typeof STAGE)[keyof typeof STAGE];

async function* mockProviderStream(params: LLMRequestParams) {
  const result = Object.entries(MOCK_RESULTS).find(
    ([name]) => name === params.observationName
  )?.[1];
  if (!result || !params.responseSchema) {
    throw new Error('Unexpected mock output-budget request.');
  }
  yield {
    done: true,
    delta: '',
    accumulated: JSON.stringify(result),
    parsed: params.responseSchema.parse(result),
    usage: undefined,
  };
}

const mockCallLLMStream = vi.fn(mockProviderStream);
vi.doMock('@/models/server/llm-client', () => ({
  PROMPT_REASONING: undefined,
  llmCostFromUsage: () => ZERO_MICROS,
  callLLMStream: mockCallLLMStream,
}));

// Prompts, realtime, previews and billing are local mocks with no services.
vi.doMock('@/platform/server/ai/prompts-index', () => ({
  getChatPrompt: async () => ({
    messages: [{ role: 'user', content: 'Mock output-budget request' }],
  }),
}));
vi.doMock('@/platform/realtime', () => ({
  getGenerationChannel: () => ({ emit: async () => {} }),
}));
vi.doMock('@/shots/server/shot-preview', () => ({
  triggerShotPreview: async () => 'mock-preview-run',
}));
vi.doMock('@/billing/server/workflow-deduction', () => ({
  deductWorkflowCredits: async () => {},
}));

const { SceneSplitWorkflow } = await import('./scene-split-workflow');

class OutputBudgetProbe extends SceneSplitWorkflow {
  split(
    event: Readonly<WorkflowEvent<SceneSplitWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: WorkflowScopedDb
  ) {
    return this.runImpl(event, step, scopedDb);
  }
}

function mockStep(): WorkflowStep {
  return asStub<WorkflowStep>({
    do: (
      _name: string,
      configOrFn: WorkflowStepConfig | (() => Promise<unknown>),
      fn?: () => Promise<unknown>
    ) => {
      if (typeof configOrFn === 'function') return configOrFn();
      if (!fn) throw new Error('Mock workflow step needs a callback.');
      return fn();
    },
  });
}

function mockRoute(
  modelId: AnalysisModelId,
  contextWindow: number,
  maxOutputTokens: number
): TextModelRoute {
  return {
    modelId,
    name: 'Mock budget model',
    channelId: 'mock-budget-channel',
    upstreamModel: modelId,
    protocol: 'openai-responses',
    baseUrl: 'https://output-budget.invalid/v1',
    credentialId: 'mock-budget-credential',
    vision: true,
    structuredOutput: true,
    tools: true,
    contextWindow,
    maxOutputTokens,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  };
}

function mockCompatibleKey(route: TextModelRoute): ResolvedLlmKey {
  return { source: 'platform', via: 'compatible', key: 'mock-key', route };
}

type RunOptions = {
  sceneModel: AnalysisModelId;
  analysisModel?: AnalysisModelId;
  keys: ReadonlyMap<string, ResolvedLlmKey>;
  routing?: TextModelRoutingSnapshot;
};

async function runSplit({
  sceneModel,
  analysisModel = sceneModel,
  keys,
  routing = [],
}: RunOptions) {
  const resolveLlmKey = vi.fn(async (model?: string) => {
    const key = keys.get(model ?? '');
    if (!key) throw new Error('No mock credential for selected model.');
    return key;
  });
  // No sequenceId: the supported analysis-only path needs no persistence.
  const payload: SceneSplitWorkflowInput = {
    promptLocale: 'en' as const,
    userId: 'mock-user',
    organizationId: 'mock-team',
    script: MOCK_SCRIPT,
    modelId: analysisModel,
    promptName: 'scene-splitting',
    aspectRatio: '16:9',
    elements: [],
    cast: [],
  };
  const scopedDb = asStub<WorkflowScopedDb>({
    models: {
      ...DEFAULT_MODEL_CONFIGURATION,
      sceneSplit: sceneModel,
      textModelRouting: routing,
    },
    credentials: { resolveLlmKey },
  });
  type Constructor = ConstructorParameters<typeof OutputBudgetProbe>;
  const workflow = new OutputBudgetProbe(
    asStub<Constructor[0]>(undefined),
    asStub<Constructor[1]>({})
  );
  const event: Readonly<WorkflowEvent<SceneSplitWorkflowInput>> = {
    payload,
    instanceId: 'mock-output-budget-run',
    workflowName: 'scene-split',
    timestamp: new Date(0),
  };
  const result = await workflow.split(event, mockStep(), scopedDb);
  expect(result.scenes).toHaveLength(1);
  expect(result.scenes[0]?.shots).toHaveLength(1);
  expect(mockCallLLMStream).toHaveBeenCalledTimes(3);
  return resolveLlmKey;
}

function expectRequest(
  stage: Stage,
  model: AnalysisModelId,
  key: ResolvedLlmKey,
  maxTokens: number
) {
  expect(mockCallLLMStream).toHaveBeenCalledWith(
    expect.objectContaining({
      observationName: stage,
      model,
      apiKey: key,
      max_tokens: maxTokens,
    })
  );
}

function expectSameModelBudgets(
  model: AnalysisModelId,
  key: ResolvedLlmKey,
  expected: readonly [number, number, number]
) {
  expectRequest(STAGE.scenes, model, key, expected[0]);
  expectRequest(STAGE.bibles, model, key, expected[1]);
  expectRequest(STAGE.shots, model, key, expected[2]);
}

beforeEach(() => {
  mockCallLLMStream.mockClear();
});

const CUSTOM_BUDGET_CASES = [
  {
    name: 'large configured output above the old 32,000 fallback',
    context: 262_144,
    output: 131_072,
    expected: [131_072, 131_072, 131_072],
  },
  {
    name: 'small configured maximum',
    context: 262_144,
    output: 8_192,
    expected: [8_192, 8_192, 8_192],
  },
  {
    name: '65% context for scenes/bibles and full output for shot lists',
    context: 64_000,
    output: 60_000,
    expected: [41_600, 41_600, 60_000],
  },
  {
    name: 'integer context-ratio rounding',
    context: 10_003,
    output: 9_000,
    expected: [6_501, 6_501, 9_000],
  },
] as const;

test.each(CUSTOM_BUDGET_CASES)(
  'custom model uses $name in actual streaming calls',
  async ({ context, output, expected }) => {
    const route = mockRoute('custom:budget-model', context, output);
    const key = mockCompatibleKey(route);
    const resolveLlmKey = await runSplit({
      sceneModel: route.modelId,
      keys: new Map([[route.modelId, key]]),
      routing: [route],
    });
    expect(resolveLlmKey).toHaveBeenCalledTimes(3);
    expectSameModelBudgets(route.modelId, key, expected);
  }
);

test('built-in model uses bound limits when compatible credentials are selected', async () => {
  const route = mockRoute(BUILTIN_MODEL, 64_000, 60_000);
  const key = mockCompatibleKey(route);
  await runSplit({
    sceneModel: BUILTIN_MODEL,
    keys: new Map([[BUILTIN_MODEL, key]]),
    routing: [route],
  });
  expectSameModelBudgets(BUILTIN_MODEL, key, [41_600, 41_600, 60_000]);
});

test.each(['openrouter', 'fal'] as const)(
  'unused binding cannot lower budgets for an actual team %s key',
  async (via) => {
    const unusedRoute = mockRoute(BUILTIN_MODEL, 16_384, 8_192);
    const key: ResolvedLlmKey = {
      source: 'organization',
      via,
      key: 'mock-team-key',
    };
    await runSplit({
      sceneModel: BUILTIN_MODEL,
      keys: new Map([[BUILTIN_MODEL, key]]),
      routing: [unusedRoute],
    });
    expectSameModelBudgets(BUILTIN_MODEL, key, [
      BUILTIN_OUTPUT_LIMIT,
      BUILTIN_OUTPUT_LIMIT,
      BUILTIN_OUTPUT_LIMIT,
    ]);
  }
);

test('scenes and analysis compute budgets from their own resolved model and key', async () => {
  const sceneRoute = mockRoute('custom:scene-budget', 262_144, 131_072);
  const analysisRoute = mockRoute('custom:analysis-budget', 64_000, 60_000);
  const sceneKey = mockCompatibleKey(sceneRoute);
  const analysisKey = mockCompatibleKey(analysisRoute);
  const resolveLlmKey = await runSplit({
    sceneModel: sceneRoute.modelId,
    analysisModel: analysisRoute.modelId,
    keys: new Map([
      [sceneRoute.modelId, sceneKey],
      [analysisRoute.modelId, analysisKey],
    ]),
    routing: [sceneRoute, analysisRoute],
  });
  const resolvedModels = resolveLlmKey.mock.calls.map(([model]) => model);
  expect(
    resolvedModels.filter((model) => model === sceneRoute.modelId)
  ).toHaveLength(1);
  expect(
    resolvedModels.filter((model) => model === analysisRoute.modelId)
  ).toHaveLength(2);
  expectRequest(STAGE.scenes, sceneRoute.modelId, sceneKey, 131_072);
  expectRequest(STAGE.bibles, analysisRoute.modelId, analysisKey, 41_600);
  expectRequest(STAGE.shots, analysisRoute.modelId, analysisKey, 60_000);
});
