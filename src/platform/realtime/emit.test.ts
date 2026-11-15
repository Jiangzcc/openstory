import { beforeEach, describe, expect, it, vi } from 'vitest';

const HTTP_STATUS = {
  noContent: 204,
  badRequest: 400,
  serviceUnavailable: 503,
} as const;

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(null, { status: HTTP_STATUS.noContent })
);
vi.doMock('#env', () => ({
  getEnv: () => ({
    REALTIME: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: fetchMock }),
    },
  }),
}));

// Dynamic import so the mock applies (vi.doMock is not hoisted).
const { getShotPromptChannel, getGenerationChannel, getBillingChannel } =
  await import('./index');

beforeEach(() => {
  fetchMock
    .mockReset()
    .mockResolvedValue(new Response(null, { status: HTTP_STATUS.noContent }));
});

function lastBody() {
  const body = fetchMock.mock.calls.at(-1)?.[1]?.body;
  if (typeof body !== 'string')
    throw new Error('emit did not send a JSON body');
  return JSON.parse(body);
}

describe('realtimeChannel emit', () => {
  it('flags shotPrompt.streaming as transient so the DO never stores it (#1811)', async () => {
    await getShotPromptChannel('shot-1').emit('shotPrompt.streaming', {
      promptType: 'visual',
      delta: 'a',
    });
    expect(lastBody()).toEqual({
      event: 'shotPrompt.streaming',
      data: { promptType: 'visual', delta: 'a' },
      transient: true,
    });
  });

  it('leaves a terminal event persisted', async () => {
    await getShotPromptChannel('shot-1').emit('shotPrompt.completed', {
      promptType: 'visual',
    });
    expect(lastBody()).not.toHaveProperty('transient');
  });
});

describe('best-effort emit failures', () => {
  it.each([HTTP_STATUS.badRequest, HTTP_STATUS.serviceUnavailable])(
    'resolves for an HTTP %i response',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));

      await expect(
        getGenerationChannel('sequence').emit('generation.failed', {
          message: 'failure',
        })
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );

  it.each([new Error('transport unavailable'), { reason: 'connection reset' }])(
    'resolves when fetch throws %j',
    async (failure) => {
      fetchMock.mockRejectedValueOnce(failure);

      await expect(
        getGenerationChannel('sequence').emit('generation.failed', {
          message: 'failure',
        })
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );
});

describe.each([
  ['generation', getGenerationChannel],
  ['shot-prompt', getShotPromptChannel],
  ['billing', getBillingChannel],
] as const)('missing %s channel', (_label, getChannel) => {
  it('resolves without sending', async () => {
    await expect(
      getChannel().emit('generation.failed', { message: 'failure' })
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
