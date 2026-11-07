import { describe, expect, it, vi } from 'vitest';
import { SEQUENCE_CARD_SCRIPT } from './sequence-card';

type FakeElement = {
  textContent: string;
  hidden: boolean;
  src?: string;
  href?: string;
  alt?: string;
  onClick?: (event: { preventDefault: () => void }) => void;
  addEventListener: (type: string, fn: FakeElement['onClick']) => void;
  children: FakeElement[];
  replaceChildren: () => void;
  append: (...children: FakeElement[]) => void;
};

const element = (): FakeElement => {
  const el: FakeElement = {
    textContent: '',
    hidden: true,
    addEventListener: (_, fn) => {
      el.onClick = fn;
    },
    children: [],
    replaceChildren: () => {
      el.children = [];
    },
    append: (...children) => {
      el.children.push(...children);
    },
  };
  return el;
};

/** Runs the page script against a fake window and returns its handles. */
function mount() {
  const els: Record<string, FakeElement> = {};
  const parent = { postMessage: vi.fn() };
  let onMessage: ((event: { source: unknown; data: unknown }) => void) | null =
    null;
  const window = {
    parent,
    addEventListener: (_: string, fn: typeof onMessage) => {
      onMessage = fn;
    },
  };
  const document = {
    title: 'Sequence',
    getElementById: (id: string) => (els[id] ??= element()),
    createElement: element,
    documentElement: {
      lang: 'en',
      style: { setProperty: vi.fn() },
      scrollHeight: 120,
    },
    body: {},
  };
  // oxlint-disable-next-line typescript/no-implied-eval, no-new-func -- runs the page's own inline script, a trusted constant
  new Function('window', 'document', SEQUENCE_CARD_SCRIPT)(window, document);
  const send = (data: unknown, source: unknown = parent) =>
    onMessage?.({ source, data });
  const sent = () =>
    parent.postMessage.mock.calls.map(([message]) => message as unknown);
  return { els, send, sent, document };
}

type Posted = { id?: number; method?: string; params?: unknown };
const isPosted = (m: unknown): m is Posted =>
  typeof m === 'object' && m !== null;
/** The requests the card posted with this method. */
const posted = (messages: unknown[], method: string) =>
  messages.filter(isPosted).filter((m) => m.method === method);

const toolResult = (params: unknown) => ({
  jsonrpc: '2.0',
  method: 'ui/notifications/tool-result',
  params,
});

describe('sequence card bridge', () => {
  it('localizes the card and switches language without changing the result', () => {
    const { els, send, document } = mount();
    const structuredContent = {
      title: '青牛镇山道',
      status: 'completed',
      style: { id: 'STYLE', name: 'Animated' },
      aspectRatio: '16:9',
      counts: {
        shots: 3,
        imagesReady: 0,
        imagesFailed: 0,
        videosReady: 0,
        videosFailed: 0,
        renderSegments: 0,
      },
      appUrl: 'https://app.test/sequences/SEQ/script',
      poster: { url: 'https://app.test/poster.png' },
    };
    const original = structuredClone(structuredContent);
    send({
      jsonrpc: '2.0',
      id: 1,
      result: {
        hostContext: {
          locale: 'zh-CN',
          'openstory/styleNames': { STYLE: '动画' },
        },
      },
    });
    expect(els.title?.textContent).toBe('加载中…');
    send(toolResult({ structuredContent }));
    expect(els.title?.textContent).toBe('青牛镇山道');
    expect(els.meta?.textContent).toBe('已完成 · 动画 · 16:9');
    expect(els.counts?.children.map((child) => child.textContent)).toEqual([
      '分镜',
      '3',
      '图片已就绪',
      '0',
      '图片失败',
      '0',
      '视频已就绪',
      '0',
      '视频失败',
      '0',
      '渲染片段',
      '0',
    ]);
    expect(els.open).toMatchObject({
      textContent: '在 OpenStory 中打开',
      href: structuredContent.appUrl,
    });
    expect(els.poster?.alt).toBe('青牛镇山道的海报');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('作品');
    send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'dark' },
    });
    expect(els.meta?.textContent).toBe('已完成 · 动画 · 16:9');
    send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { locale: 'en', 'openstory/styleNames': { STYLE: 'Animated' } },
    });
    expect(els.meta?.textContent).toBe('completed · Animated · 16:9');
    expect(els.open?.textContent).toBe('Open in OpenStory');
    expect(els.counts?.children[0]?.textContent).toBe('shots');
    expect(structuredContent).toEqual(original);
  });

  it('preserves custom names and unknown states and count fields', () => {
    const { els, send } = mount();
    send({
      jsonrpc: '2.0',
      id: 1,
      result: {
        hostContext: {
          locale: 'zh-CN',
          'openstory/styleNames': { STYLE: '动画' },
        },
      },
    });
    send(
      toolResult({
        structuredContent: {
          title: 'Untitled sequence',
          status: 'supplier_custom',
          style: { id: 'CUSTOM', name: 'Animated' },
          counts: { customMetric: 7 },
        },
      })
    );
    expect(els.title?.textContent).toBe('Untitled sequence');
    expect(els.meta?.textContent).toBe('supplier_custom · Animated');
    expect(els.counts?.children.map((child) => child.textContent)).toEqual([
      'custom metric',
      '7',
    ]);
  });

  it('localizes fixed errors while preserving server diagnostics', () => {
    const { els, send } = mount();
    send({
      jsonrpc: '2.0',
      id: 1,
      result: { hostContext: { locale: 'zh-CN' } },
    });
    send(toolResult({ isError: true }));
    expect(els.title?.textContent).toBe('作品暂不可用');
    expect(els.error?.textContent).toBe('无法加载作品。');
    send({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled' });
    expect(els.error?.textContent).toBe('请求已取消。');
    send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { locale: 'en' },
    });
    expect(els.error?.textContent).toBe('The request was cancelled.');
    send(
      toolResult({
        isError: true,
        content: [{ type: 'text', text: 'Provider diagnostic' }],
      })
    );
    expect(els.error?.textContent).toBe('Provider diagnostic');
    send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { locale: 'zh-CN' },
    });
    send(
      toolResult({
        isError: true,
        content: [{ type: 'text', text: 'The request was cancelled.' }],
      })
    );
    expect(els.error?.textContent).toBe('The request was cancelled.');
  });

  it('initializes, then renders a result with text only', () => {
    const { els, send, sent } = mount();
    expect(sent()[0]).toMatchObject({ id: 1, method: 'ui/initialize' });
    send({ jsonrpc: '2.0', id: 1, result: { hostContext: { theme: 'dark' } } });
    expect(sent()).toContainEqual(
      expect.objectContaining({ method: 'ui/notifications/initialized' })
    );
    send(
      toolResult({
        structuredContent: {
          title: '<b>Sea</b>',
          status: 'ready',
          counts: { shots: 3, videosReady: 2 },
        },
      })
    );
    expect(els.title?.textContent).toBe('<b>Sea</b>');
    expect(els.counts?.children.map((c) => c.textContent)).toEqual([
      'shots',
      '3',
      'videos ready',
      '2',
    ]);
  });

  it('shows an error result and a cancellation instead of an empty card', () => {
    const { els, send } = mount();
    send(
      toolResult({
        isError: true,
        structuredContent: { error: { code: 'NOT_FOUND', message: 'Gone' } },
      })
    );
    expect(els.error).toMatchObject({ textContent: 'Gone', hidden: false });
    send(
      toolResult({
        isError: true,
        content: [{ type: 'text', text: 'Too big' }],
      })
    );
    expect(els.error?.textContent).toBe('Too big');
    send({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled' });
    expect(els.error?.textContent).toBe('The request was cancelled.');
  });

  it('answers host requests and ignores other windows', () => {
    const { send, sent } = mount();
    send({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: {} });
    send({ jsonrpc: '2.0', id: 8, method: 'ping' });
    send({ jsonrpc: '2.0', id: 9, method: 'ui/unknown' });
    expect(sent()).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: 7, result: {} },
        { jsonrpc: '2.0', id: 8, result: {} },
        expect.objectContaining({
          id: 9,
          error: expect.objectContaining({ code: -32601 }),
        }),
      ])
    );
    const before = sent().length;
    send({ jsonrpc: '2.0', id: 10, method: 'ping' }, {});
    expect(sent()).toHaveLength(before);
  });

  it.each([
    {
      locale: 'en',
      initialLocale: 'zh-CN',
      processing: 'processing',
      completed: 'completed',
      switchedCompleted: '已完成',
      message:
        'OpenStory: "青牛镇山道" (SEQ) finished: completed. 2/2 videos ready.',
    },
    {
      locale: 'zh-CN',
      initialLocale: 'en',
      processing: '处理中',
      completed: '已完成',
      switchedCompleted: 'completed',
      message:
        'OpenStory：作品“青牛镇山道”（SEQ）运行结束，状态：已完成。视频已就绪 2/2。',
    },
  ])(
    'keeps one polling loop and completion message when switching to $locale',
    async ({
      locale,
      initialLocale,
      processing,
      completed,
      switchedCompleted,
      message,
    }) => {
      vi.useFakeTimers();
      try {
        const { els, send, sent } = mount();
        send({
          jsonrpc: '2.0',
          id: 1,
          result: {
            hostCapabilities: { serverTools: {} },
            hostContext: { locale: initialLocale },
          },
        });
        send(
          toolResult({
            structuredContent: {
              id: 'SEQ',
              title: '青牛镇山道',
              status: 'processing',
              sequenceStatus: 'processing',
              counts: { shots: 2, videosReady: 0 },
            },
          })
        );
        const calls = () => posted(sent(), 'tools/call');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(calls()).toHaveLength(1);
        expect(calls()[0]?.params).toEqual({
          name: 'openstory.get_sequence_status',
          arguments: { sequenceId: 'SEQ' },
        });
        const status = (sequenceStatus: string, videosReady: number) => ({
          structuredContent: {
            status: sequenceStatus,
            sequenceStatus,
            counts: { shots: 2, videosReady },
          },
        });
        send({
          jsonrpc: '2.0',
          id: calls()[0]?.id,
          result: status('processing', 1),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        send({
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: { locale },
        });
        expect(els.meta?.textContent).toBe(processing);
        expect(
          els.counts?.children.map((child) => child.textContent)
        ).toContain('1');
        expect(posted(sent(), 'ui/message')).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(calls()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls()).toHaveLength(2);
        send({
          jsonrpc: '2.0',
          id: calls()[1]?.id,
          result: status('completed', 2),
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(els.meta?.textContent).toBe(completed);
        const messages = posted(sent(), 'ui/message');
        expect(messages).toEqual([
          expect.objectContaining({
            params: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: message,
                },
              ],
            },
          }),
        ]);
        send({
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: { locale: initialLocale },
        });
        expect(els.meta?.textContent).toBe(switchedCompleted);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(calls()).toHaveLength(2);
        expect(posted(sent(), 'ui/message')).toEqual(messages);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('does not poll on a host without server tools', async () => {
    vi.useFakeTimers();
    try {
      const { send, sent } = mount();
      send({ jsonrpc: '2.0', id: 1, result: {} });
      send(
        toolResult({
          structuredContent: { id: 'SEQ', sequenceStatus: 'processing' },
        })
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(posted(sent(), 'tools/call')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the sequence in the app through the host', () => {
    const { els, send, sent } = mount();
    send({
      jsonrpc: '2.0',
      id: 1,
      result: { hostCapabilities: { openLinks: {} } },
    });
    send(
      toolResult({
        structuredContent: {
          id: 'SEQ',
          appUrl: 'https://app.test/sequences/SEQ/script',
        },
      })
    );
    expect(els.open).toMatchObject({
      href: 'https://app.test/sequences/SEQ/script',
      hidden: false,
    });
    const preventDefault = vi.fn();
    els.open?.onClick?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(posted(sent(), 'ui/open-link')).toEqual([
      expect.objectContaining({
        params: { url: 'https://app.test/sequences/SEQ/script' },
      }),
    ]);
  });
});
