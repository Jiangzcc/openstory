import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { InsufficientCreditsError, OpenStoryError } from '@/platform/errors';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { AssistantConversation } from './assistant-conversation';

const state = vi.hoisted(() => ({ error: undefined as Error | undefined }));
vi.mock('./use-assistant-chat', () => ({
  useAssistantChat: () => ({
    messages: [],
    interrupts: [],
    isLoading: false,
    error: state.error,
    sendMessage: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock('./assistant-store', () => ({
  useAssistantState: () => ({ model: null }),
  setAssistantModel: vi.fn(),
}));
vi.mock('@/models/ui/use-model-defaults', () => ({
  useModelDefaults: () => ({
    configuration: { defaultAnalysis: 'custom:test' },
    isReady: true,
  }),
}));
vi.mock('@/models/ui/use-text-model-catalog', () => ({
  useTextModelCatalog: () => ({}),
  textModelSelectionError: () => undefined,
}));
vi.mock('./assistant-composer', () => ({ AssistantComposer: () => null }));
vi.mock('./assistant-message', () => ({ AssistantMessage: () => null }));

function renderError(error: Error, locale: 'zh-CN' | 'en' = 'zh-CN') {
  state.error = error;
  return renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n(locale)}>
      <QueryClientProvider client={new QueryClient()}>
        <AssistantConversation
          threadId="test-thread"
          pageContext={[]}
          onDismissContext={() => {}}
          suggestions={[]}
        />
      </QueryClientProvider>
    </I18nextProvider>
  );
}

describe('assistant error presentation', () => {
  it.each([
    ['zh-CN', '可用余额不足，请充值后再与助手聊天。'],
    ['en', 'Add credits to chat with the assistant.'],
  ] as const)('shows the credit message in %s', (locale, expected) => {
    const html = renderError(
      new InsufficientCreditsError('Add credits to chat with the assistant.'),
      locale
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(expected);
    expect(html).not.toContain('Stream response body read failed');
  });

  it('preserves and escapes other server error messages', () => {
    const html = renderError(
      new OpenStoryError('Model <glm> is unavailable.', 'MODEL_ERROR', 502)
    );
    expect(html).toContain('Model &lt;glm&gt; is unavailable.');
    expect(html).not.toContain('可用余额不足');
  });

  it('identifies insufficient credits by code instead of message text', () => {
    const message = 'Add credits to chat with the assistant.';
    const html = renderError(new OpenStoryError(message, 'OTHER_ERROR', 400));
    expect(html).toContain(message);
    expect(html).not.toContain('可用余额不足');
  });
});
