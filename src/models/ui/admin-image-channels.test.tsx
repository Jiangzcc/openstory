import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  ChannelImageModel,
  ImageChannelsConfiguration,
} from '@/models/image-channels';
import { IMAGE_MODELS } from '@/models/models';
import { createApplicationI18n } from '@/ui/i18n/runtime';

const fns = vi.hoisted(() => ({
  getAdminImageChannelsFn: vi.fn(),
  getImageModelCatalogFn: vi.fn(),
  saveImageChannelFn: vi.fn(),
  saveChannelImageModelFn: vi.fn(),
  syncImageChannelModelsFn: vi.fn(),
}));
vi.mock('@/models/image-channels.fn', () => fns);
import { adminImageChannelsQueryOptions } from '@/models/image-channels.queries';
import { AdminImageChannels } from './admin-image-channels';
import { AdminImageModelForm } from './admin-image-model-form';
import { useAdminImageChannels } from './use-admin-image-channels';
import { AdminImageFeedback } from './admin-image-channels-fields';
import { AdminImageOperationFields } from './admin-image-operation-fields';
import { AdminImageParameterForm } from './admin-image-parameter-form';

// This fixture is synthetic metadata; tests make no network or model calls.
const saved: ImageChannelsConfiguration = {
  revision: 3,
  channels: [
    {
      id: 'fixture-channel',
      name: 'Fixture channel',
      baseUrl: 'https://fixture.example/v1',
      protocol: 'openai-images',
      enabled: true,
      hasKey: true,
      keyHint: 'fixture-hidden-hint',
      credentialId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    },
  ],
  models: [
    {
      id: 'custom-image:fixture-model',
      name: 'Fixture model',
      channelId: 'fixture-channel',
      enabled: false,
      operations: {
        edit: {
          upstreamModel: 'fixture/edit',
          status: 'unverified',
          minReferenceImages: 1,
          maxReferenceImages: 12,
          mask: 'unsupported',
        },
      },
      parameters: [],
      priceCards: [],
    },
  ],
};
const clients: QueryClient[] = [];
function render(
  locale: 'en' | 'zh-CN',
  children: ReactNode = <AdminImageChannels />
) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(client);
  client.setQueryData(adminImageChannelsQueryOptions.queryKey, saved);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={createApplicationI18n(locale)}>
        {children}
      </I18nextProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
});

it('renders administrative metadata, stable IDs and verified-state warnings without credential material', () => {
  const html = render('en');
  expect(html).toContain('Fixture channel');
  expect(html).toContain('custom-image:fixture-model');
  expect(html).toContain('Unverified');
  expect(html).toContain('USD price cards');
  expect(html).not.toContain('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  expect(html).not.toContain('fixture-hidden-hint');
  expect(fns.getAdminImageChannelsFn).not.toHaveBeenCalled();
  expect(fns.syncImageChannelModelsFn).not.toHaveBeenCalled();
});

it('renders the independent Chinese namespace with user-authored model metadata preserved', () => {
  const html = render('zh-CN');
  expect(html).toContain('图片渠道');
  expect(html).toContain('未验证');
  expect(html).toContain('美元价卡');
  expect(html).toContain('Fixture model');
});

it('renders configured reference limits above two and keeps the upstream identity read-only', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n('zh-CN')}>
      <AdminImageOperationFields
        operation="edit"
        binding={saved.models[0]?.operations.edit}
        locked
      />
    </I18nextProvider>
  );
  expect(html).toContain('value="12"');
  expect(html).toContain('蒙版验证状态');
  expect(html).toContain('readOnly=""');
  expect(html).toContain('name="edit.configured"');
});

it('keeps user-authored parameter labels as data instead of looking them up as source keys', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n('zh-CN')}>
      <AdminImageParameterForm
        operations={['generate']}
        parameters={[
          {
            key: 'fixture_flag',
            label: 'Quality',
            type: 'boolean',
            status: 'unverified',
            operations: ['generate'],
            required: false,
            defaultValue: false,
          },
        ]}
      />
    </I18nextProvider>
  );
  expect(html).toContain('value="Quality"');
  expect(html).toContain('value="false"');
  expect(html).toContain('参数验证状态');
});

function ModelEditorFixture({
  model,
  isNew = false,
}: {
  model: ChannelImageModel;
  isNew?: boolean;
}) {
  const state = useAdminImageChannels();
  return (
    <AdminImageModelForm
      state={{
        ...state,
        modelEditor: {
          ...state.modelEditor,
          draft: {
            value: model,
            revision: saved.revision,
            formKey: 'fixture-editor',
            isNew,
          },
        },
      }}
    />
  );
}

it.each(['gpt_image_2', 'nano_banana_2'] as const)(
  'preserves the built-in registry identity and permits editing upstream operations for %s',
  (id) => {
    const custom = saved.models[0];
    if (!custom) throw new Error('Missing local mock model.');
    const model: ChannelImageModel = {
      ...custom,
      id,
      name: 'Fixture renamed model',
      operations: {
        generate: {
          upstreamModel: 'fixture-exact-upstream',
          status: 'unverified',
          minReferenceImages: 0,
          maxReferenceImages: 0,
          mask: 'unsupported',
        },
      },
    };
    const html = render('en', <ModelEditorFixture model={model} />);
    expect(html).toContain('Local image model');
    expect(html).toContain('value="' + id + '"');
    expect(html).toContain('value="' + IMAGE_MODELS[id].name + '"');
    expect(html).not.toContain('Fixture renamed model');
    expect(html).toContain('Disabling it restores the original route.');
    const upstream = html.match(
      /<input[^>]*name="generate.upstreamModel"[^>]*>/
    )?.[0];
    expect(upstream).toContain('fixture-exact-upstream');
    expect(upstream).not.toContain('readOnly');
    expect(html.match(/<input[^>]*name="id"[^>]*>/)?.[0]).toContain('readOnly');
    expect(fns.saveChannelImageModelFn).not.toHaveBeenCalled();
  }
);

it('retains the saved custom upstream identity lock and translates the dual-mode instructions', () => {
  const model = saved.models[0];
  if (!model) throw new Error('Missing local mock model.');
  const html = render('zh-CN', <ModelEditorFixture model={model} />);
  expect(html).toContain('本地图片模型');
  expect(html).toContain('绑定内置图片模型');
  expect(html).toContain('停用后恢复原有路由');
  expect(
    html.match(/<input[^>]*name="edit.upstreamModel"[^>]*>/)?.[0]
  ).toContain('readOnly');
});

it('translates validation for both built-in and custom local model IDs', () => {
  const html = render(
    'zh-CN',
    <AdminImageFeedback
      issues={[
        {
          path: 'id',
          message:
            'Select a built-in image model or use a custom-image: model identifier.',
        },
      ]}
      error={null}
      stale={false}
      busy={false}
      onReload={() => undefined}
    />
  );
  expect(html).toContain('请选择内置图片模型，或使用 custom-image: 模型标识。');
});
