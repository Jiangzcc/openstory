/**
 * The assistant's `useChat` (#2155): one SSE connection to
 * /api/assistant/chat, server-authoritative history by thread id (a reload
 * or a second tab hydrates the same transcript and any paused approval),
 * and the page context forwarded with every send.
 */

import { useChat } from '@tanstack/ai-react';
import type { ConnectionAdapter } from '@tanstack/ai-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { isInsufficientCreditsError } from '@/platform/errors';
import { notifyInsufficientCredits } from '@/billing/ui/notify-insufficient-credits';
import type { AnalysisModelId } from '@/models/models.config';
import { PAGE_CONTEXT_NOUN, type PageContextItem } from '../page-context';
import {
  REPLACE_UNSAVED_TEXT,
  type ReplaceUnsavedTextInput,
} from '../unsaved-text-tool';
import { getAssistantState } from './assistant-store';
import { createAssistantConnection } from './assistant-connection';

/**
 * The browser side of `replace_unsaved_text`: the server advertises the
 * definition when the page reports a draft; the page's `AssistantContextItem`
 * registered how to write into its editor. The id is always `draft`: a page
 * holds one draft of a kind.
 */
const replaceUnsavedText = {
  ...REPLACE_UNSAVED_TEXT,
  __toolSide: 'client' as const,
  execute: ({ kind, text }: ReplaceUnsavedTextInput) => {
    const replace = getAssistantState().draftEditors.get(`${kind}:draft`);
    if (!replace) {
      throw new Error(
        `There is no ${PAGE_CONTEXT_NOUN[kind].toLowerCase()} on this page any more.`
      );
    }
    replace(text);
    return { replaced: true, characters: text.length };
  },
};

/** A tool that changes something: anything but a read, whoami or the engine's own. */
function isWriteTool(name: string): boolean {
  return /^openstory_(?!get_|list_)/.test(name);
}

export type AssistantChatOptions = {
  threadId: string;
  pageContext: PageContextItem[];
  model: AnalysisModelId;
  /** Stories and tests hand in a scripted connection. */
  connection?: ConnectionAdapter;
};

export function useAssistantChat({
  threadId,
  pageContext,
  model,
  connection,
}: AssistantChatOptions) {
  const live = useMemo(
    () => connection ?? createAssistantConnection(),
    [connection]
  );
  const queryClient = useQueryClient();
  // A write the model made lands on the page the user is looking at: the
  // Images grid shows the asset generating, a shot its new prompt. Reads
  // change nothing, so they refetch nothing.
  const writes = useRef(new Set<string>());
  return useChat({
    connection: live,
    threadId,
    persistence: true,
    tools: [replaceUnsavedText],
    forwardedProps: { pageContext, model },
    onError: (error) => {
      if (isInsufficientCreditsError(error)) notifyInsufficientCredits();
    },
    onChunk: (chunk) => {
      if (chunk.type === 'TOOL_CALL_START' && isWriteTool(chunk.toolCallName)) {
        writes.current.add(chunk.toolCallId);
      } else if (
        chunk.type === 'TOOL_CALL_RESULT' &&
        writes.current.delete(chunk.toolCallId)
      ) {
        void queryClient.invalidateQueries();
      }
    },
  });
}
