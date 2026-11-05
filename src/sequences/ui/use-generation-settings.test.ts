import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_MODEL_CONFIGURATION } from '@/models/model-configuration';
import { mergeTextModelCatalog } from '@/models/text-model-catalog';
import {
  textModelSelectionError,
  useTextModelCatalog,
} from '@/models/ui/use-text-model-catalog';
import { textModelCatalogQueryOptions } from '@/models/text-channels.queries';
import { getTextModelCatalogFn } from '@/models/text-channels.fn';
import type { TextModelCatalogEntry } from '@/models/text-channels';
import {
  SCRIPT_ANALYSIS_MODELS,
  type AnalysisModelId,
} from '@/models/models.config';
import { ModelSelector } from '@/models/ui/pickers/model-selector';
import { BaseModelSelector } from '@/models/ui/pickers/base-model-selector';
vi.mock('@/models/ui/pickers/base-model-selector', () => ({
  BaseModelSelector: vi.fn(() => null),
}));
vi.mock('@/models/ai.fn', () => ({ getRequestCountryFn: vi.fn() }));
vi.mock('@/models/text-channels.fn', () => ({
  getTextModelCatalogFn: vi.fn(),
  getAdminTextChannelsFn: vi.fn(),
}));
vi.mock('@/models/ui/use-model-defaults', () => ({
  useModelDefaults: vi.fn(),
}));
vi.mock('@/models/ui/use-via-availability', () => ({
  useViaAvailability: vi.fn(),
}));
import {
  parseGenerationPreferences,
  resolveGenerationSettings,
  updateGenerationPreferences,
} from './use-generation-settings';

const configured = {
  ...DEFAULT_MODEL_CONFIGURATION,
  turboAnalysis: 'z-ai/glm-5.3-flash' as const,
  turboImage: 'flux_2_flash' as const,
  turboVideo: 'minimax_h3_max' as const,
  turboMusic: 'ace_step' as const,
  qualityAnalysis: 'anthropic/claude-sonnet-5.5' as const,
  qualityImage: 'gpt_image_2' as const,
  qualityVideo: 'seedance_v2' as const,
  qualityMusic: 'ace_step_1_5' as const,
  newSequenceVideo: 'seedance_v2_5' as const,
};

const vias = {
  byteplus: true,
  referenceOnlyModels: [
    'seedance_v2_5',
    'seedance_v2',
    'minimax_h3_max',
  ] as const,
};

describe('generation default provenance (1)', () => {
  it('uses configured Turbo and new-sequence defaults for a fresh browser', () => {
    expect(resolveGenerationSettings(configured, {}, vias)).toMatchObject({
      analysisModels: [configured.turboAnalysis],
      imageModels: [configured.turboImage],
      videoModels: [configured.newSequenceVideo],
      audioModels: [configured.turboMusic],
      generateStartFrames: false,
    });
  });

  it('does not turn a non-model setting or hydration into a model override', () => {
    const prefs = updateGenerationPreferences(
      {},
      { aspectRatio: '9:16', rememberStopAt: true }
    );
    const changed = {
      ...configured,
      turboImage: 'nano_banana_2_lite' as const,
      newSequenceVideo: 'seedance_v2' as const,
    };
    expect(prefs).not.toHaveProperty('imageModels');
    expect(prefs).not.toHaveProperty('videoModels');
    expect(resolveGenerationSettings(changed, prefs, vias)).toMatchObject({
      imageModels: [changed.turboImage],
      videoModels: [changed.newSequenceVideo],
      aspectRatio: '9:16',
      rememberStopAt: true,
    });
  });
});

describe('generation default provenance (2)', () => {
  it('keeps explicit legacy model preferences even when equal to an old default', () => {
    const prefs = parseGenerationPreferences({
      aspectRatio: '16:9',
      analysisModels: ['anthropic/claude-sonnet-5.5'],
      imageModel: 'gpt_image_2',
      motionModel: 'seedance_v2',
      musicModel: 'elevenlabs_music',
    });
    expect(resolveGenerationSettings(configured, prefs, vias)).toMatchObject({
      analysisModels: ['anthropic/claude-sonnet-5.5'],
      imageModels: ['gpt_image_2'],
      videoModels: ['seedance_v2'],
      audioModels: ['elevenlabs_music'],
    });
  });

  it('follows backend edits in fields the user did not override', () => {
    const prefs = updateGenerationPreferences(
      {},
      { imageModels: ['gpt_image_2'] }
    );
    const changed = {
      ...configured,
      turboAnalysis: 'google/gemini-3.8-flash' as const,
      turboMusic: 'ace_step_1_5' as const,
    };
    expect(resolveGenerationSettings(changed, prefs, vias)).toMatchObject({
      analysisModels: [changed.turboAnalysis],
      imageModels: ['gpt_image_2'],
      audioModels: [changed.turboMusic],
    });
  });
});

describe('generation default provenance (3)', () => {
  it('clears explicit model overrides on switching mode and follows that mode afterward', () => {
    const prefs = updateGenerationPreferences(
      { imageModels: ['flux_2_flash'], videoModels: ['seedance_v2_5'] },
      { generationMode: 'quality' }
    );
    expect(prefs).toEqual({ generationMode: 'quality' });
    expect(resolveGenerationSettings(configured, prefs, vias)).toMatchObject({
      analysisModels: [configured.qualityAnalysis],
      imageModels: [configured.qualityImage],
      videoModels: [configured.qualityVideo],
      audioModels: [configured.qualityMusic],
    });
    const changed = {
      ...configured,
      qualityImage: 'nano_banana_2_lite' as const,
    };
    expect(resolveGenerationSettings(changed, prefs, vias).imageModels).toEqual(
      [changed.qualityImage]
    );
  });

  it('does not discard explicit choices during a same-mode update', () => {
    const prefs = {
      generationMode: 'quality' as const,
      imageModels: ['flux_2_flash' as const],
    };
    expect(
      updateGenerationPreferences(prefs, { resolution: '1080p' }).imageModels
    ).toEqual(prefs.imageModels);
  });

  it('retains the administrator model and enables start frames when reference-only is unsupported', () => {
    const result = resolveGenerationSettings(
      configured,
      {},
      { byteplus: true, referenceOnlyModels: [] }
    );
    expect(result.videoModels).toEqual([configured.newSequenceVideo]);
    expect(result.generateStartFrames).toBe(true);
  });
});

describe('generation default provenance (4)', () => {
  it('uses the configured availability fallback without pinning it as a preference', () => {
    expect(resolveGenerationSettings(configured, {}, {}).videoModels).toEqual([
      configured.turboVideo,
    ]);
    expect(resolveGenerationSettings(configured, {}, vias).videoModels).toEqual(
      [configured.newSequenceVideo]
    );
  });

  it('repairs empty model lists with validated recommendations', () => {
    const result = resolveGenerationSettings(
      configured,
      { imageModels: [], videoModels: [], audioModels: [] },
      vias
    );
    expect(result.imageModels).toEqual([configured.turboImage]);
    expect(result.videoModels).toEqual([configured.turboVideo]);
    expect(result.audioModels).toEqual([configured.turboMusic]);
  });

  it('validates partial settings and migrates old generation flags', () => {
    expect(parseGenerationPreferences(null)).toEqual({});
    expect(parseGenerationPreferences([])).toEqual({});
    expect(
      parseGenerationPreferences({
        imageModel: 'retired',
        videoModels: [],
        rememberStopAt: true,
      })
    ).toEqual({ rememberStopAt: true });
    expect(
      parseGenerationPreferences({
        autoGenerateMotion: false,
        autoGenerateMusic: false,
      }).stopAt
    ).toBe('images');
  });
});

const customModel: TextModelCatalogEntry = {
  id: 'custom:private/draft',
  name: 'Private draft',
  vision: false,
  structuredOutput: true,
  tools: false,
  contextWindow: 64_000,
  maxOutputTokens: 8_000,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
};
const activeCatalog = {
  models: mergeTextModelCatalog([customModel]),
  isReady: true,
  error: null,
};

describe('custom generation preferences', () => {
  it('keeps an unresolved custom selection alongside built-in selections', () => {
    const prefs = parseGenerationPreferences({
      analysisModels: [customModel.id, configured.turboAnalysis],
    });
    expect(prefs.analysisModels).toEqual([
      customModel.id,
      configured.turboAnalysis,
    ]);
    expect(
      resolveGenerationSettings(configured, prefs, vias).analysisModels
    ).toEqual(prefs.analysisModels);
  });

  it('does not discard a custom model while saving another preference', () => {
    const prefs = updateGenerationPreferences(
      { analysisModels: [customModel.id] },
      { resolution: '1080p' }
    );
    expect(prefs.analysisModels).toEqual([customModel.id]);
  });

  it('retains a custom administrator default without creating an override', () => {
    const defaults = { ...configured, turboAnalysis: customModel.id };
    expect(
      resolveGenerationSettings(defaults, {}, vias).analysisModels
    ).toEqual([customModel.id]);
  });

  it('rejects malformed custom identifiers without losing valid choices', () => {
    expect(
      parseGenerationPreferences({
        analysisModels: ['custom:', 'custom:has space', customModel.id],
      }).analysisModels
    ).toEqual([customModel.id]);
  });
});

describe('custom text selection validation', () => {
  it('blocks a pending custom catalog without changing its saved identity', () => {
    const prefs = parseGenerationPreferences({
      analysisModels: [customModel.id],
    });
    const pending = {
      models: mergeTextModelCatalog(),
      isReady: false,
      error: null,
    };
    expect(
      textModelSelectionError([customModel.id], pending)?.message
    ).toContain('loading');
    expect(prefs.analysisModels).toEqual([customModel.id]);
    expect(
      textModelSelectionError([configured.turboAnalysis], pending)
    ).toBeNull();
  });

  it('accepts active custom models only for supported capabilities', () => {
    expect(
      textModelSelectionError(
        [customModel.id],
        activeCatalog,
        'structuredOutput'
      )
    ).toBeNull();
    expect(
      textModelSelectionError([customModel.id], activeCatalog, 'tools')?.message
    ).toContain('does not support tools');
    expect(
      textModelSelectionError([customModel.id], activeCatalog, 'vision')
        ?.message
    ).toContain('does not support image input');
  });
});

describe('unavailable custom text validation', () => {
  it.each(['custom:disabled', 'custom:unknown'])(
    'refuses %s instead of substituting a paid default',
    (id) => {
      const selection = [id, configured.turboAnalysis];
      expect(
        textModelSelectionError(selection, activeCatalog)?.message
      ).toContain(`Text model "${id}" is unavailable`);
      expect(selection).toEqual([id, configured.turboAnalysis]);
    }
  );

  it('blocks cached custom candidates when the current catalog request fails', () => {
    const failed = {
      ...activeCatalog,
      error: new Error('Catalog unavailable'),
    };
    expect(
      textModelSelectionError([customModel.id], failed)?.message
    ).toContain('Could not load text models');
  });
});

const catalogClients: QueryClient[] = [];
function catalogProbe() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  catalogClients.push(client);
  function Probe() {
    const catalog = useTextModelCatalog();
    const error = textModelSelectionError(
      [customModel.id],
      catalog,
      'structuredOutput'
    );
    return createElement(
      'span',
      { 'data-ready': catalog.isReady },
      error?.message ?? customModel.id
    );
  }
  const render = () =>
    renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Probe))
    );
  return { client, render };
}
afterEach(() => {
  for (const client of catalogClients.splice(0)) client.clear();
});

describe('shared public text candidates', () => {
  it('keeps custom selection pending until the public catalog has loaded', async () => {
    const { client, render } = catalogProbe();
    expect(render()).toContain('data-ready="false"');
    expect(render()).toContain('catalog is loading');
    vi.mocked(getTextModelCatalogFn).mockResolvedValue([customModel]);
    await client.fetchQuery(textModelCatalogQueryOptions);
    expect(render()).toContain('data-ready="true"');
    expect(render()).toContain(customModel.id);
    expect(render()).not.toContain('unavailable');
  });

  it('surfaces a removed candidate without substituting the built-in default', () => {
    const { client, render } = catalogProbe();
    client.setQueryData(textModelCatalogQueryOptions.queryKey, [customModel]);
    expect(render()).not.toContain('unavailable');
    client.setQueryData(textModelCatalogQueryOptions.queryKey, []);
    expect(render()).toContain('unavailable');
    expect(render()).toContain(customModel.id);
    expect(render()).not.toContain(configured.turboAnalysis);
  });

  it('reports catalog failures without throwing away the selected identity', async () => {
    const { client, render } = catalogProbe();
    vi.mocked(getTextModelCatalogFn).mockRejectedValue(
      new Error('Catalog unavailable')
    );
    await expect(
      client.fetchQuery(textModelCatalogQueryOptions)
    ).rejects.toThrow('Catalog unavailable');
    expect(render).not.toThrow();
    expect(render()).toContain('Could not load text models');
  });
});

function selectorProbe(
  entries: TextModelCatalogEntry[],
  selectedModels: AnalysisModelId[] = [configured.turboAnalysis],
  capability: 'structuredOutput' | 'tools' = 'structuredOutput',
  country?: string
) {
  const client = new QueryClient();
  catalogClients.push(client);
  client.setQueryData(textModelCatalogQueryOptions.queryKey, entries);
  if (country) client.setQueryData(['request-country'], country);
  const onModelsChange = vi.fn();
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ModelSelector, {
        selectedModels,
        onModelsChange,
        capability,
      })
    )
  );
  const picker = vi.mocked(BaseModelSelector).mock.calls.at(-1)?.[0];
  if (!picker) throw new Error('Model selector was not rendered');
  return { picker, onModelsChange };
}

describe('incremental text model picker', () => {
  it('adds custom candidates while preserving built-in ordering and hidden entries', () => {
    const baseline = selectorProbe([]).picker.models.map((model) => model.id);
    const { picker } = selectorProbe([customModel]);
    const builtins = picker.models.filter(
      (model) => model.id !== customModel.id
    );
    expect(builtins.map((model) => model.id)).toEqual(baseline);
    expect(picker.models.some((model) => model.id === customModel.id)).toBe(
      true
    );
    const hidden = SCRIPT_ANALYSIS_MODELS.filter((model) => 'hidden' in model);
    for (const model of hidden) expect(baseline).not.toContain(model.id);
    expect(
      SCRIPT_ANALYSIS_MODELS.some((model) => model.id === customModel.id)
    ).toBe(false);
  });

  it('uses explicit capability filters for generation and assistant pickers', () => {
    const analysis = selectorProbe([customModel]).picker;
    expect(analysis.models.some((model) => model.id === customModel.id)).toBe(
      true
    );
    const assistant = selectorProbe([customModel], undefined, 'tools').picker;
    expect(assistant.models.some((model) => model.id === customModel.id)).toBe(
      false
    );
    const toolsOnly = { ...customModel, tools: true, structuredOutput: false };
    expect(
      selectorProbe([toolsOnly]).picker.models.some(
        (model) => model.id === customModel.id
      )
    ).toBe(false);
    expect(
      selectorProbe([toolsOnly], undefined, 'tools').picker.models.some(
        (model) => model.id === customModel.id
      )
    ).toBe(true);
  });
});

describe('regional text model selection', () => {
  it('keeps a configured built-in channel model available in blocked countries', () => {
    const model = {
      ...customModel,
      id: 'anthropic/claude-sonnet-5.5' as const,
      tools: true,
    };
    const { picker } = selectorProbe(
      [model],
      [model.id],
      'structuredOutput',
      'CN'
    );
    expect(picker.models.find((entry) => entry.id === model.id)?.name).toBe(
      model.name
    );
    picker.onSelectionChange([model.id]);
    expect(picker.selectedIds).toEqual([model.id]);
  });
  it('retains built-in regional filtering without swapping a custom identity', () => {
    const { picker, onModelsChange } = selectorProbe(
      [customModel],
      [customModel.id],
      'structuredOutput',
      'CN'
    );
    expect(
      picker.models.some((model) => model.id.startsWith('anthropic/'))
    ).toBe(false);
    expect(picker.selectedIds).toEqual([customModel.id]);
    expect(onModelsChange).not.toHaveBeenCalled();
  });
});

describe('unavailable text selection editing', () => {
  it('shows an unavailable selected identity without automatically replacing it', () => {
    const selected: AnalysisModelId[] = ['custom:disabled'];
    const { picker, onModelsChange } = selectorProbe([], selected);
    expect(picker.selectedIds).toEqual(selected);
    expect(picker.models.find((model) => model.id === selected[0])?.name).toBe(
      selected[0]
    );
    expect(onModelsChange).not.toHaveBeenCalled();
    picker.onSelectionChange([configured.turboAnalysis]);
    expect(onModelsChange).toHaveBeenCalledExactlyOnceWith([
      configured.turboAnalysis,
    ]);
  });

  it('preserves a previously selected unavailable model until explicit removal', () => {
    const selected: AnalysisModelId[] = [
      'custom:disabled',
      configured.turboAnalysis,
    ];
    const { picker, onModelsChange } = selectorProbe([], selected);
    picker.onSelectionChange(['custom:unknown']);
    expect(onModelsChange).not.toHaveBeenCalled();
    picker.onSelectionChange(selected);
    expect(onModelsChange).toHaveBeenCalledExactlyOnceWith(selected);
    picker.onSelectionChange([configured.turboAnalysis]);
    expect(onModelsChange).toHaveBeenLastCalledWith([configured.turboAnalysis]);
  });

  it('passes an active custom selection through the picker unchanged', () => {
    const { picker, onModelsChange } = selectorProbe([customModel]);
    picker.onSelectionChange([customModel.id]);
    expect(onModelsChange).toHaveBeenCalledExactlyOnceWith([customModel.id]);
  });
});
