import {
  hashSchemaInput,
  normalizeApprovalSchema,
  readInterruptBinding,
} from '@tanstack/ai';
import { ChatClient } from '@tanstack/ai-react';
import type { StreamChunk } from '@tanstack/ai';
import { afterEach, expect, it, vi } from 'vitest';
import { scriptedConnection } from './scripted-connection';

const clients: ChatClient[] = [];
const mockCall = {
  name: 'openstory_delete_character',
  input: { characterId: 'mock-character' },
  result: { deleted: true },
  needsApproval: true,
  delayMs: 0,
};

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});

it('emits an approval binding with valid SDK schema identities', async () => {
  const connection = scriptedConnection({
    steps: [{ toolCalls: [mockCall] }],
  });
  if (!('connect' in connection)) throw new Error('Missing scripted connect');
  const chunks: StreamChunk[] = [];
  for await (const chunk of connection.connect([], undefined, undefined, {
    threadId: 'mock-thread',
    runId: 'mock-run',
  })) {
    chunks.push(chunk);
  }
  const finished = chunks.find((chunk) => chunk.type === 'RUN_FINISHED');
  if (finished?.outcome?.type !== 'interrupt') {
    throw new Error('Missing scripted approval');
  }
  const interrupt = finished.outcome.interrupts[0];
  if (!interrupt) throw new Error('Missing scripted approval descriptor');
  const approval = normalizeApprovalSchema(undefined);
  expect(readInterruptBinding(interrupt)).toMatchObject({
    kind: 'tool-approval',
    toolName: mockCall.name,
    inputSchemaHash: hashSchemaInput(undefined),
    approvalSchemaHash: approval.approvalSchemaHash,
    responseSchemaHash: approval.responseSchemaHash,
  });
  expect(interrupt.responseSchema).toEqual(approval.responseSchema);
});

it.each([true, false])(
  'resumes a scripted server-tool approval through the real chat client: %s',
  async (approved) => {
    const onChunk = vi.fn<(chunk: StreamChunk) => void>();
    const connection = scriptedConnection({
      steps: [{ toolCalls: [mockCall] }, { text: 'Done' }],
    });
    if (!('connect' in connection)) throw new Error('Missing scripted connect');
    const connect = vi.spyOn(connection, 'connect');
    const client = new ChatClient({
      threadId: 'mock-thread',
      connection,
      onChunk,
    });
    clients.push(client);
    await client.sendMessage('Delete the mock character');
    const interrupt = client.getInterrupts()[0];
    expect(interrupt).toMatchObject({ kind: 'generic', canResolve: true });
    if (interrupt?.kind !== 'generic') {
      throw new Error('Missing generic server-tool approval');
    }
    interrupt.resolveInterrupt({ approved });
    await vi.waitFor(() => {
      expect(client.getInterrupts()).toHaveLength(0);
      expect(client.getSnapshot().isLoading).toBe(false);
      expect(connect).toHaveBeenCalledTimes(2);
    });
    expect(connect.mock.calls[1]?.[3]?.resume).toEqual([
      expect.objectContaining({
        interruptId: interrupt.id,
        status: 'resolved',
        payload: { approved },
      }),
    ]);
    const result = onChunk.mock.calls
      .map(([chunk]) => chunk)
      .find((chunk) => chunk.type === 'TOOL_CALL_RESULT');
    expect(result).toMatchObject({
      content: approved
        ? JSON.stringify(mockCall.result)
        : 'Error executing tool: the user denied this call',
      ...(!approved && {
        metadata: {
          tanstack: { state: 'output-error', toolResultOutcome: 'denied' },
        },
      }),
    });
  }
);
