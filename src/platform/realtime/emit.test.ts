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

describe('generation lifecycle owner transport', () => {
  it('posts the explicit instance and claim in the durable event payload', async () => {
    const workflowOwner = {
      workflowRunId: 'actual-instance',
      workflowClaimId: 'raw/claim',
    };
    await getGenerationChannel('sequence').emit('generation.failed', {
      message: 'failure',
      workflowOwner,
    });
    expect(lastBody()).toEqual({
      event: 'generation.failed',
      data: { message: 'failure', workflowOwner },
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      'https://realtime.do/emit?channel=sequence'
    );
  });
});

const bestEffortCases = [
  ['omitted options', undefined],
  ['explicit best-effort', { requireAcknowledgement: false }],
] as const;

describe('best-effort emit failures', () => {
  it.each(bestEffortCases)(
    '%s resolves for a non-2xx response',
    async (_label, options) => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: HTTP_STATUS.serviceUnavailable })
      );

      await expect(
        getGenerationChannel('sequence').emit(
          'generation.failed',
          { message: 'failure' },
          options
        )
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );

  it.each(bestEffortCases)(
    '%s resolves when fetch throws',
    async (_label, options) => {
      fetchMock.mockRejectedValueOnce(new Error('transport unavailable'));

      await expect(
        getGenerationChannel('sequence').emit(
          'generation.failed',
          { message: 'failure' },
          options
        )
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );
});

describe('required emit acknowledgement', () => {
  it.each([HTTP_STATUS.badRequest, HTTP_STATUS.serviceUnavailable])(
    'rejects HTTP %i responses',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));

      await expect(
        getGenerationChannel('sequence').emit(
          'generation.failed',
          { message: 'failure' },
          { requireAcknowledgement: true }
        )
      ).rejects.toThrow('HTTP ' + status);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );

  it.each([new Error('transport unavailable'), { reason: 'connection reset' }])(
    'preserves the original fetch rejection %j',
    async (failure) => {
      fetchMock.mockRejectedValueOnce(failure);

      await expect(
        getGenerationChannel('sequence').emit(
          'generation.failed',
          { message: 'failure' },
          { requireAcknowledgement: true }
        )
      ).rejects.toBe(failure);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );
});

describe('acknowledged emit request', () => {
  it('accepts a successful response without changing the HTTP request', async () => {
    await expect(
      getGenerationChannel('sequence').emit(
        'generation.failed',
        { message: 'failure' },
        { requireAcknowledgement: true }
      )
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://realtime.do/emit?channel=sequence',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'generation.failed',
          data: { message: 'failure' },
        }),
      }
    );
  });
});

describe.each([
  ['generation', getGenerationChannel],
  ['shot-prompt', getShotPromptChannel],
  ['billing', getBillingChannel],
] as const)('missing %s channel', (_label, getChannel) => {
  it.each(bestEffortCases)('%s still resolves', async (_mode, options) => {
    await expect(
      getChannel().emit('generation.failed', { message: 'failure' }, options)
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when acknowledgement is required', async () => {
    await expect(
      getChannel().emit(
        'generation.failed',
        { message: 'failure' },
        { requireAcknowledgement: true }
      )
    ).rejects.toThrow('missing channel id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
