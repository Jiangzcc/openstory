import {
  chat,
  chatParamsFromRequest,
  hashSchemaInput,
  normalizeApprovalSchema,
  toServerSentEventsResponse,
  toolDefinition,
} from '@tanstack/ai';
import type { Interrupt } from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { ChatClient, InterruptManager } from '@tanstack/ai-react';
import type { InterruptManagerSubmission } from '@tanstack/ai-client';
import {
  memoryPersistence,
  reconstructChat,
  withPersistence,
} from '@tanstack/ai-persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAssistantConnection } from './assistant-connection';
import { resolveAssistantToolApproval } from './assistant-approvals';

const THREAD_ID = 'mock-approval-thread';
const RUN_ID = 'mock-interrupted-run';
const TOOL_NAME = 'openstory_delete_character';
const TOOL_CALL_ID = 'mock-delete-call';
const INPUT = { characterId: 'mock-character' };
const definition = toolDefinition({
  name: TOOL_NAME,
  description: 'Delete an in-memory mock character for approval tests.',
  inputSchema: z.object({ characterId: z.string() }),
  needsApproval: true,
});
const clients: Array<{ dispose: () => void }> = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});

function createHarness(callIds = [TOOL_CALL_ID]) {
  const execute = vi.fn(async ({ characterId }: typeof INPUT) => ({
    deleted: characterId,
  }));
  const tool = definition.server(execute);
  const persistence = memoryPersistence();
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: callIds.map((id) => ({ id, name: TOOL_NAME, input: INPUT })),
    },
    { text: 'Mock confirmation completed.' },
  ]);
  const fetchClient = vi.fn<typeof fetch>(async (input, init) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(input, 'https://mock.invalid'), init);
    if (request.method === 'GET') return reconstructChat(persistence, request);
    const params = await chatParamsFromRequest(request);
    return toServerSentEventsResponse(
      chat({
        ...params,
        adapter,
        tools: [tool],
        middleware: [withPersistence(persistence)],
      })
    );
  });
  const createClient = () => {
    const client = new ChatClient({
      threadId: THREAD_ID,
      persistence: true,
      connection: createAssistantConnection(fetchClient),
    });
    clients.push(client);
    return client;
  };
  return { execute, fetchClient, createClient };
}

function toolResults(client: ChatClient) {
  return client
    .getSnapshot()
    .messages.flatMap((message) =>
      message.parts.filter((part) => part.type === 'tool-result')
    );
}

async function waitForCompletion(client: ChatClient) {
  await vi.waitFor(() => {
    expect(client.getSnapshot().isLoading).toBe(false);
    expect(client.getInterrupts()).toHaveLength(0);
    expect(client.getSnapshot().error).toBeUndefined();
    expect(toolResults(client).length).toBeGreaterThan(0);
  });
}

describe('server-only assistant tool approval resumes', () => {
  it.each([true, false])(
    'ignores repeated clicks captured before rerender with approved=%s',
    async (approved) => {
      const harness = createHarness();
      const client = harness.createClient();
      await client.sendMessage('Delete the mock character.');
      const captured = client.getInterrupts();
      expect(
        resolveAssistantToolApproval(captured, TOOL_CALL_ID, approved)
      ).toBe(true);
      expect(
        resolveAssistantToolApproval(captured, TOOL_CALL_ID, approved)
      ).toBe(false);
      await waitForCompletion(client);
      expect(harness.execute).toHaveBeenCalledTimes(approved ? 1 : 0);
      expect(
        harness.fetchClient.mock.calls.filter(
          ([, init]) => init?.method === 'POST'
        )
      ).toHaveLength(2);
    }
  );

  it.each([true, false])(
    'resumes a server tool with approved=%s',
    async (approved) => {
      const harness = createHarness();
      const client = harness.createClient();
      await client.sendMessage('Delete the mock character.');
      expect(harness.execute).not.toHaveBeenCalled();
      expect(client.getInterrupts()[0]).toMatchObject({
        kind: 'generic',
        canResolve: true,
      });

      expect(
        resolveAssistantToolApproval(
          client.getInterrupts(),
          TOOL_CALL_ID,
          approved
        )
      ).toBe(true);
      await waitForCompletion(client);
      expect(harness.execute).toHaveBeenCalledTimes(approved ? 1 : 0);
      expect(toolResults(client)[0]).toMatchObject(
        approved ? { state: 'complete' } : { state: 'error', outcome: 'denied' }
      );
      expect(
        harness.fetchClient.mock.calls.filter(
          ([, init]) => init?.method === 'POST'
        )
      ).toHaveLength(2);
    }
  );

  it.each([true, false])(
    'restores a paused approval from server history with approved=%s',
    async (approved) => {
      const harness = createHarness();
      const original = harness.createClient();
      await original.sendMessage('Delete the mock character.');
      original.dispose();
      const restored = harness.createClient();
      restored.attach();
      await vi.waitFor(() => expect(restored.getInterrupts()).toHaveLength(1));
      expect(restored.getInterrupts()[0]?.kind).toBe('generic');

      expect(
        resolveAssistantToolApproval(
          restored.getInterrupts(),
          TOOL_CALL_ID,
          approved
        )
      ).toBe(true);
      await waitForCompletion(restored);
      expect(harness.execute).toHaveBeenCalledTimes(approved ? 1 : 0);
      expect(toolResults(restored)[0]).toMatchObject(
        approved ? { state: 'complete' } : { state: 'error', outcome: 'denied' }
      );
    }
  );

  it('waits for every tool decision and resumes the batch once', async () => {
    const otherCallId = 'mock-second-delete-call';
    const harness = createHarness([TOOL_CALL_ID, otherCallId]);
    const client = harness.createClient();
    await client.sendMessage('Delete two mock characters.');
    expect(client.getInterrupts()).toHaveLength(2);
    expect(
      resolveAssistantToolApproval(client.getInterrupts(), TOOL_CALL_ID, true)
    ).toBe(true);
    expect(harness.execute).not.toHaveBeenCalled();
    expect(
      resolveAssistantToolApproval(client.getInterrupts(), TOOL_CALL_ID, true)
    ).toBe(false);
    expect(
      resolveAssistantToolApproval(client.getInterrupts(), otherCallId, false)
    ).toBe(true);
    expect(
      resolveAssistantToolApproval(client.getInterrupts(), otherCallId, false)
    ).toBe(false);

    await waitForCompletion(client);
    expect(harness.execute).toHaveBeenCalledOnce();
    expect(toolResults(client)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: TOOL_CALL_ID,
          state: 'complete',
        }),
        expect.objectContaining({
          toolCallId: otherCallId,
          state: 'error',
          outcome: 'denied',
        }),
      ])
    );
    expect(
      harness.fetchClient.mock.calls.filter(
        ([, init]) => init?.method === 'POST'
      )
    ).toHaveLength(2);
  });
});

function approvalDescriptor(): Interrupt {
  const approval = normalizeApprovalSchema(undefined, definition.inputSchema);
  return {
    id: 'mock-approval',
    reason: 'tool_call',
    toolCallId: TOOL_CALL_ID,
    responseSchema: approval.responseSchema,
    metadata: {
      'tanstack:interruptBinding': {
        v: 1,
        kind: 'tool-approval',
        interruptId: 'mock-approval',
        interruptedRunId: RUN_ID,
        generation: 0,
        toolName: TOOL_NAME,
        toolCallId: TOOL_CALL_ID,
        originalArgs: INPUT,
        inputSchemaHash: hashSchemaInput(definition.inputSchema),
        approvalSchemaHash: approval.approvalSchemaHash,
        responseSchemaHash: approval.responseSchemaHash,
      },
    },
  };
}

function createManager(
  interrupts = [approvalDescriptor()],
  registered = false
) {
  const submit = vi.fn(async (_submission: InterruptManagerSubmission) => {});
  const manager = new InterruptManager({
    tools: registered ? [definition] : [],
    submit,
  });
  manager.hydrate({
    threadId: THREAD_ID,
    interruptedRunId: RUN_ID,
    generation: 0,
    interrupts,
  });
  return { manager, submit };
}

describe('approval binding guards', () => {
  it('allows a fresh error snapshot to retry after a failed submission', async () => {
    const { manager, submit } = createManager();
    submit.mockRejectedValueOnce(new Error('Mock connection failure.'));
    const initial = manager.getInterrupts();
    expect(resolveAssistantToolApproval(initial, TOOL_CALL_ID, true)).toBe(
      true
    );
    await vi.waitFor(() => {
      expect(manager.getInterrupts()[0]?.status).toBe('error');
    });
    const retry = manager.getInterrupts();
    expect(retry[0]).not.toBe(initial[0]);
    expect(resolveAssistantToolApproval(retry, TOOL_CALL_ID, false)).toBe(true);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      resolutions: [
        { interruptId: 'mock-approval', payload: { approved: false } },
      ],
    });
  });

  it.each([true, false])(
    'keeps registered typed approvals working with approved=%s',
    async (approved) => {
      const { manager, submit } = createManager(undefined, true);
      expect(manager.getInterrupts()[0]?.kind).toBe('tool-approval');
      expect(
        resolveAssistantToolApproval(
          manager.getInterrupts(),
          TOOL_CALL_ID,
          approved
        )
      ).toBe(true);
      await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
      expect(submit.mock.calls[0]?.[0]).toMatchObject({
        resolutions: [{ interruptId: 'mock-approval', payload: { approved } }],
      });
    }
  );

  it('ignores tool calls without a matching approval', () => {
    const { manager, submit } = createManager();
    expect(
      resolveAssistantToolApproval(
        manager.getInterrupts(),
        'unknown-call',
        true
      )
    ).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not turn an unrelated generic interrupt into a tool approval', () => {
    const { manager, submit } = createManager([
      {
        id: 'mock-generic',
        reason: 'tool_call',
        toolCallId: TOOL_CALL_ID,
        metadata: {
          'tanstack:interruptBinding': {
            v: 1,
            kind: 'generic',
            interruptId: 'mock-generic',
            interruptedRunId: RUN_ID,
            generation: 0,
          },
        },
      },
    ]);
    expect(manager.getInterrupts()[0]).toMatchObject({
      kind: 'generic',
      canResolve: true,
    });
    expect(
      resolveAssistantToolApproval(manager.getInterrupts(), TOOL_CALL_ID, true)
    ).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('leaves malformed and stale bindings unresolved', () => {
    const { metadata: _metadata, ...descriptor } = approvalDescriptor();
    for (const metadata of [
      undefined,
      {
        'tanstack:interruptBinding': {
          kind: 'tool-approval',
          toolCallId: TOOL_CALL_ID,
        },
      },
    ]) {
      const { manager, submit } = createManager([
        { ...descriptor, ...(metadata === undefined ? {} : { metadata }) },
      ]);
      expect(
        resolveAssistantToolApproval(
          manager.getInterrupts(),
          TOOL_CALL_ID,
          true
        )
      ).toBe(false);
      expect(submit).not.toHaveBeenCalled();
    }
  });

  it.each(['interruptId', 'interruptedRunId', 'generation'] as const)(
    'refuses a snapshot with a different %s',
    (field) => {
      const { manager, submit } = createManager();
      const item = manager.getInterrupts()[0];
      if (!item) throw new Error('Missing mock approval');
      const stale =
        field === 'generation'
          ? { ...item, generation: item.generation + 1 }
          : { ...item, [field]: 'another-interrupt-or-run' };
      expect(resolveAssistantToolApproval([stale], TOOL_CALL_ID, true)).toBe(
        false
      );
      expect(submit).not.toHaveBeenCalled();
    }
  );
});
