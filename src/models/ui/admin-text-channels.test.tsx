import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TEXT_CHANNEL_USER_AGENT,
  TEXT_CHANNEL_PROTOCOL,
  TEXT_CHANNEL_PROTOCOLS,
} from '@/models/text-channels';
import type {
  TextChannel,
  TextChannelsConfiguration,
} from '@/models/text-channels';
import { createApplicationI18n } from '@/ui/i18n/runtime';

const fns = vi.hoisted(() => ({
  getAdminTextChannelsFn: vi.fn(),
  getTextModelCatalogFn: vi.fn(),
  saveTextChannelFn: vi.fn(),
  saveChannelTextModelFn: vi.fn(),
  syncTextChannelModelsFn: vi.fn(),
}));
vi.mock('@/models/text-channels.fn', () => fns);
const imageFns = vi.hoisted(() => ({
  getAdminImageChannelsFn: vi.fn(),
  getImageModelCatalogFn: vi.fn(),
  saveImageChannelFn: vi.fn(),
  saveChannelImageModelFn: vi.fn(),
  syncImageChannelModelsFn: vi.fn(),
}));
vi.mock('@/models/image-channels.fn', () => imageFns);
vi.mock('@/ui/shadcn/tabs', async (importOriginal) => {
  const tabs = await importOriginal<typeof import('@/ui/shadcn/tabs')>();
  return { ...tabs, Tabs: vi.fn(tabs.Tabs) };
});
vi.mock('./admin-model-configuration', () => ({
  AdminModelConfiguration: () => <div data-testid="existing-default-form" />,
}));
vi.mock('./admin-text-channels-fields', async (importOriginal) => {
  const fields =
    await importOriginal<typeof import('./admin-text-channels-fields')>();
  return {
    ...fields,
    AdminTextInput: vi.fn(fields.AdminTextInput),
    AdminTextSelect: vi.fn(fields.AdminTextSelect),
  };
});
import { adminTextChannelsQueryOptions } from '@/models/text-channels.queries';
import { adminImageChannelsQueryOptions } from '@/models/image-channels.queries';
import { Route as ModelsRoute } from '@/routes/_app/admin/models';
import { Tabs } from '@/ui/shadcn/tabs';
import { AdminModelsPage } from './admin-models-page';
import { AdminTextChannels } from './admin-text-channels';
import { AdminTextChannelForm } from './admin-text-channels-channel-form';
import {
  AdminTextEditorFeedback,
  AdminTextInput,
  AdminTextSelect,
} from './admin-text-channels-fields';
import {
  AdminTextModelIdFields,
  AdminTextModelRoutingFields,
} from './admin-text-channels-model-fields';
import {
  createTextChannelDraft,
  createTextModelDraft,
  CUSTOM_TEXT_MODEL_OPTION,
  textChannelToDraft,
} from './admin-text-channels-state';
import type {
  AdminTextChannelEditor,
  AdminTextModelEditor,
} from './use-admin-text-channels';

// Reserved example addresses and metadata are test fixtures only.
const configuration: TextChannelsConfiguration = {
  revision: 2,
  channels: [
    {
      id: 'channel-test',
      name: 'Fixture channel',
      baseUrl: 'https://provider.example/v1',
      enabled: true,
      protocol: TEXT_CHANNEL_PROTOCOL,
      credentialId: 'fixture-credential-id',
      hasKey: true,
      keyHint: 'redacted-fixture-hint',
    },
  ],
  models: [
    {
      id: 'custom:fixture-model',
      name: 'Fixture text model',
      channelId: 'channel-test',
      upstreamModel: 'fixture/upstream',
      enabled: false,
      vision: false,
      structuredOutput: true,
      tools: false,
      contextWindow: 8000,
      maxOutputTokens: 2000,
      inputPricePerMillion: 0,
      outputPricePerMillion: 1.25,
    },
  ],
};
const clients: QueryClient[] = [];
function setup(
  locale: 'en' | 'zh-CN' = 'en',
  saved?: TextChannelsConfiguration
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  if (saved) client.setQueryData(adminTextChannelsQueryOptions.queryKey, saved);
  client.setQueryData(adminImageChannelsQueryOptions.queryKey, {
    revision: 0,
    channels: [],
    models: [],
  });
  const i18n = createApplicationI18n(locale);
  const renderContent = (content: ReactNode) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>{content}</I18nextProvider>
      </QueryClientProvider>
    );
  const render = (page = false) =>
    renderContent(page ? <AdminModelsPage /> : <AdminTextChannels />);
  return { client, render, renderContent };
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('admin text channels UI', () => {
  it('renders saved metadata and explicit USD costs without exposing a saved credential', () => {
    const html = setup('en', configuration).render();
    expect(html).toContain('Fixture channel');
    expect(html).toContain('Fixture text model');
    expect(html).toContain('redacted-fixture-hint');
    expect(html).not.toContain('fixture-credential-id');
    expect(html).toContain('Input: 0 USD / 1M tokens');
    expect(html).toContain('Output: 1.25 USD / 1M tokens');
  });
  it('keeps the default/internal form in the initial tab and keeps all three tabs mounted', () => {
    const html = setup('en', configuration).render(true);
    const selected = html.match(
      /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="true")[^>]*>([\s\S]*?)<\/button>/
    )?.[1];
    expect(selected).toContain('Defaults and internal models');
    expect(html).toContain('existing-default-form');
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html).toContain('Text channels');
    expect(html).toContain('Image channels');
    expect(html).toContain('No image channels configured.');
    expect(imageFns.getAdminImageChannelsFn).not.toHaveBeenCalled();
    expect(imageFns.syncImageChannelModelsFn).not.toHaveBeenCalled();
    expect(imageFns.saveImageChannelFn).not.toHaveBeenCalled();
    expect(imageFns.saveChannelImageModelFn).not.toHaveBeenCalled();
    expect(html).toContain('data-[state=inactive]:hidden');
  });
  it('renders Chinese admin copy while leaving operator-provided model names intact', () => {
    const html = setup('zh-CN', configuration).render();
    expect(html).toContain('文本渠道');
    expect(html).toContain('添加模型绑定');
    expect(html).toContain('Fixture text model');
    expect(html).not.toContain('Manage platform text channels');
  });
  it('shows loading state without fake configuration or any provider request', () => {
    const html = setup().render();
    expect(html).toContain('Loading text channels');
    expect(html).not.toContain('Fixture channel');
    expect(fns.syncTextChannelModelsFn).not.toHaveBeenCalled();
    expect(fns.saveTextChannelFn).not.toHaveBeenCalled();
    expect(fns.saveChannelTextModelFn).not.toHaveBeenCalled();
  });
  it('shows an actionable empty state and one page scroll container', () => {
    const html = setup('en', {
      revision: 0,
      channels: [],
      models: [],
    }).render();
    expect(html).toContain('No text channels yet.');
    expect(html).toContain('Add text channel');
    expect(html.match(/overflow-auto/g)).toHaveLength(1);
    expect(html).toContain(
      'class="relative min-h-0 flex-1 overflow-auto"><div class="flex flex-col gap-6">'
    );
  });
});

function createModelsRouter(entry: string) {
  const root = createRootRoute();
  const models = createRoute({
    path: '/admin/models',
    getParentRoute: () => root,
    validateSearch: ModelsRoute.options.validateSearch,
    component: ModelsRoute.options.component,
  });
  vi.spyOn(ModelsRoute, 'useSearch').mockImplementation(() =>
    models.useSearch()
  );
  vi.spyOn(ModelsRoute, 'useNavigate').mockImplementation(() =>
    models.useNavigate()
  );
  const routeTree = root.addChildren([models]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    isServer: false,
    origin: 'http://localhost',
  });
}

function renderModelsRouter(
  router: ReturnType<typeof createModelsRouter>,
  locale: 'en' | 'zh-CN' = 'en'
) {
  const Component = ModelsRoute.options.component;
  if (!Component) throw new Error('Model configuration route has no component');
  return setup(locale, configuration).renderContent(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>
  );
}

function selectedTab(html: string) {
  return html.match(
    /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="true")[^>]*>([\s\S]*?)<\/button>/
  )?.[1];
}

describe('model configuration tabs integration', () => {
  it.each([
    ['/admin/models', 'Defaults and internal models'],
    ['/admin/models?tab=text-channels', 'Text channels'],
    ['/admin/models?tab=image-channels', 'Image channels'],
    ['/admin/models?tab=unknown', 'Defaults and internal models'],
  ])('restores the selected tab from %s', async (entry, label) => {
    const router = createModelsRouter(entry);
    await router.load();
    const html = renderModelsRouter(router);
    expect(selectedTab(html)).toContain(label);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
  });

  it('updates the models URL when changing tabs and restores it through history', async () => {
    const router = createModelsRouter('/admin/models?tab=text-channels');
    await router.load();
    renderModelsRouter(router);
    const tabs = vi.mocked(Tabs).mock.calls.at(-1)?.[0];
    expect(tabs?.onValueChange).toBeTypeOf('function');
    tabs?.onValueChange?.('image-channels');
    await router.load();
    expect(router.state.location.pathname).toBe('/admin/models');
    expect(router.state.location.search.tab).toBe('image-channels');
    router.history.back();
    await router.load();
    expect(router.state.location.search.tab).toBe('text-channels');
    router.history.forward();
    await router.load();
    expect(router.state.location.search.tab).toBe('image-channels');
  });

  it('renders the image tab in Chinese using its existing namespace', async () => {
    const router = createModelsRouter('/admin/models?tab=image-channels');
    await router.load();
    const html = renderModelsRouter(router, 'zh-CN');
    expect(selectedTab(html)).toContain('图片渠道');
    expect(html).toContain('existing-default-form');
    expect(html).toContain('Fixture text model');
    expect(html).not.toContain('Manage platform image channels');
  });
});

describe('text channel save feedback', () => {
  it('offers reload for a server revision conflict and translates the server reason', () => {
    const i18n = createApplicationI18n('zh-CN');
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <AdminTextEditorFeedback
          errors={{}}
          saveError={
            new Error('Text channel settings changed. Reload before saving.')
          }
          isStale={false}
          onRefresh={() => {}}
          isRefreshing={false}
        />
      </I18nextProvider>
    );
    expect(html).toContain('文本渠道配置已发生变化，请重新加载后再保存。');
    expect(html).toContain('重新加载配置');
    expect(html).toContain('草稿仍保留在表单中');
  });
});

function channelEditor(original?: TextChannel): AdminTextChannelEditor {
  return {
    draft: {
      values: original
        ? textChannelToDraft(original)
        : createTextChannelDraft(),
      revision: configuration.revision,
      isNew: !original,
      errors: {},
    },
    focusRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    change: vi.fn(),
    replace: vi.fn(),
    setErrors: vi.fn(),
    adoptRevision: vi.fn(),
    onSubmit: vi.fn(),
    isSaving: false,
    saveError: null,
    isStale: false,
    original,
  };
}

function modelEditor(): AdminTextModelEditor {
  return {
    draft: {
      values: createTextModelDraft(),
      revision: configuration.revision,
      isNew: true,
      errors: {},
    },
    focusRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    change: vi.fn(),
    replace: vi.fn(),
    setErrors: vi.fn(),
    adoptRevision: vi.fn(),
    onSubmit: vi.fn(),
    isSaving: false,
    saveError: null,
    isStale: false,
    options: [],
    choice: CUSTOM_TEXT_MODEL_OPTION,
    isCustom: true,
    requiredCapabilities: {
      vision: false,
      structuredOutput: false,
      tools: false,
    },
    customId: '',
    changeCustomId: vi.fn(),
    changeChoice: vi.fn(),
    openCandidate: vi.fn(),
  };
}

function renderEditor(node: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      {node}
    </I18nextProvider>
  );
}

function renderChannel(
  editor = channelEditor(),
  locale: 'en' | 'zh-CN' = 'en'
) {
  const html = renderEditor(
    <AdminTextChannelForm
      editor={editor}
      isBusy={false}
      onRefresh={vi.fn()}
      isRefreshing={false}
    />,
    locale
  );
  const select = vi
    .mocked(AdminTextSelect)
    .mock.calls.find(([props]) => props.id === 'text-channel-protocol')?.[0];
  if (!select) throw new Error('Protocol select was not rendered');
  return { html, select };
}

describe('text channel protocol selection', () => {
  it('defaults new channels to Chat Completions and offers both protocols', () => {
    const { html, select } = renderChannel();
    expect(select.value).toBe(TEXT_CHANNEL_PROTOCOLS.chatCompletions);
    expect(select.options).toEqual([
      {
        value: TEXT_CHANNEL_PROTOCOLS.chatCompletions,
        label: 'OpenAI Chat Completions',
      },
      { value: TEXT_CHANNEL_PROTOCOLS.responses, label: 'OpenAI Responses' },
    ]);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('for="text-channel-protocol"');
    expect(html).not.toContain('only supported protocol');
  });
  it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
    'displays a saved %s protocol instead of the new-channel default',
    (protocol) => {
      const original = configuration.channels[0];
      if (!original) throw new Error('Missing saved channel fixture');
      const editor = channelEditor({ ...original, protocol });
      const { html, select } = renderChannel(editor);
      expect(select.value).toBe(protocol);
      const selected = select.options.find(
        (option) => option.value === protocol
      );
      expect(html).toContain(selected?.label);
    }
  );
  it.each(Object.values(TEXT_CHANNEL_PROTOCOLS))(
    'writes the selected %s protocol to the existing editor',
    (protocol) => {
      const editor = channelEditor();
      renderChannel(editor).select.onChange(protocol);
      expect(editor.change).toHaveBeenCalledExactlyOnceWith(
        'protocol',
        protocol
      );
    }
  );
  it('ignores cleared or unknown protocol values without overwriting the draft', () => {
    const editor = channelEditor();
    const { select } = renderChannel(editor);
    select.onChange(null);
    select.onChange('unsupported-protocol');
    expect(editor.change).not.toHaveBeenCalled();
  });
});

describe('text channel protocol feedback', () => {
  it('associates a translated protocol error with the select', () => {
    const editor = channelEditor();
    if (!editor.draft) throw new Error('Missing fixture draft');
    editor.draft.errors.protocol = 'Choose Chat Completions or Responses.';
    const { html } = renderChannel(editor, 'zh-CN');
    expect(html).toContain('aria-describedby="text-channel-protocol-error"');
    expect(html).toContain('请选择 Chat Completions 或 Responses 协议。');
  });
});

describe('text channel User-Agent field', () => {
  it.each([
    {
      locale: 'en',
      label: 'User-Agent',
      hint: 'Leave blank to use OpenStory/0.1.0.',
    },
    {
      locale: 'zh-CN',
      label: 'User-Agent（客户端标识）',
      hint: '留空使用 OpenStory/0.1.0。',
    },
  ] as const)(
    'shows the optional default identity in $locale',
    ({ locale, label, hint }) => {
      const { html } = renderChannel(channelEditor(), locale);
      expect(html).toContain('for="text-channel-user-agent">' + label);
      expect(html).toContain(
        'placeholder="' + DEFAULT_TEXT_CHANNEL_USER_AGENT + '"'
      );
      expect(html).toContain(hint);
      expect(html).toContain('aria-describedby="text-channel-user-agent-hint"');
      const input = vi
        .mocked(AdminTextInput)
        .mock.calls.find(
          ([props]) => props.id === 'text-channel-user-agent'
        )?.[0];
      expect(input).toMatchObject({
        required: false,
        value: '',
        maxLength: 256,
      });
    }
  );
  it('displays the saved identity and writes changes through the existing editor', () => {
    const original = configuration.channels[0];
    if (!original) throw new Error('Missing saved channel fixture');
    const editor = channelEditor({ ...original, userAgent: 'Studio/1.0' });
    expect(renderChannel(editor).html).toContain('value="Studio/1.0"');
    const input = vi
      .mocked(AdminTextInput)
      .mock.calls.find(
        ([props]) => props.id === 'text-channel-user-agent'
      )?.[0];
    if (!input?.onChange) throw new Error('User-Agent input was not rendered');
    input.onChange('');
    expect(editor.change).toHaveBeenCalledExactlyOnceWith('userAgent', '');
  });
  it('associates the translated validation error and default hint with the field', () => {
    const editor = channelEditor();
    if (!editor.draft) throw new Error('Missing fixture draft');
    editor.draft.errors.userAgent =
      'Use up to 256 printable ASCII characters for User-Agent, or leave it blank.';
    const { html } = renderChannel(editor, 'zh-CN');
    expect(html).toContain(
      'aria-describedby="text-channel-user-agent-hint text-channel-user-agent-error"'
    );
    expect(html).toContain(
      'User-Agent 最多填写 256 个可打印 ASCII 字符，也可留空。'
    );
  });
});

const placeholderCases = [
  {
    locale: 'en',
    baseUrl: 'API base URL, e.g. https://api.example.com/v1',
    customId: 'Letters, numbers, . _ / -; e.g. vendor/model',
    upstream: 'Exact upstream model ID, e.g. vendor/model-name',
  },
  {
    locale: 'zh-CN',
    baseUrl: 'API 基础地址，如 https://api.example.com/v1',
    customId: '字母、数字、. _ / -，如 vendor/model',
    upstream: '精确的上游模型 ID，如 vendor/model-name',
  },
] as const;

describe('text channel input placeholders', () => {
  it.each(placeholderCases)(
    'renders format examples in $locale placeholders and keeps labels',
    ({ locale, baseUrl, customId, upstream }) => {
      const editor = modelEditor();
      const html = renderEditor(
        <>
          <AdminTextModelIdFields editor={editor} />
          <AdminTextModelRoutingFields editor={editor} channelOptions={[]} />
        </>,
        locale
      );
      expect(renderChannel(channelEditor(), locale).html).toContain(
        'placeholder="' + baseUrl + '"'
      );
      expect(html).toContain('placeholder="' + customId + '"');
      expect(html).toContain('placeholder="' + upstream + '"');
      for (const id of ['text-model-custom-id', 'text-model-upstream']) {
        expect(html).toContain('for="' + id + '"');
        expect(html).not.toContain(id + '-hint');
      }
    }
  );
});

describe('text channel field accessibility', () => {
  it('keeps credential guidance visible and linked to the key field', () => {
    const { html } = renderChannel(channelEditor(), 'zh-CN');
    expect(html).toContain(
      '留空保留已保存的密钥。修改基础 URL 时必须重新输入密钥。'
    );
    expect(html).toContain('aria-describedby="text-channel-api-key-hint"');
    expect(html).not.toContain('text-channel-base-url-hint');
  });
  it('translates placeholders while retaining hint and error descriptions', () => {
    const html = renderEditor(
      <AdminTextInput
        id="fixture-input"
        label="Base URL"
        value=""
        placeholder="API base URL, e.g. https://api.example.com/v1"
        hint="Leave blank to keep the saved key. Changing the base URL requires a new key."
        error="Enter a channel name."
      />,
      'zh-CN'
    );
    expect(html).toContain(
      'placeholder="API 基础地址，如 https://api.example.com/v1"'
    );
    expect(html).toContain(
      'aria-describedby="fixture-input-hint fixture-input-error"'
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });
});
