'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { type UIMessage, DefaultChatTransport, generateId, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useChat } from '@ai-sdk/react';
import { toast } from 'sonner';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { Activity, ArrowDown, ArrowUpIcon, Copy, KeyRound, LoaderCircle, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useInterruptions } from '@auth0/ai-vercel/react';

import { TokenVaultInterruptHandler } from '@/components/TokenVaultInterruptHandler';
import { ChatMessageBubble } from '@/components/chat-message-bubble';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/cn';

const CHAT_STORAGE_KEY_PREFIX = 'headhunt:m1:chat:messages';
const CHAT_THREAD_ID_PREFIX = 'headhunt-m1-chat';
const CHAT_STORAGE_VERSION = 'v2';
const RUN_CONNECTION_DIAGNOSTICS_PROMPT =
  'run_connection_diagnostics: call run_connection_diagnostics and summarize each check, including missing connections/scopes and exact next authorization step.';
const AUTHORIZATION_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const AUTHORIZATION_STEP_POLL_MS = 400;
const CHAT_LOG_JSON_MARKER = 'HHLOG_JSON';

type ChatLogMode = 'latest_exchange' | 'full_session';

const AUTHORIZATION_STEPS = [
  {
    label: 'Google',
    prompt:
      'authorize_connections_step:google. Call only verify_google_connection. If authorization is needed, prompt to authorize and stop.',
  },
  {
    label: 'Slack',
    prompt:
      'authorize_connections_step:slack. Call only verify_slack_connection. If authorization is needed, prompt to authorize and stop.',
  },
];

function uiMessageToText(message: UIMessage): string {
  const parts = (message as { parts?: unknown }).parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const maybeText = (part as { text?: unknown }).text;
          if (typeof maybeText === 'string') return maybeText;
        }

        return '';
      })
      .join('');
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function decodeEscapedLogText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function sanitizeAssistantLogText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  const textMatches = Array.from(trimmed.matchAll(/['"]text['"]\s*:\s*(['"])([\s\S]*?)\1/g));
  if (textMatches.length === 0) {
    return raw;
  }

  const values = textMatches
    .map((match) => decodeEscapedLogText(match[2] ?? '').trim())
    .filter(Boolean);

  if (values.length === 0) {
    return '';
  }

  return values.join('\n');
}

function shouldAutoSubmitAfterToolCalls(messages: UIMessage[]): boolean {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const lastUserText = lastUserMessage ? uiMessageToText(lastUserMessage) : '';

  const isControlFlowPrompt =
    /\bauthorize_connections_step:[a-z_]+\b/i.test(lastUserText) ||
    /\brun_connection_diagnostics\b/i.test(lastUserText) ||
    /\brun\s+connection\s+diagnostics\b/i.test(lastUserText);

  if (isControlFlowPrompt) {
    return false;
  }

  return lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

function normalizeIdentity(rawIdentity: string | null | undefined) {
  if (!rawIdentity) {
    return 'anonymous';
  }

  return encodeURIComponent(rawIdentity.trim());
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, item) => {
      if (item instanceof Date) {
        return item.toISOString();
      }

      if (typeof item === 'bigint') {
        return item.toString();
      }

      if (typeof item === 'function') {
        return '[function]';
      }

      if (typeof item === 'symbol') {
        return item.toString();
      }

      if (item && typeof item === 'object') {
        if (seen.has(item as object)) {
          return '[circular]';
        }
        seen.add(item as object);
      }

      return item;
    },
    2,
  );
}

async function writeClipboardText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error('Clipboard write is not available in this browser context.');
  }
}

function extractToolParts(message: UIMessage) {
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return null;
      }

      const value = part as Record<string, unknown>;
      const partType = typeof value.type === 'string' ? value.type : null;
      const looksLikeToolPart =
        (partType && partType.includes('tool')) ||
        'toolCallId' in value ||
        'toolName' in value ||
        'input' in value ||
        'output' in value ||
        'state' in value;

      if (!looksLikeToolPart) {
        return null;
      }

      return {
        type: partType,
        toolName: typeof value.toolName === 'string' ? value.toolName : null,
        toolCallId: typeof value.toolCallId === 'string' ? value.toolCallId : null,
        state: typeof value.state === 'string' ? value.state : null,
        input: value.input ?? null,
        output: value.output ?? null,
          error: value.error ?? value.errorText ?? null,
      };
    })
    .filter((part): part is NonNullable<typeof part> => Boolean(part));
}

function extractScheduleLogText(toolParts: ReturnType<typeof extractToolParts>): string | null {
  const schedulePart = [...toolParts].reverse().find((part) => {
    const partType = typeof part.type === 'string' ? part.type : '';
    return part.toolName === 'schedule_interview_slots' || partType.includes('schedule_interview_slots');
  });

  if (!schedulePart || !schedulePart.output || typeof schedulePart.output !== 'object') {
    return null;
  }

  const output = schedulePart.output as Record<string, unknown>;
  const check = typeof output.check === 'string' ? output.check : null;
  const status = typeof output.status === 'string' ? output.status : null;
  const mode = typeof output.mode === 'string' ? output.mode : null;

  if (check !== 'schedule_interview_slots') {
    return null;
  }

  if (status === 'error') {
    const message = typeof output.message === 'string' ? output.message : 'Unknown scheduling error.';
    return `Scheduling failed: ${message}`;
  }

  if (status !== 'success') {
    return null;
  }

  if (mode === 'propose') {
    const slots = Array.isArray(output.slots) ? output.slots : [];
    const recommendedIndex =
      typeof output.recommendedSlotIndex === 'number' && Number.isInteger(output.recommendedSlotIndex)
        ? output.recommendedSlotIndex
        : -1;

    const lines = slots
      .map((slot, index) => {
        if (!slot || typeof slot !== 'object') {
          return null;
        }

        const slotRecord = slot as Record<string, unknown>;
        const displayLabel = typeof slotRecord.displayLabel === 'string' ? slotRecord.displayLabel : null;
        const startISO = typeof slotRecord.startISO === 'string' ? slotRecord.startISO : null;
        if (!displayLabel || !startISO) {
          return null;
        }

        const suffix = index === recommendedIndex ? ' (recommended)' : '';
        return `${index + 1}. ${displayLabel}${suffix} | selectedStartISO: \"${startISO}\"`;
      })
      .filter((line): line is string => Boolean(line));

    if (lines.length === 0) {
      return 'Interview slots proposed (not scheduled yet).';
    }

    return `Interview slots proposed (not scheduled yet).\n${lines.join('\n')}`;
  }

  if (mode === 'schedule') {
    const event = output.event && typeof output.event === 'object' ? (output.event as Record<string, unknown>) : null;
    const displayLabel = event && typeof event.displayLabel === 'string' ? event.displayLabel : null;
    const htmlLink = event && typeof event.htmlLink === 'string' ? event.htmlLink : null;
    const meetLink = event && typeof event.meetLink === 'string' ? event.meetLink : null;

    const lines = ['Interview scheduled successfully.'];
    if (displayLabel) {
      lines.push(`Slot: ${displayLabel}`);
    }
    if (meetLink) {
      lines.push(`Meet link: ${meetLink}`);
    }
    if (htmlLink) {
      lines.push(`Calendar event: ${htmlLink}`);
    }

    return lines.join('\n');
  }

  return null;
}

function toLogEntry(message: UIMessage) {
  const maybeCreatedAt = (message as { createdAt?: unknown }).createdAt;
  const createdAt = maybeCreatedAt instanceof Date ? maybeCreatedAt.toISOString() : typeof maybeCreatedAt === 'string' ? maybeCreatedAt : null;
  const toolParts = extractToolParts(message);
  const rawText = uiMessageToText(message);
  const scheduleLogText = message.role === 'assistant' ? extractScheduleLogText(toolParts) : null;
  const text = scheduleLogText ?? (message.role === 'assistant' ? sanitizeAssistantLogText(rawText) : rawText);

  return {
    id: message.id,
    role: message.role,
    createdAt,
    text: text || null,
    toolParts,
    raw: message,
  };
}

function selectLatestExchange(messages: UIMessage[]): UIMessage[] {
  const lastUserIndex = [...messages].map((message) => message.role).lastIndexOf('user');

  if (lastUserIndex === -1) {
    return messages.slice(-2);
  }

  const assistantAfterUserIndex = messages.findIndex((message, index) => index > lastUserIndex && message.role === 'assistant');

  if (assistantAfterUserIndex !== -1) {
    let end = messages.length;
    for (let i = assistantAfterUserIndex + 1; i < messages.length; i++) {
      if (messages[i]?.role === 'user') {
        end = i;
        break;
      }
    }

    return messages.slice(lastUserIndex, end);
  }

  const previousAssistantIndex = [...messages]
    .map((message) => message.role)
    .lastIndexOf('assistant', lastUserIndex);

  if (previousAssistantIndex !== -1) {
    return messages.slice(previousAssistantIndex, lastUserIndex + 1);
  }

  return [messages[lastUserIndex]].filter(Boolean);
}

function ChatMessages(props: {
  messages: UIMessage[];
  emptyStateComponent: ReactNode;
  aiEmoji?: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col max-w-[768px] mx-auto pb-12 w-full">
      {props.messages.map((m) => {
        return <ChatMessageBubble key={m.id} message={m} aiEmoji={props.aiEmoji} />;
      })}
    </div>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button variant="outline" className={props.className} onClick={() => scrollToBottom()}>
      <ArrowDown className="w-4 h-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

function ChatInput(props: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loading?: boolean;
  placeholder?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.stopPropagation();
        e.preventDefault();
        props.onSubmit(e);
      }}
      className={cn('flex w-full flex-col', props.className)}
    >
      <div className="border border-input bg-background rounded-lg flex flex-col gap-2 max-w-[768px] w-full mx-auto">
        <input
          value={props.value}
          placeholder={props.placeholder}
          onChange={props.onChange}
          className="border-none outline-none bg-transparent p-4"
        />

        <div className="flex justify-between ml-4 mr-2 mb-2">
          <div className="flex gap-3">{props.children}</div>

          <Button
            className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
            type="submit"
            disabled={props.loading}
          >
            {props.loading ? <LoaderCircle className="animate-spin" /> : <ArrowUpIcon size={14} />}
          </Button>
        </div>
      </div>
    </form>
  );
}

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();

  // scrollRef will also switch between overflow: unset to overflow: auto
  return (
    <div
      ref={context.scrollRef}
      style={{ width: '100%', height: '100%' }}
      className={cn('grid grid-rows-[1fr,auto]', props.className)}
    >
      <div ref={context.contentRef} className={props.contentClassName}>
        {props.content}
      </div>

      {props.footer}
    </div>
  );
}

export function ChatWindow(props: {
  endpoint: string;
  emptyStateComponent: ReactNode;
  placeholder?: string;
  emoji?: string;
  userId: string;
}) {
  const scopedUserId = normalizeIdentity(props.userId);
  const chatStorageKey = `${CHAT_STORAGE_KEY_PREFIX}:${CHAT_STORAGE_VERSION}:${scopedUserId}`;
  const chatThreadId = `${CHAT_THREAD_ID_PREFIX}:${CHAT_STORAGE_VERSION}:${scopedUserId}`;

  const { messages, sendMessage, status, toolInterrupt, stop, regenerate, setMessages } = useInterruptions((handler) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useChat({
      id: chatThreadId,
      transport: new DefaultChatTransport({ api: props.endpoint }),
      generateId,
      onError: handler((e: Error) => {
        console.error('Error: ', e);
        toast.error(`Error while processing your request`, { description: e.message });
      }),
      sendAutomaticallyWhen: ({ messages }) => shouldAutoSubmitAfterToolCalls(messages as UIMessage[]),
    }),
  );

  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [isAuthorizationFlowRunning, setIsAuthorizationFlowRunning] = useState(false);
  const [activeAuthorizationStep, setActiveAuthorizationStep] = useState<string | null>(null);
  const [isCopyingLogs, setIsCopyingLogs] = useState(false);
  const hasLoadedPersistedMessages = useRef(false);
  const statusRef = useRef(status);
  const interruptRef = useRef(toolInterrupt);

  const isChatBusy = status === 'submitted' || status === 'streaming';
  const hasAssistantMessages = messages.some((message) => message.role === 'assistant');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    interruptRef.current = toolInterrupt;
  }, [toolInterrupt]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || hasLoadedPersistedMessages.current) {
      return;
    }

    const raw = window.localStorage.getItem(chatStorageKey);
    if (!raw) {
      hasLoadedPersistedMessages.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(raw) as UIMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
      }
    } catch (error) {
      console.warn('Failed to restore persisted chat messages.', error);
    } finally {
      hasLoadedPersistedMessages.current = true;
    }
  }, [chatStorageKey, hydrated, setMessages]);

  useEffect(() => {
    if (!hydrated || !hasLoadedPersistedMessages.current) {
      return;
    }

    window.localStorage.setItem(chatStorageKey, JSON.stringify(messages));
  }, [messages, hydrated, chatStorageKey]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || isChatBusy) return;
    await sendMessage({ text: input });
    setInput('');
  }

  async function onRunConnectionDiagnostics() {
    if (isChatBusy || isAuthorizationFlowRunning) {
      return;
    }

    await sendMessage({ text: RUN_CONNECTION_DIAGNOSTICS_PROMPT });
  }

  async function waitForStepCompletion() {
    const startedAt = Date.now();

    while (true) {
      const currentStatus = statusRef.current;
      const hasInterrupt = Boolean(interruptRef.current);
      const isBusy = currentStatus === 'submitted' || currentStatus === 'streaming';

      if (!isBusy && !hasInterrupt) {
        return;
      }

      if (Date.now() - startedAt > AUTHORIZATION_STEP_TIMEOUT_MS) {
        throw new Error('Authorization step timed out.');
      }

      await new Promise((resolve) => setTimeout(resolve, AUTHORIZATION_STEP_POLL_MS));
    }
  }

  async function onAuthorizeConnectionsOneByOne() {
    if (isAuthorizationFlowRunning || isChatBusy) {
      return;
    }

    setIsAuthorizationFlowRunning(true);

    try {
      for (const step of AUTHORIZATION_STEPS) {
        setActiveAuthorizationStep(step.label);
        await sendMessage({ text: step.prompt });
        await waitForStepCompletion();
      }

      toast.success('Authorization flow complete.', {
        description: 'Google and Slack authorization checks finished.',
      });
    } catch (error) {
      toast.error('Authorization flow stopped.', {
        description: error instanceof Error ? error.message : 'Unknown error while authorizing integrations.',
      });
    } finally {
      setIsAuthorizationFlowRunning(false);
      setActiveAuthorizationStep(null);
    }
  }

  function onClearChat() {
    setMessages([]);
    window.localStorage.removeItem(chatStorageKey);
  }

  async function onCopyLogs(mode: ChatLogMode) {
    if (isCopyingLogs || messages.length === 0) {
      return;
    }

    setIsCopyingLogs(true);

    try {
      const selectedMessages = mode === 'latest_exchange' ? selectLatestExchange(messages) : messages;

      if (selectedMessages.length === 0) {
        toast.error('No chat logs available to copy.');
        return;
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        mode,
        threadId: chatThreadId,
        scopedUserId,
        messageCount: selectedMessages.length,
        messages: selectedMessages.map((message) => toLogEntry(message)),
      };

      const serializedPayload = safeJsonStringify(payload);
      const clipboardText = `${CHAT_LOG_JSON_MARKER}\n${serializedPayload}`;

      await writeClipboardText(clipboardText);

      toast.success('Chat logs copied.', {
        description:
          mode === 'latest_exchange'
            ? 'Copied latest user + assistant exchange with tool details.'
            : `Copied full session (${selectedMessages.length} messages) with tool details.`,
      });
    } catch (error) {
      toast.error('Failed to copy chat logs.', {
        description: error instanceof Error ? error.message : 'Unknown clipboard error.',
      });
    } finally {
      setIsCopyingLogs(false);
    }
  }

  return (
    <StickToBottom>
      <StickyToBottomContent
        className="absolute inset-0"
        contentClassName="py-8 px-2"
        content={
          messages.length === 0 ? (
            <div>{props.emptyStateComponent}</div>
          ) : (
            <>
              <ChatMessages aiEmoji={props.emoji} messages={messages} emptyStateComponent={props.emptyStateComponent} />
              <div className="flex flex-col max-w-[768px] mx-auto pb-12 w-full">
                <TokenVaultInterruptHandler interrupt={toolInterrupt} />
              </div>
            </>
          )
        }
        footer={
          <div className="sticky bottom-8 px-2">
            <ScrollToBottom className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4" />
            <div className="max-w-[768px] mx-auto mb-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isChatBusy || isAuthorizationFlowRunning}
                onClick={onAuthorizeConnectionsOneByOne}
              >
                <KeyRound className="w-4 h-4 mr-1" />
                {isAuthorizationFlowRunning
                  ? `Authorizing ${activeAuthorizationStep ?? 'Integrations'}...`
                  : 'Authorize Integrations'}
              </Button>

              <Button variant="outline" size="sm" disabled={isChatBusy} onClick={onRunConnectionDiagnostics}>
                <Activity className="w-4 h-4 mr-1" />
                Run Diagnostics
              </Button>

              {isChatBusy ? (
                <Button variant="outline" size="sm" onClick={() => stop()}>
                  <Square className="w-4 h-4 mr-1" />
                  Stop
                </Button>
              ) : null}

              {!isChatBusy && hasAssistantMessages ? (
                <Button variant="outline" size="sm" onClick={() => regenerate()}>
                  <RotateCcw className="w-4 h-4 mr-1" />
                  Regenerate
                </Button>
              ) : null}

              {messages.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isCopyingLogs}>
                      <Copy className="w-4 h-4 mr-1" />
                      {isCopyingLogs ? 'Copying...' : 'Copy Logs'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void onCopyLogs('latest_exchange')}>
                      Latest You + AI Exchange
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void onCopyLogs('full_session')}>
                      Full Session (All Messages)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {messages.length > 0 ? (
                <Button variant="outline" size="sm" onClick={onClearChat}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              ) : null}
            </div>
            <ChatInput
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onSubmit={onSubmit}
              loading={isChatBusy}
              placeholder={props.placeholder ?? 'What can I help you with?'}
            ></ChatInput>
          </div>
        }
      ></StickyToBottomContent>
    </StickToBottom>
  );
}
