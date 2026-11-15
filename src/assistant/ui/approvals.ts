import { readInterruptBinding } from '@tanstack/ai/client';
import type {
  ChatInterrupt,
  InterruptItemStatus,
  ToolApprovalInterrupt,
} from '@tanstack/ai-client';

export type ApprovalState = 'open' | 'staged' | 'busy' | 'stuck' | 'gone';
export type ComposerHold = 'none' | 'approval' | 'stuck';

type PayloadlessToolApproval = Pick<
  ToolApprovalInterrupt,
  'kind' | 'toolCallId' | 'canResolve' | 'status'
> & { resolveInterrupt: (approved: boolean) => void };
type AssistantInterrupt = ChatInterrupt | PayloadlessToolApproval;
const answeredInterrupts = new WeakSet<AssistantInterrupt>();

function toolCallIdOf(interrupt: AssistantInterrupt): string | undefined {
  if (interrupt.kind === 'tool-approval') return interrupt.toolCallId;
  if (interrupt.kind !== 'generic') return undefined;
  const binding = readInterruptBinding(interrupt);
  if (
    binding?.kind !== 'tool-approval' ||
    binding.interruptId !== interrupt.interruptId ||
    binding.interruptedRunId !== interrupt.interruptedRunId ||
    binding.generation !== interrupt.generation
  ) {
    return undefined;
  }
  return binding.toolCallId;
}

export function approvalFor<T extends AssistantInterrupt>(
  interrupts: ReadonlyArray<T>,
  toolCallId: string
): T | undefined {
  return interrupts.find((interrupt) => toolCallIdOf(interrupt) === toolCallId);
}

function stateOfStatus(status: InterruptItemStatus): ApprovalState {
  switch (status) {
    case 'pending':
    case 'error':
      return 'open';
    case 'staged':
      return 'staged';
    case 'validating':
    case 'submitting':
      return 'busy';
    default: {
      const unknown: never = status;
      throw new Error(`Unknown interrupt status: ${String(unknown)}`);
    }
  }
}

export function approvalState(
  interrupt: AssistantInterrupt | undefined,
  busy: boolean
): ApprovalState {
  if (busy) return 'busy';
  if (!interrupt) return 'gone';
  if (!interrupt.canResolve) return 'stuck';
  return stateOfStatus(interrupt.status);
}

export function composerHold(
  interrupts: ReadonlyArray<AssistantInterrupt>,
  resuming: boolean
): ComposerHold {
  if (
    interrupts.some(
      (interrupt) => !interrupt.canResolve || !toolCallIdOf(interrupt)
    )
  ) {
    return 'stuck';
  }
  return interrupts.length > 0 || resuming ? 'approval' : 'none';
}

export function answerOpenApproval(
  interrupts: ReadonlyArray<AssistantInterrupt>,
  toolCallId: string,
  busy: boolean,
  approved: boolean
): boolean {
  const interrupt = approvalFor(interrupts, toolCallId);
  if (
    !interrupt ||
    answeredInterrupts.has(interrupt) ||
    approvalState(interrupt, busy) !== 'open'
  ) {
    return false;
  }
  if (interrupt.kind === 'tool-approval') {
    interrupt.resolveInterrupt(approved);
  } else if (interrupt.kind === 'generic') {
    interrupt.resolveInterrupt({ approved });
  } else {
    return false;
  }
  answeredInterrupts.add(interrupt);
  return true;
}
