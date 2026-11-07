import { readInterruptBinding } from '@tanstack/ai/client';
import type { ChatInterrupt, ToolApprovalInterrupt } from '@tanstack/ai-client';

type PayloadlessToolApproval = Pick<
  ToolApprovalInterrupt,
  'kind' | 'toolCallId' | 'canResolve' | 'status'
> & { resolveInterrupt: (approved: boolean) => void };
type AssistantInterrupt = ChatInterrupt | PayloadlessToolApproval;
const answeredInterrupts = new WeakSet<AssistantInterrupt>();

function isToolApprovalFor(
  interrupt: AssistantInterrupt,
  toolCallId: string
): boolean {
  if (interrupt.kind === 'tool-approval') {
    return interrupt.toolCallId === toolCallId;
  }
  if (interrupt.kind !== 'generic') return false;
  const binding = readInterruptBinding(interrupt);
  return (
    binding?.kind === 'tool-approval' &&
    binding.toolCallId === toolCallId &&
    binding.interruptId === interrupt.interruptId &&
    binding.interruptedRunId === interrupt.interruptedRunId &&
    binding.generation === interrupt.generation
  );
}

export function resolveAssistantToolApproval(
  interrupts: ReadonlyArray<AssistantInterrupt>,
  toolCallId: string,
  approved: boolean
): boolean {
  const interrupt = interrupts.find(
    (item) =>
      !answeredInterrupts.has(item) &&
      item.canResolve &&
      (item.status === 'pending' || item.status === 'error') &&
      isToolApprovalFor(item, toolCallId)
  );
  if (interrupt?.kind === 'tool-approval') {
    interrupt.resolveInterrupt(approved);
    answeredInterrupts.add(interrupt);
    return true;
  }
  if (interrupt?.kind === 'generic') {
    interrupt.resolveInterrupt({ approved });
    answeredInterrupts.add(interrupt);
    return true;
  }
  return false;
}
