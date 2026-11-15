import { isInsufficientCreditsError } from '@/platform/errors';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useTranslation } from 'react-i18next';
/**
 * One thread (#2155): the virtualised message list over `useChat`, the
 * approvals bound to their tool cards, and the composer. Owns the chat so
 * the panel shell can swap threads by key.
 */

import type { ConnectionAdapter } from '@tanstack/ai-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/ui/shadcn/button';
import type { PageContextItem } from '../page-context';
import {
  answerOpenApproval,
  approvalFor,
  approvalState,
  composerHold,
} from './approvals';
import type { ComposerHold } from './approvals';
import { AssistantComposer, HOLD_COPY } from './assistant-composer';
import { AssistantMessage } from './assistant-message';
import { useModelDefaults } from '@/models/ui/use-model-defaults';
import {
  textModelSelectionError,
  useTextModelCatalog,
} from '@/models/ui/use-text-model-catalog';
import { setAssistantModel, useAssistantState } from './assistant-store';
import { useAssistantChat } from './use-assistant-chat';

export type AssistantConversationProps = {
  threadId: string;
  pageContext: PageContextItem[];
  onDismissContext: (item: PageContextItem) => void;
  initialPrompt?: string;
  /** Changes with each hand-over so the composer remounts with the text. */
  draftKey?: string;
  /** Three starters for an empty thread; the page decides them. */
  suggestions: string[];
  connection?: ConnectionAdapter;
  uploadStub?: (file: File) => Promise<string>;
};

/** Remounts the thread on Reload, so the chat hydrates again from the server. */
export const AssistantConversation: React.FC<AssistantConversationProps> = (
  props
) => {
  const [generation, setGeneration] = useState(0);
  return (
    <Conversation
      key={generation}
      {...props}
      onReload={() => setGeneration((n) => n + 1)}
    />
  );
};

const Conversation: React.FC<
  AssistantConversationProps & { onReload: () => void }
> = ({
  threadId,
  pageContext,
  onDismissContext,
  initialPrompt,
  draftKey,
  suggestions,
  connection,
  uploadStub,
  onReload,
}) => {
  const { t } = useTranslation('assistant');
  const translateLabel = useLabelTranslation('assistant');
  const localizedSuggestions = suggestions.map(translateLabel);

  const queryClient = useQueryClient();
  const { model: preferredModel } = useAssistantState();
  const { configuration, isReady: defaultsReady } = useModelDefaults();
  const model = preferredModel ?? configuration.defaultAnalysis;
  const catalog = useTextModelCatalog();
  const modelError = textModelSelectionError([model], catalog, 'tools');
  const modelReady = defaultsReady && !modelError;
  const chat = useAssistantChat({ threadId, pageContext, model, connection });
  const {
    messages,
    sendMessage,
    isLoading,
    isHydrating,
    error,
    stop,
    interrupts,
    interruptErrors,
    resuming,
  } = chat;
  const [sendError, setSendError] = useState<
    Error | Exclude<ComposerHold, 'none'>
  >();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  const runBusy = isLoading || isHydrating || resuming;
  const hold = composerHold(interrupts, resuming);
  const answer = (toolCallId: string, approved: boolean) => {
    if (answerOpenApproval(interrupts, toolCallId, runBusy, approved)) {
      setSendError(undefined);
    }
  };
  const approvals = {
    stateOf: (toolCallId: string) =>
      approvalState(approvalFor(interrupts, toolCallId), runBusy),
    errorOf: (toolCallId: string) =>
      approvalFor(interrupts, toolCallId)?.errors[0]?.message,
    approve: (toolCallId: string) => answer(toolCallId, true),
    deny: (toolCallId: string) => answer(toolCallId, false),
    reload: onReload,
  };

  const send = (content: Parameters<typeof sendMessage>[0]) => {
    if (!modelReady) return;
    // A view can post while the run is paused; the composer gate does not cover it.
    if (hold !== 'none') {
      setSendError(hold);
      return;
    }
    setSendError(undefined);
    sendMessage(content).catch((cause: unknown) =>
      setSendError(cause instanceof Error ? cause : new Error(String(cause)))
    );
  };
  const alert =
    error ??
    (typeof sendError === 'string'
      ? new Error(t(HOLD_COPY[sendError]))
      : sendError) ??
    interruptErrors[0];

  const lastId = messages.at(-1)?.id;
  const items = virtualizer.getVirtualItems();
  // A new reply or a growing one keeps the end in view unless the user has
  // scrolled up to read; `scrollToIndex` on the last item is a no-op when
  // the list is already there.
  const follow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearEnd && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col justify-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium">
              {t('What do you want to do?')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                'Ask about your work or tell me what to change. I can read and edit anything the app can, and I ask before I delete.'
              )}
            </p>
          </div>
          <ul
            className="flex flex-col gap-1"
            aria-label={t('Suggested prompts')}
          >
            {localizedSuggestions.map((suggestion) => (
              <li key={suggestion}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto w-full justify-start whitespace-normal py-1.5 text-left"
                  disabled={!modelReady}
                  onClick={() => send(suggestion)}
                >
                  {suggestion}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
          role="log"
          aria-live="polite"
          aria-busy={isLoading}
        >
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => {
              const message = messages[item.index];
              if (!message) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={(node) => {
                    virtualizer.measureElement(node);
                    if (node && message.id === lastId) follow();
                  }}
                  className="absolute left-0 top-0 w-full px-4 py-2"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <AssistantMessage
                    message={message}
                    streaming={isLoading && message.id === lastId}
                    approvals={approvals}
                    onViewMessage={send}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {modelError && (
        <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
          {modelError.message}
        </p>
      )}
      {alert && (
        <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
          {isInsufficientCreditsError(alert)
            ? t('Add credits to chat with the assistant.')
            : alert.message}
        </p>
      )}
      <AssistantComposer
        key={`${threadId}:${draftKey ?? ''}`}
        context={pageContext}
        onDismissContext={onDismissContext}
        initialPrompt={initialPrompt}
        busy={runBusy || !modelReady}
        hold={hold}
        model={model}
        onModelChange={setAssistantModel}
        onSend={(content) => {
          if (!modelReady) return;
          send(content);
          // The first send creates the thread row; History should list it.
          if (messages.length === 0) {
            void queryClient.invalidateQueries({
              queryKey: ['assistant-threads'],
            });
          }
        }}
        onStop={stop}
        uploadStub={uploadStub}
      />
    </div>
  );
};
