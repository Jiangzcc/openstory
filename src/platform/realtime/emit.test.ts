import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(null, { status: 204 })
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
const { getShotPromptChannel, getGenerationChannel } = await import('./index');

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
