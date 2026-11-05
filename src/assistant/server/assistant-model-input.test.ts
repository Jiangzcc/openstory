import { expect, it } from 'vitest';
import {
  chat,
  toServerSentEventsResponse,
  type ModelMessage,
  type StreamChunk,
} from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { memoryPersistence, withPersistence } from '@tanstack/ai-persistence';
import {
  assistantVisionMiddleware,
  requireAssistantVision,
} from './assistant-model-input';

const THREAD_ID = 'mock-vision-thread';
const IMAGE_MESSAGE: ModelMessage = {
  id: 'stored-image',
  role: 'user',
  content: [
    {
      type: 'image',
      source: { type: 'url', value: 'https://example.test/still.png' },
    },
  ],
};
const TEXT_MESSAGE: ModelMessage = {
  id: 'new-text',
  role: 'user',
  content: 'Describe the previous image.',
};

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function storedTurn(
  supportsVision: boolean,
  stored: ModelMessage[],
  messages: ModelMessage[]
) {
  const persistence = memoryPersistence();
  await persistence.stores.messages.saveThread(THREAD_ID, stored);
  const adapter = fakeText({ input: ['text', 'image'] });
  adapter.setResponses([{ text: 'Mock answer' }]);
  const stream = chat({
    adapter,
    messages,
    threadId: THREAD_ID,
    runId: 'mock-vision-run',
    middleware: [
      withPersistence(persistence),
      assistantVisionMiddleware(supportsVision),
    ],
  });
  return { stream, adapter, persistence };
}

it.each([{ messages: [] }, { messages: [TEXT_MESSAGE] }])(
  'refuses stored images before a model call for partial input $messages',
  async ({ messages }) => {
    const turn = await storedTurn(false, [IMAGE_MESSAGE], messages);
    await expect(collect(turn.stream)).rejects.toThrow('support vision');
    expect(turn.adapter.state.callCount).toBe(0);
    expect(
      await turn.persistence.stores.messages.loadThread(THREAD_ID)
    ).toEqual([IMAGE_MESSAGE]);
  }
);

it('lets a vision model receive the merged stored image', async () => {
  const turn = await storedTurn(true, [IMAGE_MESSAGE], [TEXT_MESSAGE]);
  turn.adapter.setResponses([
    ({ request }) => {
      expect(request.messages).toContainEqual(IMAGE_MESSAGE);
      return { text: 'Mock answer with stored image' };
    },
  ]);
  const chunks = await collect(turn.stream);
  expect(turn.adapter.state.callCount).toBe(1);
  expect(chunks.some((chunk) => chunk.type === 'RUN_FINISHED')).toBe(true);
});

it('lets a text-only model continue a text-only transcript', async () => {
  const turn = await storedTurn(false, [], [TEXT_MESSAGE]);
  await collect(turn.stream);
  expect(turn.adapter.state.callCount).toBe(1);
});

it('retains the early rejection for page image context', () => {
  expect(() =>
    requireAssistantVision(
      [],
      [{ kind: 'shot', id: 'shot', label: 'Shot', image: '/r2/mock.png' }],
      false
    )
  ).toThrow('support vision');
});

it('returns a readable stream error when stored images fail validation', async () => {
  const turn = await storedTurn(false, [IMAGE_MESSAGE], [TEXT_MESSAGE]);
  const response = toServerSentEventsResponse(turn.stream);
  const wire = await response.text();
  expect(wire).toContain('RUN_ERROR');
  expect(wire).toContain('support vision');
  expect(turn.adapter.state.callCount).toBe(0);
});
